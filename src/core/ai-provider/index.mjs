import { AI_PROVIDERS, WEBLLM_RECOMMENDED_MODELS } from './constants.mjs';
import { detectProvider, getEndpoint, getAuthHeaders, createProviderContext, getProviderLabel } from './detection.mjs';
import { isCancellationError, withRetry } from './utils.mjs';
import { callGeminiSDK, callGeminiSDKStream } from './adapters/gemini.mjs';
import { callOpenAIREST, callOpenAIRESTStream, transformRequestBody } from './adapters/openai.mjs';
import { callWebLLM, setEventBusRef as setWebLLMEventBusRef } from './adapters/webllm.mjs';
import { callCloudProxy, callCloudProxyStream, setCloudSyncRef, setEventBusRefForCloud } from './adapters/cloud.mjs';

// Re-export constants and utilities
export {
    AI_PROVIDERS,
    WEBLLM_RECOMMENDED_MODELS,
    detectProvider,
    getEndpoint,
    getAuthHeaders,
    transformRequestBody,
    createProviderContext,
    isCancellationError,
    getProviderLabel,
    setCloudSyncRef,
};

// Unified setEventBusRef that updates both WebLLM and Cloud adapters
export function setEventBusRef(eventBus) {
    setWebLLMEventBusRef(eventBus);
    setEventBusRefForCloud(eventBus);
}

/**
 * Make an API call using the provider abstraction.
 * For Gemini: uses @google/genai SDK with format translation
 * For OpenAI/Local: uses REST fetch with OpenAI-compatible format
 *
 * @param {Object} requestBody - OpenAI-compatible request body (model, messages, tools, etc.)
 * @param {Object} [options] - Optional overrides
 * @param {string} [options.model] - Model override
 * @param {AbortSignal} [options.signal] - Abort signal for cancellation
 * @returns {Promise<Object>} OpenAI-compatible parsed JSON response
 */
export async function callProvider(requestBody, options = {}) {
    const ctx = createProviderContext(options.model || requestBody.model);

    // ── WebLLM: route through browser-side WebLLM engine via WS ──
    if (ctx.provider === AI_PROVIDERS.WEBLLM) {
        return await callWebLLM(requestBody);
    }

    // ── Cloud: route through cloud AI proxy (with fallback) ──
    if (ctx.provider === AI_PROVIDERS.CLOUD) {
        return await callCloudProxy(ctx, requestBody, options);
    }

    // ── Gemini: use native SDK ──
    if (ctx.provider === AI_PROVIDERS.GEMINI) {
        // TODO: Add cancellation support to Gemini SDK call if possible
        return await callGeminiSDK(ctx, requestBody);
    }

    // ── OpenAI / Local: use REST fetch ──
    return await callOpenAIREST(ctx, requestBody, options.signal);
}

/**
 * Make a streaming API call using the provider abstraction.
 * For Gemini: falls back to non-streaming (SDK stream support can be added later)
 * For OpenAI/Local: uses REST SSE streaming
 *
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {Object} [options] - Optional overrides
 * @param {AbortSignal} [options.signal] - Abort signal for cancellation
 * @returns {Promise<Response>} Raw fetch Response for streaming (or synthetic for Gemini)
 */
export async function callProviderStream(requestBody, options = {}) {
    const ctx = createProviderContext(options.model || requestBody.model);

    // ── Cloud: route through cloud AI proxy streaming ──
    if (ctx.provider === AI_PROVIDERS.CLOUD) {
        return await callCloudProxyStream(ctx, requestBody);
    }

    // ── Gemini: use SDK (non-streaming, wrapped as synthetic stream) ──
    if (ctx.provider === AI_PROVIDERS.GEMINI) {
        // TODO: Add cancellation support to Gemini SDK call if possible
        return await callGeminiSDKStream(ctx, requestBody);
    }

    // ── OpenAI / Local: use REST SSE ──
    return await callOpenAIRESTStream(ctx, requestBody, options.signal);
}

// Test-only exports (stripped in production builds)
export const _testExports = { withRetry, isCancellationError };
