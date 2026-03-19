// Anthropic adapter using the Vertex SDK (@anthropic-ai/vertex-sdk).
// Shared translation utilities live in anthropic-shared.mjs.
import AnthropicVertex from '@anthropic-ai/vertex-sdk';
import { config } from '../../../config.mjs';
import {
    sanitizeInputSchema,
    translateMessages,
    buildAnthropicBody,
    mapFinishReason,
    anthropicResponseToOpenai,
} from './anthropic-shared.mjs';

// ─── Vertex SDK Client Singleton ─────────────────────────────────────────

let _client = null;

/**
 * Get (or lazily create) the AnthropicVertex SDK client singleton.
 * Uses Google ADC for authentication — no API key required.
 *
 * @returns {AnthropicVertex} The configured client instance
 */
function getClient() {
    if (!_client) {
        const projectId = config.vertex?.projectId
            || process.env.VERTEX_PROJECT_ID
            || process.env.GOOGLE_CLOUD_PROJECT;
        const region = config.vertex?.region
            || process.env.VERTEX_REGION
            || 'us-east5';

        if (!projectId) {
            throw new Error(
                'VERTEX_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) must be set for Anthropic/Vertex AI'
            );
        }

        _client = new AnthropicVertex({ projectId, region });
    }
    return _client;
}

/**
 * Reset the cached Anthropic client singleton.
 * Call this when credentials or project configuration change at runtime
 * so the next API call creates a fresh client with updated settings.
 */
export function resetAnthropicClient() {
    _client = null;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Call Anthropic Messages API via Vertex SDK (non-streaming).
 * Matches the interface of callOpenAIREST(ctx, requestBody, signal).
 *
 * @param {Object} ctx - Provider context { provider, endpoint, headers, model, apiKey? }
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Object>} OpenAI-compatible parsed JSON response
 */
export async function callAnthropicREST(ctx, requestBody, signal) {
    let params;
    try {
        const client = getClient();
        params = buildAnthropicBody(requestBody, requestBody.model || ctx.model);

        // Use streaming internally to avoid the Anthropic SDK's
        // "Streaming is required for operations that may take longer than
        // 10 minutes" error. The stream is collected into a single response
        // to maintain the non-streaming callProvider contract.
        const stream = client.messages.stream(params, {
            ...(signal && { signal }),
        });
        const response = await stream.finalMessage();

        return anthropicResponseToOpenai(response);
    } catch (err) {
        // Enrich SDK errors with a clear prefix
        if (err.status || err.error) {
            const detail = err.error?.message || err.message || String(err);
            const errMsg = `Anthropic/Vertex API Error (${err.status || 'unknown'}): ${detail}`;
            // For schema validation errors, log the offending tool schemas to aid debugging
            if (detail.includes('input_schema') && params?.tools) {
                const toolNames = params.tools.map((t, i) => `  [${i}] ${t.name}`).join('\n');
                console.error(`[Anthropic] Schema validation failed. Tools sent:\n${toolNames}`);
            }
            throw new Error(errMsg);
        }
        throw err;
    }
}

/**
 * Call Anthropic Messages API via Vertex SDK with streaming.
 * Returns a synthetic Response object whose body emits OpenAI-format SSE
 * data, matching the contract of callOpenAIRESTStream.
 *
 * @param {Object} ctx - Provider context
 * @param {Object} requestBody - OpenAI-compatible request body
 * @param {AbortSignal|null} signal - Abort signal for cancellation
 * @returns {Promise<Response>} Synthetic Response with SSE body in OpenAI format
 */
export async function callAnthropicRESTStream(ctx, requestBody, signal) {
    const client = getClient();
    const params = buildAnthropicBody(requestBody, requestBody.model || ctx.model);

    const sdkStream = client.messages.stream(params, {
        ...(signal && { signal }),
    });

    // Wrap the SDK stream as a ReadableStream emitting OpenAI-format SSE chunks.
    // Tracks in-progress tool_use blocks to assemble their input JSON.
    const readable = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            // Track active tool_use blocks by content_block index
            const activeToolBlocks = new Map();
            let toolCallIndex = 0;

            try {
                for await (const event of sdkStream) {
                    if (signal?.aborted) break;

                    // ── Text deltas ─────────────────────────────────
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

                    // ── Tool use: block start ───────────────────────
                    } else if (event.type === 'content_block_start' &&
                               event.content_block?.type === 'tool_use') {
                        const block = event.content_block;
                        const tcIdx = toolCallIndex++;
                        activeToolBlocks.set(event.index, { id: block.id, name: block.name, inputParts: [], tcIdx });

                        // Emit the initial tool_call chunk (name + id, no arguments yet)
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

                    // ── Tool use: input JSON deltas ─────────────────
                    } else if (event.type === 'content_block_delta' &&
                               event.delta?.type === 'input_json_delta' &&
                               event.delta?.partial_json != null) {
                        const tracked = activeToolBlocks.get(event.index);
                        if (tracked) {
                            tracked.inputParts.push(event.delta.partial_json);
                            // Stream argument fragments to match OpenAI streaming format
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

                    // ── Block stop (clean up tracking) ──────────────
                    } else if (event.type === 'content_block_stop') {
                        activeToolBlocks.delete(event.index);

                    // ── Message delta (stop reason) ─────────────────
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

                    // ── Message stop ────────────────────────────────
                    } else if (event.type === 'message_stop') {
                        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    }
                }
            } catch (err) {
                if (err.name === 'AbortError') {
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

    // Return a synthetic Response matching the OpenAI SSE contract
    return new Response(readable, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
    });
}
