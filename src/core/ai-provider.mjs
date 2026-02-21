// AI Provider abstraction layer
// Handles provider detection, endpoint configuration, and request/response translation
// Supports: OpenAI, Google Gemini (via @google/genai SDK), and local (LMStudio, Ollama, etc.)

import { config } from '../config.mjs';

/**
 * Supported AI providers
 */
export const AI_PROVIDERS = {
    CLOUD: 'cloud',
    WEBLLM: 'webllm',
    LMSTUDIO: 'lmstudio',
    OPENAI: 'openai',
    GEMINI: 'gemini',
    ANTHROPIC: 'anthropic',
};

/**
 * Default endpoints for each provider
 */
const PROVIDER_ENDPOINTS = {
    [AI_PROVIDERS.LMSTUDIO]: 'http://localhost:1234/v1/chat/completions',
    [AI_PROVIDERS.OPENAI]: 'https://api.openai.com/v1/chat/completions',
    // Gemini uses SDK, not REST endpoint — this is only a fallback
    [AI_PROVIDERS.GEMINI]: null,
    // Anthropic via Vertex uses SDK
    [AI_PROVIDERS.ANTHROPIC]: null,
};

// Lazy-loaded SDK instances
let _geminiAI = null;
let _anthropicVertex = null;

// Cloud proxy reference (set externally when cloud is active)
let _cloudSync = null;

// WebLLM bridge — eventBus reference for routing requests to browser
let _eventBus = null;
const _webllmPending = new Map(); // requestId → { resolve, reject, timer }

/**
 * Set the CloudSync reference for the cloud AI proxy provider.
 * Called from main.mjs after cloud initialization.
 * @param {object|null} cloudSync
 */
export function setCloudSyncRef(cloudSync) {
    _cloudSync = cloudSync;
}

/**
 * Set the EventBus reference for WebLLM provider.
 * WebLLM runs in the browser — the server routes requests through WS via EventBus.
 * Called from main.mjs or web-server.mjs.
 * @param {object|null} eventBus
 */
export function setEventBusRef(eventBus) {
    _eventBus = eventBus;
    if (_eventBus) {
        // Listen for webllm:response events from browser
        _eventBus.on('webllm:response', (data) => {
            const pending = _webllmPending.get(data.requestId);
            if (pending) {
                clearTimeout(pending.timer);
                _webllmPending.delete(data.requestId);
                if (data.error) {
                    pending.reject(new Error(data.error));
                } else {
                    pending.resolve(data.result);
                }
            }
        });
    }
}

/**
 * Recommended WebLLM models for Oboto.
 * These are optimized for agentic coding tasks and fit common GPU memory.
 */
export const WEBLLM_RECOMMENDED_MODELS = [
    {
        id: 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC',
        name: 'Qwen 2.5 Coder 7B (recommended)',
        description: 'Best for coding tasks. Strong tool-calling support. Requires ~5GB VRAM.',
        vram: '5GB',
        quality: 'high',
    },
    {
        id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
        name: 'Llama 3.2 3B',
        description: 'Good balance of quality and speed. Fits in 3GB VRAM.',
        vram: '3GB',
        quality: 'medium',
    },
    {
        id: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
        name: 'Phi 3.5 Mini',
        description: 'Compact and fast. Great for simple tasks. ~2GB VRAM.',
        vram: '2GB',
        quality: 'medium',
    },
    {
        id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
        name: 'Qwen 2.5 3B',
        description: 'Strong multilingual support. Good reasoning. ~3GB VRAM.',
        vram: '3GB',
        quality: 'medium',
    },
];

/**
 * Get or create the Gemini SDK client
 * @returns {Object} GoogleGenAI instance
 */
async function getGeminiClient() {
    if (_geminiAI) return _geminiAI;

    const { GoogleGenAI } = await import('@google/genai');
    _geminiAI = new GoogleGenAI({ apiKey: config.keys.google });
    return _geminiAI;
}

/**
 * Get or create the Anthropic Vertex SDK client
 * @returns {Object} AnthropicVertex instance
 */
async function getAnthropicClient() {
    if (_anthropicVertex) return _anthropicVertex;

    // Use dynamic import for the SDK
    const { AnthropicVertex } = await import('@anthropic-ai/vertex-sdk');
    
    _anthropicVertex = new AnthropicVertex({
        projectId: config.vertex?.projectId,
        region: config.vertex?.region || 'us-east5',
        // Auth is handled automatically via Google ADC (Application Default Credentials)
    });
    
    return _anthropicVertex;
}

/**
 * Detect the AI provider from the model name.
 * Uses name-based heuristics to determine the correct provider.
 * When no model is specified, falls back to the configured default provider.
 *
 * IMPORTANT: This function must NOT blindly return config.ai.provider when a
 * model is specified — that would route all models (including LMStudio models)
 * to whatever the default provider is (e.g., Gemini), causing 404 errors.
 *
 * @param {string} model - The model identifier
 * @returns {string} The detected provider key
 */
export function detectProvider(model) {
    if (!model) {
        // No model specified — use the configured default provider
        const explicitProvider = config.ai.provider;
        if (explicitProvider && Object.values(AI_PROVIDERS).includes(explicitProvider)) {
            return explicitProvider;
        }
        return AI_PROVIDERS.LMSTUDIO;
    }

    const m = model.toLowerCase();

    // Google Gemini models
    if (m.startsWith('gemini-') || m.startsWith('models/gemini-')) {
        return AI_PROVIDERS.GEMINI;
    }

    // Anthropic Claude models
    if (m.startsWith('claude-')) {
        return AI_PROVIDERS.ANTHROPIC;
    }

    // OpenAI models
    if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4') || m.startsWith('chatgpt-')) {
        return AI_PROVIDERS.OPENAI;
    }

    // Default: local server (LMStudio, Ollama, etc.)
    // Any model name that doesn't match a known cloud provider prefix
    // is assumed to be a local model served by LMStudio or similar
    return AI_PROVIDERS.LMSTUDIO;
}

/**
 * Get the appropriate endpoint URL for a provider
 * @param {string} provider - The provider key
 * @returns {string|null} The endpoint URL (null for SDK-based providers)
 */
export function getEndpoint(provider) {
    // If user has explicitly set an endpoint, always use it
    const configuredEndpoint = config.ai.endpoint;
    if (configuredEndpoint &&
        configuredEndpoint !== 'http://localhost:1234/v1/chat/completions' &&
        configuredEndpoint !== 'http://localhost:1234/api/v1/chat') {
        return configuredEndpoint;
    }

    return PROVIDER_ENDPOINTS[provider] || PROVIDER_ENDPOINTS[AI_PROVIDERS.LMSTUDIO];
}

/**
 * Get the appropriate authorization headers for a provider (REST-based only)
 * @param {string} provider - The provider key
 * @returns {Object} Headers object
 */
export function getAuthHeaders(provider) {
    switch (provider) {
        case AI_PROVIDERS.OPENAI:
            if (config.keys.openai) {
                return { 'Authorization': `Bearer ${config.keys.openai}` };
            }
            return {};

        case AI_PROVIDERS.LMSTUDIO:
        default:
            // Local servers may still use an API key for compatibility
            if (config.keys.openai) {
                return { 'Authorization': `Bearer ${config.keys.openai}` };
            }
            return {};
    }
}

// ─── OpenAI ↔ Gemini Format Translation ──────────────────────────────────

/**
 * Convert OpenAI-format tools to Gemini functionDeclarations
 * OpenAI: [{type: "function", function: {name, description, parameters}}]
 * Gemini: [{functionDeclarations: [{name, description, parameters}]}]
 */
function openaiToolsToGemini(tools) {
    if (!tools || tools.length === 0) return undefined;

    const declarations = tools
        .filter(t => t.type === 'function' && t.function)
        .map(t => {
            const decl = {
                name: t.function.name,
                description: t.function.description || '',
                parameters: sanitizeSchemaForGemini(t.function.parameters),
            };
            return decl;
        });

    return [{ functionDeclarations: declarations }];
}

/**
 * Sanitize a JSON Schema to be compatible with Gemini's expectations.
 * Gemini does not support some JSON Schema constructs that OpenAI does.
 */
function sanitizeSchemaForGemini(schema) {
    if (!schema) return undefined;

    const clean = { ...schema };

    // Remove unsupported keywords
    delete clean.default;
    delete clean.minimum;
    delete clean.maximum;
    delete clean.$schema;

    // Gemini expects `required` only as an array of property names at the object level.
    // Remove boolean `required` values on individual properties (OpenAI allows this).
    // Also remove empty required arrays — Gemini may reject these.
    if (typeof clean.required === 'boolean') {
        delete clean.required;
    } else if (Array.isArray(clean.required) && clean.required.length === 0) {
        delete clean.required;
    }

    // Gemini doesn't support "any" type — convert to "string"
    if (clean.type === 'any') {
        clean.type = 'string';
    }

    // Recursively clean nested properties
    if (clean.properties) {
        const cleanProps = {};
        for (const [key, value] of Object.entries(clean.properties)) {
            cleanProps[key] = sanitizeSchemaForGemini(value);
        }
        clean.properties = cleanProps;
    }

    // Clean array items
    if (clean.items) {
        clean.items = sanitizeSchemaForGemini(clean.items);
    }

    return clean;
}

/**
 * Convert OpenAI-format messages to Gemini contents + systemInstruction
 * OpenAI: [{role: "system"|"user"|"assistant"|"tool", content, tool_calls, tool_call_id, name}]
 * Gemini: {systemInstruction, contents: [{role: "user"|"model", parts: [...]}]}
 */
function openaiMessagesToGemini(messages) {
    // Collect ALL system messages and concatenate them.
    // Previously this used `systemInstruction = msg.content` which meant
    // only the LAST system message survived — consciousness/somatic injections
    // would overwrite the main system prompt, stripping scope constraints
    // and causing role confusion (the model would hallucinate fake user content).
    const systemParts = [];
    const contents = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            // Accumulate all system messages — they'll be joined below
            if (msg.content) {
                systemParts.push(msg.content);
            }
            continue;
        }

        if (msg.role === 'user') {
            contents.push({
                role: 'user',
                parts: [{ text: msg.content }],
            });
            continue;
        }

        if (msg.role === 'assistant') {
            // If we have preserved Gemini parts (from a previous round-trip),
            // use them directly to preserve thought/thoughtSignature fields
            if (msg._geminiParts && Array.isArray(msg._geminiParts)) {
                contents.push({ role: 'model', parts: msg._geminiParts });
                continue;
            }

            const parts = [];

            // Text content
            if (msg.content) {
                parts.push({ text: msg.content });
            }

            // Tool calls → functionCall parts (with optional thoughtSignature)
            if (msg.tool_calls && msg.tool_calls.length > 0) {
                for (const tc of msg.tool_calls) {
                    let args;
                    try {
                        args = typeof tc.function.arguments === 'string'
                            ? JSON.parse(tc.function.arguments)
                            : tc.function.arguments;
                    } catch {
                        args = {};
                    }
                    const fcPart = {
                        functionCall: {
                            name: tc.function.name,
                            args: args,
                        },
                    };
                    // Preserve thoughtSignature if stored from prior Gemini response
                    if (tc._thoughtSignature) {
                        fcPart.thoughtSignature = tc._thoughtSignature;
                    }
                    parts.push(fcPart);
                }
            }

            if (parts.length > 0) {
                contents.push({ role: 'model', parts });
            }
            continue;
        }

        if (msg.role === 'tool') {
            // Tool result → functionResponse part
            let responseObj;
            try {
                responseObj = typeof msg.content === 'string'
                    ? { result: msg.content }
                    : msg.content;
            } catch {
                responseObj = { result: String(msg.content) };
            }

            contents.push({
                role: 'user',
                parts: [{
                    functionResponse: {
                        name: msg.name || 'unknown_tool',
                        response: responseObj,
                    },
                }],
            });
            continue;
        }
    }

    // ── Post-process: merge consecutive same-role turns ──
    // Gemini strictly requires role alternation (user/model/user/model...).
    // After summarization or message deletion, we may end up with consecutive
    // model or user turns. Merge their parts into a single content entry.
    const merged = [];
    for (const entry of contents) {
        if (merged.length > 0 && merged[merged.length - 1].role === entry.role) {
            // Merge parts into the previous entry
            merged[merged.length - 1].parts.push(...entry.parts);
        } else {
            merged.push({ ...entry, parts: [...entry.parts] });
        }
    }

    // Gemini also requires the conversation to start with a 'user' turn.
    // If after merging it starts with 'model', insert a synthetic user turn.
    if (merged.length > 0 && merged[0].role === 'model') {
        merged.unshift({ role: 'user', parts: [{ text: '(continue)' }] });
    }

    // ── Strip orphaned functionCall parts ──
    // Gemini requires every functionCall to be immediately followed by a
    // functionResponse turn. After summarization, older tool calls may lack
    // their paired responses. Remove functionCall (and thought/thoughtSignature)
    // parts from model turns that are NOT followed by a user turn containing
    // a functionResponse part.
    for (let i = 0; i < merged.length; i++) {
        if (merged[i].role !== 'model') continue;
        const hasFunctionCall = merged[i].parts.some(p => p.functionCall);
        if (!hasFunctionCall) continue;

        // Check if the next turn is a user turn with functionResponse
        const next = merged[i + 1];
        const hasMatchingResponse = next
            && next.role === 'user'
            && next.parts.some(p => p.functionResponse);

        if (!hasMatchingResponse) {
            // Strip functionCall and associated thought/thoughtSignature parts
            merged[i].parts = merged[i].parts.filter(
                p => !p.functionCall && !p.thoughtSignature
            );
            // If no parts remain, add placeholder text
            if (merged[i].parts.length === 0) {
                merged[i].parts = [{ text: '(processed)' }];
            }
        }
    }

    // Join all system messages with separators to form a single systemInstruction.
    // The main system prompt is always first; consciousness/context messages follow.
    const systemInstruction = systemParts.length > 0
        ? systemParts.join('\n\n---\n\n')
        : undefined;

    return { systemInstruction, contents: merged };
}

/**
 * Convert a Gemini generateContent response to OpenAI-compatible format
 * so the rest of the app can process it uniformly.
 *
 * IMPORTANT: For thinking models (gemini-3-*), the response may include
 * `thought` and `thoughtSignature` fields in parts. These MUST be preserved
 * and sent back in subsequent turns for function calling to work.
 * We store them as `_geminiParts` on the message object.
 */
function geminiResponseToOpenai(geminiResponse) {
    const candidate = geminiResponse.candidates?.[0];
    if (!candidate) {
        return { choices: [] };
    }

    const parts = candidate.content?.parts || [];
    const message = { role: 'assistant' };

    // Collect text parts (exclude thought parts from visible content)
    const textParts = parts.filter(p => p.text && !p.thought).map(p => p.text);
    if (textParts.length > 0) {
        message.content = textParts.join('');
    } else {
        message.content = null;
    }

    // Collect function calls — preserve thoughtSignature for thinking models
    const functionCalls = parts.filter(p => p.functionCall);
    if (functionCalls.length > 0) {
        message.tool_calls = functionCalls.map((p, i) => ({
            id: `call_gemini_${Date.now()}_${i}`,
            type: 'function',
            function: {
                name: p.functionCall.name,
                arguments: JSON.stringify(p.functionCall.args || {}),
            },
            // Preserve Gemini-specific fields for round-tripping
            _thoughtSignature: p.thoughtSignature || undefined,
        }));
    }

    // Preserve the FULL original parts array for faithful reconstruction
    // This ensures thought parts and thoughtSignatures survive the round-trip
    message._geminiParts = parts;

    return {
        choices: [{
            index: 0,
            message,
            finish_reason: candidate.finishReason || 'stop',
        }],
        usage: geminiResponse.usageMetadata ? {
            prompt_tokens: geminiResponse.usageMetadata.promptTokenCount || 0,
            completion_tokens: geminiResponse.usageMetadata.candidatesTokenCount || 0,
            total_tokens: geminiResponse.usageMetadata.totalTokenCount || 0,
        } : undefined,
    };
}

// ─── Provider Context ────────────────────────────────────────────────────

/**
 * Transform request body for provider-specific quirks (REST providers only)
 * @param {string} provider - The provider key
 * @param {Object} body - The OpenAI-compatible request body
 * @returns {Object} The transformed request body
 */
export function transformRequestBody(provider, body) {
    const transformed = { ...body };

    switch (provider) {
        case AI_PROVIDERS.OPENAI:
            // OpenAI doesn't support reasoning_effort for most models
            // Keep it for models that might support it (o1, etc.)
            break;

        case AI_PROVIDERS.LMSTUDIO:
        default:
            // Local servers (LMStudio) typically support all OpenAI params
            break;
    }

    return transformed;
}

/**
 * Create a fully configured provider context for making API calls
 * @param {string} [model] - Optional model override; defaults to config.ai.model
 * @returns {{ provider: string, endpoint: string|null, headers: Object, model: string }}
 */
export function createProviderContext(model) {
    const activeModel = model || config.ai.model;
    const provider = detectProvider(activeModel);
    const endpoint = getEndpoint(provider);
    const authHeaders = provider !== AI_PROVIDERS.GEMINI ? getAuthHeaders(provider) : {};

    return {
        provider,
        endpoint,
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
        },
        model: activeModel,
    };
}

// ─── Unified API Call Functions ──────────────────────────────────────────

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
        if (!_cloudSync || !_cloudSync.isLoggedIn()) {
            // Fallback to local provider if cloud isn't available
            const fallbackProvider = _detectLocalProvider();
            if (fallbackProvider) {
                console.warn('[ai-provider] Cloud not logged in — falling back to local provider:', fallbackProvider.provider);
                return await _callWithFallbackContext(fallbackProvider, requestBody, options);
            }
            throw new Error('Cloud AI proxy requires an active Oboto Cloud login. Set AI_PROVIDER to a local provider or log in to cloud.');
        }
        try {
            return await _cloudSync.aiProxyRequest('auto', ctx.model, requestBody.messages);
        } catch (err) {
            console.warn(`[ai-provider] Cloud AI proxy failed: ${err.message}. Falling back to local provider.`);
            const fallbackProvider = _detectLocalProvider();
            if (fallbackProvider) {
                return await _callWithFallbackContext(fallbackProvider, requestBody, options);
            }
            throw err; // No local provider available either
        }
    }

    // ── Gemini: use native SDK ──
    if (ctx.provider === AI_PROVIDERS.GEMINI) {
        // TODO: Add cancellation support to Gemini SDK call if possible
        return await callGeminiSDK(ctx, requestBody);
    }

    // ── Anthropic: use Vertex SDK ──
    if (ctx.provider === AI_PROVIDERS.ANTHROPIC) {
        // TODO: Add cancellation support to Anthropic SDK call if possible
        return await callAnthropicVertexSDK(ctx, requestBody);
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

    // ── Gemini: use SDK (non-streaming, wrapped as synthetic stream) ──
    if (ctx.provider === AI_PROVIDERS.GEMINI) {
        // TODO: Add cancellation support to Gemini SDK call if possible
        return await callGeminiSDKStream(ctx, requestBody);
    }

    // ── OpenAI / Local: use REST SSE ──
    const body = transformRequestBody(ctx.provider, { ...requestBody, stream: true });

    const response = await fetch(ctx.endpoint, {
        method: 'POST',
        headers: ctx.headers,
        body: JSON.stringify(body),
        signal: options.signal,
    });

    if (!response.ok) {
        const providerLabel = ctx.provider === AI_PROVIDERS.LMSTUDIO
            ? 'LMStudio AI server (is LMStudio running?)'
            : `${ctx.provider} API`;
        throw new Error(`${providerLabel} Error: ${response.status} - ${response.statusText}`);
    }

    return response;
}

// ─── Gemini SDK Calls ────────────────────────────────────────────────────

/**
 * Call Gemini using the @google/genai SDK
 */
async function callGeminiSDK(ctx, requestBody) {
    const ai = await getGeminiClient();
    const { systemInstruction, contents } = openaiMessagesToGemini(requestBody.messages);
    const geminiTools = openaiToolsToGemini(requestBody.tools);

    const generateConfig = {};
    
    if (requestBody.response_format) {
        if (requestBody.response_format.type === 'json_object') {
            generateConfig.responseMimeType = 'application/json';
        } else if (requestBody.response_format.type === 'json_schema') {
            generateConfig.responseMimeType = 'application/json';
            generateConfig.responseSchema = requestBody.response_format.schema;
        }
    }

    if (requestBody.temperature !== undefined) {
        generateConfig.temperature = requestBody.temperature;
    }
    if (requestBody.max_tokens) {
        generateConfig.maxOutputTokens = requestBody.max_tokens;
    }

    // Build tool config for auto tool choice
    if (geminiTools) {
        generateConfig.tools = geminiTools;
    }

    if (systemInstruction) {
        generateConfig.systemInstruction = systemInstruction;
    }

    const geminiResponse = await ai.models.generateContent({
        model: ctx.model,
        contents: contents,
        config: generateConfig,
    });

    // Translate response to OpenAI format
    return geminiResponseToOpenai(geminiResponse);
}

/**
 * Call Gemini streaming using the @google/genai SDK.
 * Returns a synthetic Response object that mimics SSE streaming.
 */
async function callGeminiSDKStream(ctx, requestBody) {
    const ai = await getGeminiClient();
    const { systemInstruction, contents } = openaiMessagesToGemini(requestBody.messages);
    const geminiTools = openaiToolsToGemini(requestBody.tools);

    const generateConfig = {};
    if (requestBody.temperature !== undefined) {
        generateConfig.temperature = requestBody.temperature;
    }
    if (geminiTools) {
        generateConfig.tools = geminiTools;
    }
    if (systemInstruction) {
        generateConfig.systemInstruction = systemInstruction;
    }

    // Use generateContentStream for real streaming
    const streamResult = await ai.models.generateContentStream({
        model: ctx.model,
        contents: contents,
        config: generateConfig,
    });

    // Create a ReadableStream that wraps the Gemini async iterator
    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            try {
                for await (const chunk of streamResult) {
                    const text = chunk.text || '';
                    if (text) {
                        // Emit SSE-formatted data matching OpenAI streaming format
                        const sseData = JSON.stringify({
                            choices: [{
                                delta: { content: text },
                                index: 0,
                            }],
                        });
                        controller.enqueue(encoder.encode(`data: ${sseData}\n\n`));
                    }
                }
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
            } catch (err) {
                controller.error(err);
            }
        },
    });

    // Return a synthetic Response object
    return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
    });
}

// ─── OpenAI/Local REST Calls ─────────────────────────────────────────────

/**
 * Call OpenAI or local server using REST
 */
async function callOpenAIREST(ctx, requestBody, signal) {
    const body = transformRequestBody(ctx.provider, requestBody);

    const response = await fetch(ctx.endpoint, {
        method: 'POST',
        headers: ctx.headers,
        body: JSON.stringify(body),
        signal,
    });

    if (!response.ok) {
        const providerLabel = ctx.provider === AI_PROVIDERS.LMSTUDIO
            ? 'LMStudio AI server (is LMStudio running?)'
            : `${ctx.provider} API`;
        throw new Error(`${providerLabel} Error: ${response.status} - ${response.statusText}`);
    }

    return response.json();
}

// ─── Anthropic Vertex SDK Calls ──────────────────────────────────────────

/**
 * Call Anthropic using the @anthropic-ai/vertex-sdk
 */
async function callAnthropicVertexSDK(ctx, requestBody) {
    const ai = await getAnthropicClient();
    const { system, messages } = openaiMessagesToAnthropic(requestBody.messages);
    const anthropicTools = openaiToolsToAnthropic(requestBody.tools);

    const callParams = {
        model: ctx.model,
        messages: messages,
        max_tokens: requestBody.max_tokens || 8192,
        temperature: requestBody.temperature,
    };

    if (system) {
        callParams.system = system;
    }

    if (anthropicTools && anthropicTools.length > 0) {
        callParams.tools = anthropicTools;
    }

    const response = await ai.messages.create(callParams);

    // Translate response to OpenAI format
    return anthropicResponseToOpenai(response);
}

// ─── OpenAI ↔ Anthropic Format Translation ────────────────────────────────

/**
 * Convert OpenAI tools to Anthropic tools
 */
function openaiToolsToAnthropic(tools) {
    if (!tools || tools.length === 0) return undefined;

    return tools
        .filter(t => t.type === 'function' && t.function)
        .map(t => ({
            name: t.function.name,
            description: t.function.description || '',
            input_schema: t.function.parameters
        }));
}

/**
 * Convert OpenAI messages to Anthropic format
 */
function openaiMessagesToAnthropic(messages) {
    // Collect ALL system messages and concatenate them (same fix as Gemini).
    // Previously only the last system message survived, causing role confusion.
    const systemParts = [];
    const anthropicMessages = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            if (msg.content) {
                systemParts.push(msg.content);
            }
            continue;
        }

        if (msg.role === 'user') {
            anthropicMessages.push({
                role: 'user',
                content: msg.content
            });
            continue;
        }

        if (msg.role === 'assistant') {
            const content = [];
            
            if (msg.content) {
                content.push({ type: 'text', text: msg.content });
            }
            
            if (msg.tool_calls) {
                for (const tc of msg.tool_calls) {
                    let input = {};
                    try {
                        input = typeof tc.function.arguments === 'string'
                            ? JSON.parse(tc.function.arguments)
                            : tc.function.arguments;
                    } catch {}
                    
                    content.push({
                        type: 'tool_use',
                        id: tc.id,
                        name: tc.function.name,
                        input: input
                    });
                }
            }
            
            anthropicMessages.push({
                role: 'assistant',
                content: content
            });
            continue;
        }

        if (msg.role === 'tool') {
            anthropicMessages.push({
                role: 'user',
                content: [{
                    type: 'tool_result',
                    tool_use_id: msg.tool_call_id,
                    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
                }]
            });
            continue;
        }
    }

    const system = systemParts.length > 0
        ? systemParts.join('\n\n---\n\n')
        : undefined;

    return { system, messages: anthropicMessages };
}

/**
 * Convert Anthropic response to OpenAI format
 */
function anthropicResponseToOpenai(response) {
    const message = { role: 'assistant' };
    const toolCalls = [];
    let content = '';

    for (const block of response.content) {
        if (block.type === 'text') {
            content += block.text;
        } else if (block.type === 'tool_use') {
            toolCalls.push({
                id: block.id,
                type: 'function',
                function: {
                    name: block.name,
                    arguments: JSON.stringify(block.input)
                }
            });
        }
    }

    if (content) message.content = content;
    else message.content = null;

    if (toolCalls.length > 0) {
        message.tool_calls = toolCalls;
    }

    return {
        choices: [{
            index: 0,
            message: message,
            finish_reason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop'
        }],
        usage: {
            prompt_tokens: response.usage?.input_tokens || 0,
            completion_tokens: response.usage?.output_tokens || 0,
            total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
        }
    };
}

// ─── WebLLM Browser Bridge ──────────────────────────────────────────────

/**
 * Route an AI request to the browser-side WebLLM engine via EventBus.
 * The server emits 'webllm:generate' on the event bus, which gets broadcast
 * to the WS client. The UI runs the model via @mlc-ai/web-llm and sends
 * 'webllm:response' back, which resolves the pending promise.
 *
 * @param {Object} requestBody — OpenAI-compatible request body
 * @returns {Promise<Object>} OpenAI-compatible response
 */
async function callWebLLM(requestBody) {
    if (!_eventBus) {
        throw new Error('WebLLM requires a connected browser client. Open the Oboto UI in your browser.');
    }

    const requestId = `webllm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const TIMEOUT_MS = 300000; // 5 minutes — local models can be slow

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            _webllmPending.delete(requestId);
            reject(new Error('WebLLM request timed out. Make sure the browser tab is open and the model is loaded.'));
        }, TIMEOUT_MS);

        _webllmPending.set(requestId, { resolve, reject, timer });

        // Emit request to be broadcast to WS clients
        _eventBus.emitTyped('webllm:generate', {
            requestId,
            model: requestBody.model || config.ai.model,
            messages: requestBody.messages,
            temperature: requestBody.temperature,
            max_tokens: requestBody.max_tokens,
            // Note: tool calling not supported in WebLLM for most models
        });
    });
}

// ─── Cloud Fallback Helpers ──────────────────────────────────────────────

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
    // Anthropic requires Vertex credentials (ADC), not a simple key check
    if (config.vertex?.projectId) {
        return { provider: AI_PROVIDERS.ANTHROPIC, model: 'claude-sonnet-4-20250514' };
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
    if (ctx.provider === AI_PROVIDERS.ANTHROPIC) {
        return await callAnthropicVertexSDK(ctx, { ...requestBody, model: ctx.model });
    }
    return await callOpenAIREST(ctx, { ...requestBody, model: ctx.model }, options.signal);
}

// ─── Utility Functions ───────────────────────────────────────────────────

/**
 * Get a human-readable label for the current provider setup
 * @param {string} [model] - Optional model override
 * @returns {string} Description like "Gemini (gemini-2.0-flash)"
 */
export function getProviderLabel(model) {
    const ctx = createProviderContext(model);
    const labels = {
        [AI_PROVIDERS.CLOUD]: 'Cloud',
        [AI_PROVIDERS.WEBLLM]: 'WebLLM',
        [AI_PROVIDERS.LMSTUDIO]: 'LMStudio',
        [AI_PROVIDERS.OPENAI]: 'OpenAI',
        [AI_PROVIDERS.GEMINI]: 'Gemini',
        [AI_PROVIDERS.ANTHROPIC]: 'Anthropic',
    };
    return `${labels[ctx.provider] || ctx.provider} (${ctx.model})`;
}
