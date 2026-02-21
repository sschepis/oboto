// Model Registry
// Maintains a catalog of known AI models with their capabilities, context limits, and provider info.
// Fetches actual model lists from provider APIs (OpenAI, Gemini) when keys are configured.
// Users can register custom models at runtime (e.g. for local Ollama/LMStudio models).

import { config } from '../config.mjs';

/**
 * @typedef {Object} ModelCapabilities
 * @property {string}  provider              - Provider key: 'openai' | 'gemini' | 'anthropic' | 'lmstudio'
 * @property {number}  contextWindow         - Max input tokens
 * @property {number}  maxOutputTokens       - Max output tokens
 * @property {boolean} supportsToolCalling   - Whether the model supports function/tool calling
 * @property {boolean} supportsStreaming      - Whether the model supports streaming responses
 * @property {boolean} supportsReasoningEffort - Whether the model supports reasoning_effort parameter
 * @property {'cheap'|'medium'|'expensive'} costTier - Relative cost category
 * @property {'low'|'medium'|'high'} reasoningCapability - Relative reasoning quality
 */

/**
 * Fallback models used ONLY when API keys are not configured or API calls fail.
 * When keys are available, real model lists are fetched from provider APIs.
 */
const FALLBACK_MODELS = {
    // ── OpenAI (fallback) ────────────────────────────────────
    'gpt-4o': {
        provider: 'openai',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsReasoningEffort: false,
        costTier: 'medium',
        reasoningCapability: 'high',
    },
    // ── Gemini (fallback) ────────────────────────────────────
    'gemini-2.0-flash': {
        provider: 'gemini',
        contextWindow: 1048576,
        maxOutputTokens: 8192,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsReasoningEffort: false,
        costTier: 'cheap',
        reasoningCapability: 'medium',
    },
    // ── Anthropic (fallback — no list API available) ─────────
    'claude-sonnet-4-20250514': {
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutputTokens: 64000,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsReasoningEffort: false,
        costTier: 'medium',
        reasoningCapability: 'high',
    },
    'claude-opus-4-20250514': {
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutputTokens: 32000,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsReasoningEffort: false,
        costTier: 'expensive',
        reasoningCapability: 'high',
    },
    'claude-haiku-3-5-20241022': {
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsReasoningEffort: false,
        costTier: 'cheap',
        reasoningCapability: 'medium',
    },
};

/**
 * Well-known Anthropic models available via Vertex AI.
 * Anthropic has no public model listing API, so these are curated.
 * Updated periodically as new models become available.
 */
const ANTHROPIC_KNOWN_MODELS = {
    'claude-opus-4-20250514': {
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutputTokens: 32000,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsReasoningEffort: false,
        costTier: 'expensive',
        reasoningCapability: 'high',
        displayName: 'Claude Opus 4',
        _fromAPI: true,
    },
    'claude-sonnet-4-20250514': {
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutputTokens: 64000,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsReasoningEffort: false,
        costTier: 'medium',
        reasoningCapability: 'high',
        displayName: 'Claude Sonnet 4',
        _fromAPI: true,
    },
    'claude-3-7-sonnet-20250219': {
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutputTokens: 64000,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsReasoningEffort: true,
        costTier: 'medium',
        reasoningCapability: 'high',
        displayName: 'Claude 3.7 Sonnet',
        _fromAPI: true,
    },
    'claude-3-5-sonnet-v2@20241022': {
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsReasoningEffort: false,
        costTier: 'medium',
        reasoningCapability: 'high',
        displayName: 'Claude 3.5 Sonnet v2',
        _fromAPI: true,
    },
    'claude-3-5-haiku@20241022': {
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsReasoningEffort: false,
        costTier: 'cheap',
        reasoningCapability: 'medium',
        displayName: 'Claude 3.5 Haiku',
        _fromAPI: true,
    },
    'claude-3-opus@20240229': {
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsReasoningEffort: false,
        costTier: 'expensive',
        reasoningCapability: 'high',
        displayName: 'Claude 3 Opus',
        _fromAPI: true,
    },
    'claude-3-haiku@20240307': {
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsReasoningEffort: false,
        costTier: 'cheap',
        reasoningCapability: 'medium',
        displayName: 'Claude 3 Haiku',
        _fromAPI: true,
    },
};

// Models fetched from live provider APIs
let _remoteModels = {};

// Runtime-registered custom models
const _customModels = {};

// Whether remote models have been fetched at least once
let _remoteFetched = false;

// Debounce tracker for per-provider fetches (prevents spam from UI re-renders)
const _providerFetchTimestamps = {};
const PROVIDER_FETCH_DEBOUNCE_MS = 10_000; // 10 seconds minimum between fetches for same provider

// ─── OpenAI Model Prefixes We Care About ─────────────────────────────────
// Filter out embeddings, tts, dall-e, whisper, moderation, etc.
const OPENAI_CHAT_PREFIXES = ['gpt-', 'o1', 'o3', 'o4', 'chatgpt-'];

/**
 * Fetch available models from OpenAI's /v1/models endpoint.
 * @returns {Promise<Object>} Map of modelId → capabilities
 */
async function fetchOpenAIModels() {
    const apiKey = config.keys.openai;
    if (!apiKey) return {};

    try {
        const resp = await fetch('https://api.openai.com/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        if (!resp.ok) {
            console.warn(`[model-registry] OpenAI models API returned ${resp.status}`);
            return {};
        }
        const json = await resp.json();
        const models = {};

        for (const m of json.data || []) {
            const id = m.id;
            // Only include chat/completion models
            if (!OPENAI_CHAT_PREFIXES.some(p => id.startsWith(p))) continue;
            // Skip snapshot/dated variants that clutter the list (keep base names)
            // e.g. keep "gpt-4o" but skip "gpt-4o-2024-08-06" unless the base doesn't exist
            models[id] = {
                provider: 'openai',
                contextWindow: 128000, // OpenAI API doesn't expose this; use reasonable default
                maxOutputTokens: 16384,
                supportsToolCalling: true,
                supportsStreaming: true,
                supportsReasoningEffort: id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4'),
                costTier: id.includes('mini') || id.includes('nano') ? 'cheap' : 'medium',
                reasoningCapability: id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4') || id.includes('gpt-4') ? 'high' : 'medium',
                _fromAPI: true,
            };
        }
        console.log(`[model-registry] Fetched ${Object.keys(models).length} models from OpenAI API`);
        return models;
    } catch (err) {
        console.warn(`[model-registry] Failed to fetch OpenAI models: ${err.message}`);
        return {};
    }
}

/**
 * Fetch available models from Google Gemini using @google/genai SDK.
 * @returns {Promise<Object>} Map of modelId → capabilities
 */
async function fetchGeminiModels() {
    const apiKey = config.keys.google;
    if (!apiKey) return {};

    try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });
        const pager = await ai.models.list({ pageSize: 100 });
        const models = {};

        for await (const m of pager) {
            // Model name comes as "models/gemini-2.5-pro" — strip the prefix
            const rawName = m.name || '';
            const id = rawName.replace(/^models\//, '');
            if (!id) continue;

            // Only include generative models (skip embedding, code-execution-only, etc.)
            // The Gemini API returns all model types; filter to gemini-* chat models
            if (!id.startsWith('gemini-')) continue;

            models[id] = {
                provider: 'gemini',
                contextWindow: m.inputTokenLimit || 1048576,
                maxOutputTokens: m.outputTokenLimit || 8192,
                supportsToolCalling: true,
                supportsStreaming: true,
                supportsReasoningEffort: false,
                costTier: id.includes('flash') || id.includes('lite') ? 'cheap' : 'medium',
                reasoningCapability: id.includes('pro') ? 'high' : 'medium',
                displayName: m.displayName || id,
                _fromAPI: true,
            };
        }
        console.log(`[model-registry] Fetched ${Object.keys(models).length} models from Gemini API`);
        return models;
    } catch (err) {
        console.warn(`[model-registry] Failed to fetch Gemini models: ${err.message}`);
        return {};
    }
}

/**
 * Fetch available models from LM Studio's /v1/models endpoint (OpenAI-compatible).
 * Tries the OpenAI-compatible endpoint first, then falls back to the native LMStudio API.
 * @returns {Promise<Object>} Map of modelId → capabilities
 */
async function fetchLMStudioModels() {
    // Determine base URL from config or default to localhost:1234
    let baseUrl = 'http://localhost:1234';
    const configuredEndpoint = config.ai.endpoint;

    if (configuredEndpoint) {
        try {
            // If endpoint includes path (e.g. /v1/chat/completions), extract origin
            const url = new URL(configuredEndpoint);
            baseUrl = `${url.protocol}//${url.host}`;
        } catch (e) {
            // Invalid URL, use default
        }
    }

    // LM Studio uses OpenAI-compatible headers if key is set
    const headers = { 'Content-Type': 'application/json' };
    if (config.keys.openai) {
        headers['Authorization'] = `Bearer ${config.keys.openai}`;
    }

    // Endpoints to try, in order of preference
    const endpoints = [
        `${baseUrl}/v1/models`,       // OpenAI-compatible (most common)
        `${baseUrl}/api/v1/models`,    // Native LMStudio API
    ];

    let json = null;

    for (const endpoint of endpoints) {
        try {
            const resp = await fetch(endpoint, { headers, signal: AbortSignal.timeout(5000) });
            if (resp.ok) {
                json = await resp.json();
                break;
            }
        } catch (err) {
            // Connection refused, timeout, or other network error — try next endpoint
            continue;
        }
    }

    if (!json) {
        // LM Studio not running or unreachable — expected, fail silently
        return {};
    }

    const models = {};

    // LM Studio /v1/models returns { data: [{ id, object, owned_by }, ...] }
    for (const m of json.data || []) {
        const id = m.id;
        if (!id) continue;
        models[id] = {
            provider: 'lmstudio',
            // LM Studio models are local; context varies by loaded model
            contextWindow: m.context_window || m.max_context_length || 128000,
            maxOutputTokens: -1, // Usually limited by context window
            supportsToolCalling: true, // v1 API supports tools
            supportsStreaming: true,
            supportsReasoningEffort: false,
            costTier: 'free',
            reasoningCapability: 'medium',
            displayName: m.id, // Use the model ID as display name
            _fromAPI: true,
        };
    }

    const count = Object.keys(models).length;
    if (count > 0) {
        console.log(`[model-registry] Fetched ${count} models from LMStudio (${baseUrl})`);
    }
    return models;
}

/**
 * Fetch live model lists from all configured providers.
 * Merges results into `_remoteModels`. Falls back to FALLBACK_MODELS for
 * providers without API keys or on fetch failure.
 * @returns {Promise<void>}
 */
export async function fetchRemoteModels() {
    const [openai, gemini, lmstudio] = await Promise.all([
        fetchOpenAIModels(),
        fetchGeminiModels(),
        fetchLMStudioModels(),
    ]);

    // Anthropic has no list API — always include the curated known models
    const anthropicCount = Object.keys(ANTHROPIC_KNOWN_MODELS).length;
    if (anthropicCount > 0) {
        console.log(`[model-registry] Included ${anthropicCount} curated Anthropic models (no list API)`);
    }
    _remoteModels = { ...ANTHROPIC_KNOWN_MODELS, ...openai, ...gemini, ...lmstudio };
    _remoteFetched = true;

    const total = Object.keys(_remoteModels).length;
    if (total > 0) {
        console.log(`[model-registry] Remote model registry updated: ${total} models`);
    } else {
        console.log(`[model-registry] No remote models fetched — using fallback list`);
    }
}

/**
 * Fetch models for a specific provider only.
 * Useful for refreshing a single provider's model list without re-fetching all.
 * @param {string} provider - Provider key: 'openai' | 'gemini' | 'anthropic' | 'lmstudio'
 * @returns {Promise<Object>} Map of modelId → capabilities for that provider
 */
export async function fetchModelsForProvider(provider) {
    // Debounce: skip if we fetched this provider recently
    const now = Date.now();
    const lastFetch = _providerFetchTimestamps[provider] || 0;
    if (now - lastFetch < PROVIDER_FETCH_DEBOUNCE_MS) {
        // Return existing models for this provider silently
        const existing = {};
        for (const [id, caps] of Object.entries(_remoteModels)) {
            if (caps.provider === provider) existing[id] = caps;
        }
        return existing;
    }
    _providerFetchTimestamps[provider] = now;

    let fetched = {};

    switch (provider) {
        case 'openai':
            fetched = await fetchOpenAIModels();
            break;
        case 'gemini':
            fetched = await fetchGeminiModels();
            break;
        case 'lmstudio':
            fetched = await fetchLMStudioModels();
            break;
        case 'anthropic':
            // Anthropic has no list API — return the curated known models
            fetched = { ...ANTHROPIC_KNOWN_MODELS };
            break;
        default:
            console.warn(`[model-registry] Unknown provider: ${provider}`);
            return {};
    }

    // Merge into _remoteModels (replace models for this provider, keep others)
    // First remove existing models from this provider
    for (const [id, caps] of Object.entries(_remoteModels)) {
        if (caps.provider === provider) {
            delete _remoteModels[id];
        }
    }
    // Then add the newly fetched ones
    Object.assign(_remoteModels, fetched);
    _remoteFetched = true;

    const count = Object.keys(fetched).length;
    console.log(`[model-registry] Refreshed ${count} models for provider: ${provider}`);
    return fetched;
}

/**
 * Returns true if remote models have been successfully fetched at least once.
 */
export function isRemoteFetched() {
    return _remoteFetched;
}

/**
 * Infer provider from model name prefix.
 * @param {string} modelId
 * @returns {string} Provider key
 */
export function inferModelProvider(modelId) {
    if (!modelId) return 'lmstudio';
    const m = modelId.toLowerCase();
    if (m.startsWith('gemini-') || m.startsWith('models/gemini-')) return 'gemini';
    if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'openai';
    if (m.startsWith('claude-')) return 'anthropic';
    return 'lmstudio';
}

/**
 * Returns the effective built-in models map — remote if fetched, otherwise fallback.
 */
function _getBuiltInModels() {
    if (_remoteFetched && Object.keys(_remoteModels).length > 0) {
        // Remote models already include ANTHROPIC_KNOWN_MODELS (merged in fetchRemoteModels)
        return { ..._remoteModels };
    }
    // Before any remote fetch, include Anthropic known models with the fallbacks
    return { ...FALLBACK_MODELS, ...ANTHROPIC_KNOWN_MODELS };
}

/**
 * Get model info. Returns known capabilities or reasonable defaults for unknown models.
 * @param {string} modelId
 * @returns {ModelCapabilities}
 */
export function getModelInfo(modelId) {
    const builtIn = _getBuiltInModels();
    // Check exact match first
    if (builtIn[modelId]) return { id: modelId, ...builtIn[modelId] };
    if (_customModels[modelId]) return { id: modelId, ..._customModels[modelId] };

    // Try prefix match for versioned model names (e.g. 'claude-sonnet-4-20250514' → match)
    for (const [key, val] of Object.entries(builtIn)) {
        if (modelId.startsWith(key) || key.startsWith(modelId)) {
            return { id: modelId, ...val };
        }
    }
    for (const [key, val] of Object.entries(_customModels)) {
        if (modelId.startsWith(key) || key.startsWith(modelId)) {
            return { id: modelId, ...val };
        }
    }

    // Fall back to inferred defaults
    const provider = inferModelProvider(modelId);
    return {
        id: modelId,
        provider,
        contextWindow: 128000,
        maxOutputTokens: 8192,
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsReasoningEffort: false,
        costTier: 'medium',
        reasoningCapability: 'medium',
    };
}

/**
 * Register a custom model definition.
 * @param {string} modelId
 * @param {Partial<ModelCapabilities>} capabilities
 */
export function registerModel(modelId, capabilities) {
    const provider = capabilities.provider || inferModelProvider(modelId);
    _customModels[modelId] = {
        provider,
        contextWindow: capabilities.contextWindow || 128000,
        maxOutputTokens: capabilities.maxOutputTokens || 8192,
        supportsToolCalling: capabilities.supportsToolCalling !== false,
        supportsStreaming: capabilities.supportsStreaming !== false,
        supportsReasoningEffort: capabilities.supportsReasoningEffort || false,
        costTier: capabilities.costTier || 'medium',
        reasoningCapability: capabilities.reasoningCapability || 'medium',
    };
}

/**
 * Remove a custom model definition.
 * @param {string} modelId
 * @returns {boolean} True if removed
 */
export function unregisterModel(modelId) {
    if (_customModels[modelId]) {
        delete _customModels[modelId];
        return true;
    }
    return false;
}

/**
 * List all known models.
 * @param {{ provider?: string, supportsToolCalling?: boolean }} [filter]
 * @returns {Array<{ id: string } & ModelCapabilities>}
 */
export function listModels(filter = {}) {
    const all = { ..._getBuiltInModels(), ..._customModels };
    let entries = Object.entries(all).map(([id, caps]) => ({ id, ...caps }));

    if (filter.provider) {
        entries = entries.filter(m => m.provider === filter.provider);
    }
    if (filter.supportsToolCalling !== undefined) {
        entries = entries.filter(m => m.supportsToolCalling === filter.supportsToolCalling);
    }

    return entries;
}

/**
 * Get the serializable registry for sending to the UI.
 * @returns {Object} Map of modelId → capabilities
 */
export function getRegistrySnapshot() {
    const builtIn = _getBuiltInModels();
    // Strip internal _fromAPI flag before sending to UI
    const result = {};
    for (const [id, caps] of Object.entries({ ...builtIn, ..._customModels })) {
        const { _fromAPI, ...rest } = caps;
        result[id] = rest;
    }
    return result;
}
