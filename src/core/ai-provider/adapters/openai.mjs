import { AI_PROVIDERS } from '../constants.mjs';
import { withRetry } from '../utils.mjs';
import { consoleStyler } from '../../../ui/console-styler.mjs';

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
            // Local servers typically don't support reasoning_effort
            delete transformed.reasoning_effort;
            // Most local models don't support json_schema structured output;
            // downgrade to the simpler json_object mode so they still attempt JSON.
            if (transformed.response_format?.type === 'json_schema') {
                transformed.response_format = { type: 'json_object' };
            }
            break;
    }

    return transformed;
}

/**
 * Call OpenAI or local server using REST (non-streaming)
 */
export async function callOpenAIREST(ctx, requestBody, signal) {
    const body = transformRequestBody(ctx.provider, requestBody);

    // Combine caller-provided signal with a per-call timeout so requests
    // don't hang indefinitely even when no user-cancellation signal is present.
    // 180s accommodates local models (LMStudio) that can take 90-120s on
    // complex prompts with large context windows.
    const PER_CALL_TIMEOUT = 180_000;
    const timeoutSignal = AbortSignal.timeout(PER_CALL_TIMEOUT);
    const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;

    // Use a longer total timeout for LMStudio — local models can take 90-120s
    // on complex prompts.  Cloud providers keep the default 90s.
    const retryTimeout = ctx.provider === AI_PROVIDERS.LMSTUDIO ? 300_000 : undefined;
    const response = await withRetry(() => fetch(ctx.endpoint, {
        method: 'POST',
        headers: ctx.headers,
        body: JSON.stringify(body),
        signal: combinedSignal,
    }), 3, 2000, retryTimeout);

    // LMStudio: log the actual error body for debugging on 400
    if (!response.ok && response.status === 400 && ctx.provider === AI_PROVIDERS.LMSTUDIO) {
        try {
            const errorBody = await response.clone().text();
            consoleStyler.log('debug', `LMStudio 400 response: ${errorBody.substring(0, 500)}`);
        } catch { /* ignore logging errors */ }
    }

    // LMStudio (and other local servers) return 400 when the loaded model
    // doesn't support function/tool calling.  Retry once without the `tools`
    // field so the model can still generate a text-only response.
    if (!response.ok && response.status === 400 &&
        ctx.provider === AI_PROVIDERS.LMSTUDIO && body.tools) {
        // reasoning_effort is already removed by transformRequestBody() for
        // LMStudio, so we only strip tool-related and structured output fields.
        // Plain fetch (no withRetry) — the 400 is a deterministic capability
        // error ("model doesn't support tools"), not a transient network issue.
        const { tools: _stripped, tool_choice: _tc, response_format: _rf,
                ...bodyWithoutTools } = body;
        // Create a fresh timeout signal — the original combinedSignal's
        // timeout budget has been partially consumed by the first fetch.
        const retryTimeoutSignal = AbortSignal.timeout(PER_CALL_TIMEOUT);
        const retrySignal = signal
            ? AbortSignal.any([signal, retryTimeoutSignal])
            : retryTimeoutSignal;
        const retryResponse = await fetch(ctx.endpoint, {
            method: 'POST',
            headers: ctx.headers,
            body: JSON.stringify(bodyWithoutTools),
            signal: retrySignal,
        });
        if (retryResponse.ok) {
            return retryResponse.json();
        }
        // Both attempts failed — fall through to the error below using the
        // original response status for a more meaningful error message.
    }

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

    // Only use the caller's abort signal — no timeout for streaming connections.
    // LMStudio gets a longer total retry timeout to accommodate slow local models.
    const streamRetryTimeout = ctx.provider === AI_PROVIDERS.LMSTUDIO ? 300_000 : undefined;
    const response = await withRetry(() => fetch(ctx.endpoint, {
        method: 'POST',
        headers: ctx.headers,
        body: JSON.stringify(body),
        signal,
    }), 3, 2000, streamRetryTimeout);

    // LMStudio: retry without tools/unsupported params on 400
    if (!response.ok && response.status === 400 &&
        ctx.provider === AI_PROVIDERS.LMSTUDIO && body.tools) {
        try {
            const errorBody = await response.clone().text();
            consoleStyler.log('debug', `LMStudio stream 400 response: ${errorBody.substring(0, 500)}`);
        } catch { /* ignore */ }

        // reasoning_effort is already removed by transformRequestBody() for
        // LMStudio, so we only strip tool-related and structured output fields.
        // Plain fetch (no withRetry) — deterministic capability error, not transient.
        const { tools: _stripped, tool_choice: _tc, response_format: _rf,
                ...bodyWithoutTools } = body;
        // No per-call timeout for streaming — only the caller's abort signal.
        const retryResponse = await fetch(ctx.endpoint, {
            method: 'POST',
            headers: ctx.headers,
            body: JSON.stringify(bodyWithoutTools),
            signal,
        });
        if (retryResponse.ok) {
            return retryResponse;
        }
    }

    if (!response.ok) {
        const providerLabel = ctx.provider === AI_PROVIDERS.LMSTUDIO
            ? 'LMStudio AI server (is LMStudio running?)'
            : `${ctx.provider} API`;
        throw new Error(`${providerLabel} Error: ${response.status} - ${response.statusText}`);
    }

    return response;
}
