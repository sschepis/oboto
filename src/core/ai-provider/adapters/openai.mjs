import { AI_PROVIDERS } from '../constants.mjs';
import { withRetry } from '../utils.mjs';

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
 * Call OpenAI or local server using REST (non-streaming)
 */
export async function callOpenAIREST(ctx, requestBody, signal) {
    const body = transformRequestBody(ctx.provider, requestBody);

    // Combine caller-provided signal with a 60s per-call timeout so requests
    // don't hang indefinitely even when no user-cancellation signal is present.
    const PER_CALL_TIMEOUT = 60_000;
    const timeoutSignal = AbortSignal.timeout(PER_CALL_TIMEOUT);
    const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;

    const response = await withRetry(() => fetch(ctx.endpoint, {
        method: 'POST',
        headers: ctx.headers,
        body: JSON.stringify(body),
        signal: combinedSignal,
    }));

    if (!response.ok) {
        const providerLabel = ctx.provider === AI_PROVIDERS.LMSTUDIO
            ? 'LMStudio AI server (is LMStudio running?)'
            : `${ctx.provider} API`;
        throw new Error(`${providerLabel} Error: ${response.status} - ${response.statusText}`);
    }

    return response.json();
}

/**
 * Call OpenAI or local server using REST with SSE streaming.
 * Returns the raw Response object so the caller can read the SSE stream.
 * Does NOT apply a per-call timeout since streaming connections must stay
 * open for the entire generation duration (which can exceed 60s).
 */
export async function callOpenAIRESTStream(ctx, requestBody, signal) {
    const body = transformRequestBody(ctx.provider, { ...requestBody, stream: true });

    // Only use the caller's abort signal — no timeout for streaming connections
    const response = await withRetry(() => fetch(ctx.endpoint, {
        method: 'POST',
        headers: ctx.headers,
        body: JSON.stringify(body),
        signal,
    }));

    if (!response.ok) {
        const providerLabel = ctx.provider === AI_PROVIDERS.LMSTUDIO
            ? 'LMStudio AI server (is LMStudio running?)'
            : `${ctx.provider} API`;
        throw new Error(`${providerLabel} Error: ${response.status} - ${response.statusText}`);
    }

    return response;
}
