import { config } from '../../config.mjs';
import { consoleStyler } from '../../ui/console-styler.mjs';
import { AI_PROVIDERS, PROVIDER_ENDPOINTS } from './constants.mjs';
import { getModelInfo } from '../model-registry.mjs';

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

    // Anthropic Claude models — Vertex SDK was removed; route to OpenAI-compatible endpoint
    // (users can point their configured endpoint to an Anthropic-compatible proxy)
    if (m.startsWith('claude-')) {
        if (!detectProvider._claudeWarned) {
            detectProvider._claudeWarned = true;
            consoleStyler.log('warning', 'Anthropic Vertex SDK has been removed. Claude models will be routed to the configured OpenAI-compatible endpoint. Set AI_ENDPOINT to an Anthropic-compatible proxy if needed.');
        }
        return AI_PROVIDERS.OPENAI;
    }

    // OpenAI models
    if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4') || m.startsWith('chatgpt-')) {
        return AI_PROVIDERS.OPENAI;
    }

    // Cloud models: check if the model is registered as a cloud model in the
    // model registry (fetched from Oboto Cloud's AI gateway).
    try {
        const modelInfo = getModelInfo(model);
        if (modelInfo && modelInfo.provider === AI_PROVIDERS.CLOUD) {
            return AI_PROVIDERS.CLOUD;
        }
    } catch {
        // Model registry not yet initialized — fall through to config check
    }

    // If the user has explicitly configured the provider as 'cloud', honor it.
    // Cloud models have arbitrary names (e.g., "meta-llama/llama-3-70b") that
    // don't match any prefix above, so we must respect the explicit setting.
    if (config.ai.provider === AI_PROVIDERS.CLOUD) {
        consoleStyler.log('routing', `detectProvider: falling back to cloud for unrecognized model "${model}" (config.ai.provider is cloud)`);
        return AI_PROVIDERS.CLOUD;
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
    };
    return `${labels[ctx.provider] || ctx.provider} (${ctx.model})`;
}
