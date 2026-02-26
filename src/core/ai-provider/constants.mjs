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
export const PROVIDER_ENDPOINTS = {
    [AI_PROVIDERS.LMSTUDIO]: 'http://localhost:1234/v1/chat/completions',
    [AI_PROVIDERS.OPENAI]: 'https://api.openai.com/v1/chat/completions',
    // Gemini uses SDK, not REST endpoint — this is only a fallback
    [AI_PROVIDERS.GEMINI]: null,
    // Anthropic via Vertex uses SDK
    [AI_PROVIDERS.ANTHROPIC]: null,
};

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
