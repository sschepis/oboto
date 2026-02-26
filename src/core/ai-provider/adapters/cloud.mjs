import { config } from '../../../config.mjs';
import { consoleStyler } from '../../../ui/console-styler.mjs';
import { AI_PROVIDERS, PROVIDER_ENDPOINTS } from '../constants.mjs';
import { getEndpoint, getAuthHeaders } from '../detection.mjs';
import { callGeminiSDK } from './gemini.mjs';
import { callOpenAIREST } from './openai.mjs';

// Cloud proxy reference (set externally when cloud is active)
let _cloudSync = null;

// WebLLM bridge reference (needed for emitting usage events)
let _eventBus = null;

/**
 * Set the CloudSync reference for the cloud AI proxy provider.
 * Called from main.mjs after cloud initialization.
 * @param {object|null} cloudSync
 */
export function setCloudSyncRef(cloudSync) {
    _cloudSync = cloudSync;
}

/**
 * Set the EventBus reference (shared with WebLLM but used here for cloud usage events).
 * @param {object|null} eventBus
 */
export function setEventBusRefForCloud(eventBus) {
    _eventBus = eventBus;
}

/**
 * Detect the first available local provider by checking configured API keys.
 * Used when cloud proxy fails to provide automatic fallback.
 * @returns {{ provider: string, model: string }|null}
 */
function _detectLocalProvider() {
    // Check each provider in priority order
    if (config.keys.google) {
        return { provider: AI_PROVIDERS.GEMINI, model: 'gemini-2.0-flash' };
    }
    if (config.keys.openai) {
        return { provider: AI_PROVIDERS.OPENAI, model: 'gpt-4o' };
    }
    // Try local server as last resort (always "available")
    return { provider: AI_PROVIDERS.LMSTUDIO, model: config.ai.model || 'local-model' };
}

/**
 * Call a provider with a fallback context (used when cloud proxy fails).
 * @param {{ provider: string, model: string }} fallback
 * @param {Object} requestBody
 * @param {Object} options
 * @returns {Promise<Object>}
 */
async function _callWithFallbackContext(fallback, requestBody, options = {}) {
    const ctx = {
        provider: fallback.provider,
        endpoint: getEndpoint(fallback.provider),
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(fallback.provider),
        },
        model: fallback.model,
    };

    if (ctx.provider === AI_PROVIDERS.GEMINI) {
        return await callGeminiSDK(ctx, { ...requestBody, model: ctx.model });
    }
    return await callOpenAIREST(ctx, { ...requestBody, model: ctx.model }, options.signal);
}

/**
 * Call the Cloud AI Proxy.
 */
export async function callCloudProxy(ctx, requestBody, options = {}) {
    if (!_cloudSync || !_cloudSync.isLoggedIn()) {
        // Fallback to local provider if cloud isn't available
        const fallbackProvider = _detectLocalProvider();
        if (fallbackProvider) {
            consoleStyler.log('cloud', `Cloud not logged in — falling back to local provider: ${fallbackProvider.provider}`);
            return await _callWithFallbackContext(fallbackProvider, requestBody, options);
        }
        throw new Error('Cloud AI proxy requires an active Oboto Cloud login. Set AI_PROVIDER to a local provider or log in to cloud.');
    }
    try {
        const rawCloudResponse = await _cloudSync.aiProxyRequest('auto', ctx.model, requestBody.messages, {
            tools: requestBody.tools,
            temperature: requestBody.temperature,
            max_tokens: requestBody.max_tokens,
            response_format: requestBody.response_format,
        });
        // Extract and emit cloud usage metadata if present, without mutating the original response
        const { _cloud_usage, ...cloudResponse } = rawCloudResponse ?? {};
        if (_cloud_usage && _eventBus) {
            _eventBus.emitTyped('cloud:usage-update', _cloud_usage);
        }
        return cloudResponse;
    } catch (err) {
        consoleStyler.log('cloud', `Cloud AI proxy failed: ${err.message}. Falling back to local provider.`);
        const fallbackProvider = _detectLocalProvider();
        if (fallbackProvider) {
            return await _callWithFallbackContext(fallbackProvider, requestBody, options);
        }
        throw err; // No local provider available either
    }
}

/**
 * Stream from Cloud AI Proxy.
 */
export async function callCloudProxyStream(ctx, requestBody) {
    if (!_cloudSync || !_cloudSync.isLoggedIn()) {
        throw new Error('Cloud AI proxy requires an active Oboto Cloud login.');
    }
    // Wrap the async generator as a synthetic SSE Response
    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            try {
                for await (const chunk of _cloudSync.aiProxyStream(ctx.model, requestBody.messages)) {
                    const sseData = JSON.stringify(chunk);
                    controller.enqueue(encoder.encode(`data: ${sseData}\n\n`));
                }
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
            } catch (err) {
                controller.error(err);
            }
        },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}
