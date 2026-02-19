/**
 * LLM Authentication / API Key Error Detection
 * 
 * Detects common LLM provider authentication, authorization, and missing-key
 * errors so the server can redirect users to the secrets configuration view.
 */

/**
 * Error message patterns that indicate an LLM authentication or API key issue.
 * Each pattern is tested case-insensitively against the error message.
 */
const LLM_AUTH_ERROR_PATTERNS = [
    // HTTP status codes
    /\b401\b/,                           // Unauthorized
    /\b403\b.*(?:api|key|auth|forbid)/i, // Forbidden (only when API/key/auth related)

    // Generic key/auth phrases
    /invalid.*api.?key/i,
    /api.?key.*invalid/i,
    /incorrect.*api.?key/i,
    /missing.*api.?key/i,
    /api.?key.*missing/i,
    /api.?key.*not\s+(?:found|set|configured|provided)/i,
    /no\s+api.?key/i,
    /authentication\s+failed/i,
    /auth.*fail/i,
    /unauthorized/i,
    /unauthenticated/i,

    // Provider-specific patterns
    /OPENAI_API_KEY/,
    /ANTHROPIC_API_KEY/,
    /GOOGLE_API_KEY/,
    /GEMINI.*key/i,
    /openai.*error:\s*401/i,
    /anthropic.*error:\s*401/i,
    /permission\s+denied.*api/i,

    // SDK error patterns
    /Could not process API key/i,
    /API key not valid/i,
    /API_KEY_INVALID/i,
    /INVALID_ARGUMENT.*key/i,
    /PermissionDenied/,
    /Request had invalid authentication credentials/i,

    // Provider connection issues that likely indicate missing config
    /LMStudio AI server.*is LMStudio running/i,
    /ECONNREFUSED.*1234/,               // Default LMStudio port
];

/**
 * Check whether an error (string or Error object) indicates an LLM
 * authentication / API key configuration problem.
 * 
 * @param {Error|string} error — the error to inspect
 * @returns {boolean} true if the error matches known LLM auth error patterns
 */
export function isLLMAuthError(error) {
    const message = typeof error === 'string' ? error : (error?.message || '');
    const stack = typeof error === 'string' ? '' : (error?.stack || '');
    const combined = `${message} ${stack}`;

    return LLM_AUTH_ERROR_PATTERNS.some(pattern => pattern.test(combined));
}

/**
 * Build a structured payload for the `llm-auth-error` WebSocket message.
 * 
 * @param {Error|string} error — the original error
 * @param {string} [context='chat'] — where the error occurred ('chat', 'agent-loop', 'task')
 * @returns {{ errorMessage: string, context: string, suggestion: string }}
 */
export function buildLLMAuthErrorPayload(error, context = 'chat') {
    const message = typeof error === 'string' ? error : (error?.message || 'Unknown LLM error');

    let suggestion;
    if (/LMStudio|ECONNREFUSED.*1234/i.test(message)) {
        suggestion = 'It looks like LMStudio is not running or unreachable. Either start LMStudio, or configure a different AI provider (OpenAI, Gemini, Anthropic) in the Secrets settings.';
    } else if (/OPENAI|openai/i.test(message)) {
        suggestion = 'Your OpenAI API key appears to be missing or invalid. Please configure a valid OPENAI_API_KEY in the Secrets settings.';
    } else if (/ANTHROPIC|anthropic|claude/i.test(message)) {
        suggestion = 'Your Anthropic API key appears to be missing or invalid. Please configure a valid ANTHROPIC_API_KEY in the Secrets settings.';
    } else if (/GOOGLE|GEMINI|gemini/i.test(message)) {
        suggestion = 'Your Google/Gemini API key appears to be missing or invalid. Please configure a valid GOOGLE_API_KEY in the Secrets settings.';
    } else {
        suggestion = 'Your LLM API key appears to be missing or invalid. Please open the Secrets settings and configure the appropriate API key for your chosen AI provider.';
    }

    return {
        errorMessage: message,
        context,
        suggestion
    };
}
