// Anthropic adapter using direct REST fetch against api.anthropic.com.
// Shared translation utilities live in anthropic-shared.mjs.
import { AI_PROVIDERS } from '../constants.mjs';
import { withRetry, isCancellationError } from '../utils.mjs';
import {
    sanitizeInputSchema,
    translateMessages,
    buildAnthropicBody,
    mapFinishReason,
    anthropicResponseToOpenai,
} from './anthropic-shared.mjs';

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Call Anthropic Messages API directly via REST (non-streaming).
 * Uses fetch() against api.anthropic.com instead of the Vertex SDK.
 *
 * @param {Object} ctx - Provider context { provider, endpoint, headers, model }
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Object>} OpenAI-compatible parsed JSON response
 */
export async function callAnthropicDirectREST(ctx, requestBody, signal) {
    const body = buildAnthropicBody(requestBody, requestBody.model || ctx.model);
    body.stream = false;

    const PER_CALL_TIMEOUT = 180_000;
    const timeoutSignal = AbortSignal.timeout(PER_CALL_TIMEOUT);
    const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;

    const response = await withRetry(() => fetch(ctx.endpoint, {
        method: 'POST',
        headers: ctx.headers,
        body: JSON.stringify(body),
        signal: combinedSignal,
    }), 3, 2000);

    if (!response.ok) {
        let detail = response.statusText;
        try {
            const errBody = await response.text();
            const parsed = JSON.parse(errBody);
            detail = parsed.error?.message || errBody.substring(0, 500);
        } catch { /* use statusText fallback */ }
        throw new Error(`Anthropic Direct API Error: ${response.status} - ${detail}`);
    }

    const anthropicResponse = await response.json();
    return anthropicResponseToOpenai(anthropicResponse);
}

/**
 * Call Anthropic Messages API directly via REST with SSE streaming.
 * Returns a synthetic Response whose body emits OpenAI-format SSE chunks.
 *
 * @param {Object} ctx - Provider context { provider, endpoint, headers, model }
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Response>} Synthetic Response with SSE body in OpenAI format
 */
export async function callAnthropicDirectRESTStream(ctx, requestBody, signal) {
    const body = buildAnthropicBody(requestBody, requestBody.model || ctx.model);
    body.stream = true;

    const PER_CALL_TIMEOUT = 180_000;
    const timeoutSignal = AbortSignal.timeout(PER_CALL_TIMEOUT);
    const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;

    const response = await withRetry(() => fetch(ctx.endpoint, {
        method: 'POST',
        headers: ctx.headers,
        body: JSON.stringify(body),
        signal: combinedSignal,
    }), 3, 2000);

    if (!response.ok) {
        let detail = response.statusText;
        try {
            const errBody = await response.text();
            const parsed = JSON.parse(errBody);
            detail = parsed.error?.message || errBody.substring(0, 500);
        } catch { /* use statusText fallback */ }
        throw new Error(`Anthropic Direct API Error: ${response.status} - ${detail}`);
    }

    // Transform the Anthropic SSE stream into OpenAI-compatible SSE.
    const anthropicBody = response.body;
    const readable = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            const decoder = new TextDecoder();
            const reader = anthropicBody.getReader();

            // Track active tool_use blocks by content_block index
            const activeToolBlocks = new Map();
            let toolCallIndex = 0;
            let buffer = '';

            try {
                while (true) {
                    if (signal?.aborted) break;

                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });

                    // Parse SSE lines from buffer
                    const lines = buffer.split('\n');
                    // Keep incomplete last line in buffer
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;
                        const data = line.slice(6).trim();
                        if (!data || data === '[DONE]') continue;

                        let event;
                        try {
                            event = JSON.parse(data);
                        } catch {
                            continue;
                        }

                        // ── Text deltas ─────────────────────────────
                        if (event.type === 'content_block_delta' &&
                            event.delta?.type === 'text_delta' &&
                            event.delta?.text) {
                            const chunk = JSON.stringify({
                                choices: [{
                                    index: 0,
                                    delta: { content: event.delta.text },
                                    finish_reason: null,
                                }],
                            });
                            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));

                        // ── Tool use: block start ───────────────────
                        } else if (event.type === 'content_block_start' &&
                                   event.content_block?.type === 'tool_use') {
                            const block = event.content_block;
                            const tcIdx = toolCallIndex++;
                            activeToolBlocks.set(event.index, {
                                id: block.id,
                                name: block.name,
                                tcIdx,
                            });

                            const chunk = JSON.stringify({
                                choices: [{
                                    index: 0,
                                    delta: {
                                        tool_calls: [{
                                            index: tcIdx,
                                            id: block.id,
                                            type: 'function',
                                            function: { name: block.name, arguments: '' },
                                        }],
                                    },
                                    finish_reason: null,
                                }],
                            });
                            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));

                        // ── Tool use: input JSON deltas ─────────────
                        } else if (event.type === 'content_block_delta' &&
                                   event.delta?.type === 'input_json_delta' &&
                                   event.delta?.partial_json != null) {
                            const tracked = activeToolBlocks.get(event.index);
                            if (tracked) {
                                const chunk = JSON.stringify({
                                    choices: [{
                                        index: 0,
                                        delta: {
                                            tool_calls: [{
                                                index: tracked.tcIdx,
                                                function: { arguments: event.delta.partial_json },
                                            }],
                                        },
                                        finish_reason: null,
                                    }],
                                });
                                controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                            }

                        // ── Block stop ───────────────────────────────
                        } else if (event.type === 'content_block_stop') {
                            activeToolBlocks.delete(event.index);

                        // ── Message delta (stop reason) ─────────────
                        } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
                            const finishReason = mapFinishReason(event.delta.stop_reason);
                            const chunk = JSON.stringify({
                                choices: [{
                                    index: 0,
                                    delta: {},
                                    finish_reason: finishReason,
                                }],
                            });
                            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));

                        // ── Message stop ─────────────────────────────
                        } else if (event.type === 'message_stop') {
                            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                        }
                    }
                }
            } catch (err) {
                if (isCancellationError(err)) {
                    // Clean shutdown on abort — not an error
                } else {
                    controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`)
                    );
                }
            } finally {
                controller.close();
            }
        },
    });

    return new Response(readable, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
    });
}
