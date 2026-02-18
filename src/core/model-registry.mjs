// Model Registry
// Maintains a catalog of known AI models with their capabilities, context limits, and provider info.
// Fetches actual model lists from provider APIs (OpenAI, Gemini) when keys are configured.
// Users can register custom models at runtime (e.g. for local Ollama/LMStudio models).

import { config } from '../config.mjs';

/**
 * @typedef {Object} ModelCapabilities
 * @property {string}  provider              - Provider key: 'openai' | 'gemini' | 'anthropic' | 'local'
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

// Models fetched from live provider APIs
let _remoteModels = {};

// Runtime-registered custom models
const _customModels = {};

// Whether remote models have been fetched at least once
let _remoteFetched = false;

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
 * Fetch live model lists from all configured providers.
 * Merges results into `_remoteModels`. Falls back to FALLBACK_MODELS for
 * providers without API keys or on fetch failure.
 * @returns {Promise<void>}
 */
export async function fetchRemoteModels() {
    const [openai, gemini] = await Promise.all([
        fetchOpenAIModels(),
        fetchGeminiModels(),
    ]);

    _remoteModels = { ...openai, ...gemini };
    _remoteFetched = true;

    const total = Object.keys(_remoteModels).length;
    if (total > 0) {
        console.log(`[model-registry] Remote model registry updated: ${total} models`);
    } else {
        console.log(`[model-registry] No remote models fetched — using fallback list`);
    }
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
    if (!modelId) return 'local';
    const m = modelId.toLowerCase();
    if (m.startsWith('gemini-') || m.startsWith('models/gemini-')) return 'gemini';
    if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'openai';
    if (m.startsWith('claude-')) return 'anthropic';
    return 'local';
}

/**
 * Returns the effective built-in models map — remote if fetched, otherwise fallback.
 */
function _getBuiltInModels() {
    if (_remoteFetched && Object.keys(_remoteModels).length > 0) {
        // Merge: remote models take priority, but include Anthropic fallbacks
        // since Anthropic has no public list API
        const anthropicFallbacks = {};
        for (const [id, caps] of Object.entries(FALLBACK_MODELS)) {
            if (caps.provider === 'anthropic') anthropicFallbacks[id] = caps;
        }
        return { ...anthropicFallbacks, ..._remoteModels };
    }
    return FALLBACK_MODELS;
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
