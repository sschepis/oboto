import { config } from '../config.mjs';
import { callProvider, callProviderStream, isCancellationError } from './ai-provider.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';
import { SSEParser } from './agentic/sse-parser.mjs';

/**
 * Default maximum number of continuation requests when a response is
 * truncated at max_tokens (finish_reason === 'length').  Each continuation
 * appends the previous part as a separate assistant message and asks the
 * model to continue, so the final stitched response is seamless.
 */
const DEFAULT_MAX_CONTINUATIONS = 5;

/**
 * Maximum total character length for stitched responses.  If the
 * accumulated response exceeds this limit, stitching stops early to
 * prevent runaway memory/token usage.
 */
const DEFAULT_MAX_STITCH_LENGTH = 100_000;

/**
 * Eventic AI Plugin wrapping the existing ai-provider.mjs
 * Compatible with the Eventic Engine's expectations for an AI provider.
 */
export class EventicAIProvider {
    constructor(options = {}) {
        this.type = 'ai';
        this.model = options.model || config?.ai?.model || null;
        this.conversationHistory = [];
        this.timeout = options.timeout || 120000;
        this.systemPrompt = options.systemPrompt || null;

        /**
         * Maximum number of follow-up requests to stitch together when
         * a response is truncated at max_tokens.
         * @type {number}
         */
        this.maxStitchContinuations = options.maxStitchContinuations
            ?? config?.ai?.maxStitchContinuations
            ?? DEFAULT_MAX_CONTINUATIONS;
    }

    /**
     * Clears the conversation history stored in the provider.
     */
    clearHistory() {
        this.conversationHistory = [];
    }

    /**
     * Main interface for asking the AI a question.
     * @param {string} prompt - The user prompt
     * @param {Object} options - Options for the request (format, system, schema, tools)
     * @returns {Promise<any>} The AI response (string or JSON object)
     */
    async ask(prompt, options = {}) {
        const { format = 'text', system = null, schema = null, tools = null } = options;
        
        const messages = [];
        
        const activeSystemPrompt = system || this.systemPrompt;
        if (activeSystemPrompt) {
            messages.push({ role: 'system', content: activeSystemPrompt });
        }
        
        // Append previous history — but skip when recordHistory is false,
        // since these are stateless utility calls (e.g. next-steps generation)
        // that must not be contaminated by the main conversation context.
        if (options.recordHistory !== false) {
            messages.push(...this.conversationHistory);
        }
        
        let fullPrompt = prompt;
        // If JSON format is requested but no schema is provided, explicitly instruct the model
        if (format === 'json' && !schema) {
            fullPrompt += '\n\nRespond with valid JSON only. No markdown, no explanation, just the JSON.';
        }
        
        messages.push({ role: 'user', content: fullPrompt });

        return this._sendRequest(messages, prompt, options);
    }

    /**
     * Send a request with a pre-built messages array — does NOT touch
     * `this.conversationHistory`.  Use this when the caller manages its
     * own history (e.g. CognitiveAgent) to avoid mutating shared state.
     *
     * When the caller provides `onToken` or `onChunk` callbacks in
     * options, the request is automatically routed through the streaming
     * transport so tokens arrive incrementally.
     *
     * @param {Array<{role: string, content: string}>} messages - Full messages array
     * @param {Object} options - Same as ask() (format, system, schema, tools, signal, onToken, onChunk, etc.)
     * @returns {Promise<any>}
     */
    async askWithMessages(messages, options = {}) {
        // Ensure history is never written — caller manages its own.
        return this._sendRequest(messages, null, { ...options, recordHistory: false });
    }

    /**
     * Internal: send a prepared messages array to the LLM provider.
     * Automatically delegates to _sendStreamingRequest() when streaming
     * callbacks (onToken/onChunk) are provided.
     * @private
     */
    async _sendRequest(messages, prompt, options = {}) {
        const { format = 'text', schema = null, tools = null } = options;
        
        // Use per-request model override if provided, avoiding shared state mutation
        const effectiveModel = options.model || this.model;
        
        // Resolve max_tokens: per-request override > config > adapter default
        const maxTokens = options.max_tokens
            || config?.ai?.maxTokens
            || undefined; // Let the adapter use its own default

        const requestBody = {
            model: effectiveModel,
            messages,
            temperature: options.temperature !== undefined ? options.temperature : 0.7,
        };

        if (maxTokens) {
            requestBody.max_tokens = maxTokens;
        }

        // Format handling
        if (format === 'json') {
            if (schema) {
                // Use the standard OpenAI json_schema format.
                // Gemini and Cloud adapters extract .json_schema.schema as needed.
                requestBody.response_format = {
                    type: 'json_schema',
                    json_schema: {
                        name: 'response',
                        strict: true,
                        schema: schema
                    }
                };
            } else {
                requestBody.response_format = { type: 'json_object' };
            }
        }

        if (tools) {
            requestBody.tools = tools;
        }

        // Route to streaming when callbacks are provided
        const wantsStream = !!(options.stream || options.onToken || options.onChunk);
        if (wantsStream && (options.onToken || options.onChunk)) {
            requestBody.stream = true;
        }

        const combinedController = new AbortController();
        const timeoutId = setTimeout(() => combinedController.abort(), this.timeout);
        const onUserAbort = () => combinedController.abort();
        if (options.signal) {
            options.signal.addEventListener('abort', onUserAbort, { once: true });
        }

        const cleanup = () => {
            clearTimeout(timeoutId);
            if (options.signal) {
                options.signal.removeEventListener('abort', onUserAbort);
            }
        };

        try {
            const signal = combinedController.signal;

            // Dispatch to the legacy AI provider abstraction
            let content = '';
            let toolCalls = null;
            let message = null;
            let finishReason = null;

            if (wantsStream && (options.onToken || options.onChunk)) {
                // ── Streaming path: delegate to _sendStreamingRequest ──
                const streamResult = await this._sendStreamingRequest(
                    requestBody,
                    {
                        onToken: options.onToken,
                        onChunk: options.onChunk,
                        onToolCall: options.onToolCall,
                        onUsage: options.onUsage,
                    },
                    { signal, model: effectiveModel }
                );
                content = streamResult.content;
                toolCalls = streamResult.toolCalls;
                message = streamResult.rawMessage;
                finishReason = streamResult.finishReason || null;
            } else {
                const response = await callProvider(requestBody, { signal, model: effectiveModel });
                const choice = response.choices?.[0];
                message = choice?.message;
                content = message?.content || '';
                toolCalls = message?.tool_calls;
                finishReason = choice?.finish_reason || null;
            }

            // ── Multi-message stitching: handle truncated responses ─────
            // When the model hits max_tokens, finish_reason is 'length'.
            // We continue the conversation with the partial response as context
            // and ask the model to continue, stitching the pieces together.
            // Skip stitching when:
            //   - There are tool calls (the agent loop handles those)
            //   - The caller explicitly opted out via options.noStitch
            //   - Format is JSON (partial JSON stitching is fragile)
            if (
                finishReason === 'length' &&
                (!toolCalls || toolCalls.length === 0) &&
                !options.noStitch &&
                format !== 'json' &&
                content
            ) {
                const stitchResult = await this._stitchTruncatedResponse(
                    messages,
                    content,
                    requestBody,
                    options,
                    { signal, model: effectiveModel, wantsStream }
                );
                content = stitchResult.content;
                // Update the message object so history records the full response
                if (message) message.content = content;
            }

            cleanup();
            
            // Update history if requested (guard against null prompt from askWithMessages)
            if (options.recordHistory !== false && prompt != null) {
                this.conversationHistory.push({ role: 'user', content: prompt });
                this.conversationHistory.push(message || { role: 'assistant', content });
            }

            // Handle empty content (e.g. thinking models that forgot to output text)
            if (!content && (!toolCalls || toolCalls.length === 0)) {
                if (message?._geminiParts) {
                    const thoughtPart = message._geminiParts.find(p => p.thought);
                    if (thoughtPart) {
                        content = `_Thought: ${thoughtPart.text || '...'}_`;
                        // Update message so history has something
                        if (message) message.content = content;
                    }
                }
                
                // If still empty, provide a fallback
                if (!content) {
                    content = "(No response generated by the AI model)";
                    if (message) message.content = content;
                }
            }

            // If there are tool calls, we return them alongside the content
            if (toolCalls && toolCalls.length > 0) {
                 return { content, toolCalls, rawMessage: message };
            }

            // Parse JSON if requested
            if (format === 'json') {
                try {
                    let jsonStr = content.trim();
                    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
                    if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
                    if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
                    return JSON.parse(jsonStr.trim());
                } catch (e) {
                    consoleStyler.log('error', `AI response JSON parse error: ${e.message}`);
                    return { error: 'JSON parse failed', raw: content };
                }
            }
            
            return content;
        } catch (error) {
            cleanup();
            // Cancellation errors (AbortError, Gemini 499, CancellationError, user signal)
            // are rethrown as-is — upstream handlers use isCancellationError() to detect all
            // variants, so no normalization wrapper is needed here.
            if (isCancellationError(error) || (options.signal && options.signal.aborted)) {
                throw error;
            }
            consoleStyler.log('error', `AI request failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Stitch together a truncated response by sending continuation requests.
     *
     * When an LLM response is cut off at max_tokens (finish_reason === 'length'),
     * this method sends follow-up requests that include the partial response as
     * an assistant message and a continuation prompt, then concatenates the pieces.
     *
     * For streaming callers, continuation tokens are streamed via the same
     * onToken/onChunk callbacks so the UI sees a seamless stream.
     *
     * @private
     * @param {Array} originalMessages - The original messages array sent to the LLM
     * @param {string} partialContent - The truncated content from the first response
     * @param {Object} requestBody - The original request body (for model, temperature, etc.)
     * @param {Object} options - The original request options (onToken, onChunk, signal, etc.)
     * @param {Object} ctx - Context: { signal, model, wantsStream }
     * @returns {Promise<{ content: string }>}
     */
    async _stitchTruncatedResponse(originalMessages, partialContent, requestBody, options, ctx) {
        let accumulated = partialContent;
        let continuations = 0;
        const maxContinuations = this.maxStitchContinuations;
        const maxStitchLength = this.maxStitchLength
            ?? config?.ai?.maxStitchLength
            ?? DEFAULT_MAX_STITCH_LENGTH;

        // Track each continuation's content separately so we can append
        // them as individual assistant messages — avoids re-sending the
        // full accumulated text each time (which would cause O(n²) input
        // token growth across continuations).
        const continuationParts = [partialContent];

        consoleStyler.log('info', `Response truncated at max_tokens — starting multi-message stitching (up to ${maxContinuations} continuations)`);

        while (continuations < maxContinuations) {
            // Check for cancellation
            if (ctx.signal?.aborted || options.signal?.aborted) {
                consoleStyler.log('info', `Stitching cancelled after ${continuations} continuation(s)`);
                break;
            }

            // Guard: stop if accumulated response is already very large
            if (accumulated.length > maxStitchLength) {
                consoleStyler.log('warn', `Stitched response exceeds ${maxStitchLength} chars — stopping to prevent runaway growth`);
                break;
            }

            continuations++;

            // Build continuation messages: original messages + each prior
            // part as a separate assistant message + continue prompt.
            // This avoids sending the full accumulated text as a single
            // message, keeping input tokens linear instead of quadratic.
            const continuationMessages = [
                ...originalMessages,
                ...continuationParts.map(part => ({ role: 'assistant', content: part })),
                { role: 'user', content: 'Continue exactly where you left off. Do not repeat any content you have already written. Do not add preamble or acknowledge this instruction — just continue writing seamlessly from the exact point where your previous response was cut off.' }
            ];

            const continuationBody = {
                ...requestBody,
                messages: continuationMessages,
            };

            let continuationContent = '';
            let continuationFinishReason = null;

            try {
                if (ctx.wantsStream && (options.onToken || options.onChunk)) {
                    // Streaming continuation — tokens flow to the same callbacks
                    const streamResult = await this._sendStreamingRequest(
                        continuationBody,
                        {
                            onToken: options.onToken,
                            onChunk: options.onChunk,
                            onToolCall: null,  // No tool calls during continuations
                            onUsage: options.onUsage,
                        },
                        { signal: ctx.signal, model: ctx.model }
                    );
                    continuationContent = streamResult.content || '';
                    continuationFinishReason = streamResult.finishReason || null;
                } else {
                    // Non-streaming continuation
                    const response = await callProvider(continuationBody, {
                        signal: ctx.signal,
                        model: ctx.model,
                    });
                    const choice = response.choices?.[0];
                    continuationContent = choice?.message?.content || '';
                    continuationFinishReason = choice?.finish_reason || null;
                }
            } catch (err) {
                // If a continuation fails, return what we have so far rather than crashing
                consoleStyler.log('warn', `Stitching continuation ${continuations} failed: ${err.message} — returning partial response`);
                break;
            }

            if (!continuationContent.trim()) {
                // Model returned empty continuation — nothing more to add
                consoleStyler.log('info', `Stitching completed after ${continuations} continuation(s) (empty continuation received)`);
                break;
            }

            accumulated += continuationContent;
            continuationParts.push(continuationContent);

            // If this continuation completed normally, we're done
            if (continuationFinishReason !== 'length') {
                consoleStyler.log('info', `Stitching completed after ${continuations} continuation(s) (finish_reason: ${continuationFinishReason})`);
                break;
            }

            // Otherwise, continue stitching
            consoleStyler.log('info', `Continuation ${continuations} also truncated — will continue stitching…`);
        }

        if (continuations >= maxContinuations) {
            consoleStyler.log('warn', `Reached max stitching continuations (${maxContinuations}) — response may still be incomplete`);
        }

        return { content: accumulated };
    }

    /**
     * Send a streaming request to the LLM API using the SSEParser.
     *
     * Makes an HTTP request via callProviderStream(), pipes the response
     * through the SSEParser, and returns the accumulated result in the
     * same format as the non-streaming path.
     *
     * @private
     * @param {Object} requestBody - The request body (with stream: true already set)
     * @param {Object} streamCallbacks - { onToken, onChunk, onToolCall, onUsage }
     * @param {Object} providerOptions - { signal, model }
     * @returns {Promise<{ content: string, toolCalls: Array|null, rawMessage: Object }>}
     */
    async _sendStreamingRequest(requestBody, streamCallbacks, providerOptions) {
        // Ensure stream flag and usage inclusion
        requestBody.stream = true;
        if (!requestBody.stream_options) {
            requestBody.stream_options = { include_usage: true };
        }

        const response = await callProviderStream(requestBody, {
            signal: providerOptions.signal,
            model: providerOptions.model,
        });

        if (!response.ok) {
            throw new Error(`Stream Error: ${response.status} ${response.statusText}`);
        }

        return new Promise((resolve, reject) => {
            const parser = new SSEParser({
                onToken: (text) => {
                    if (streamCallbacks.onToken) streamCallbacks.onToken(text);
                    if (streamCallbacks.onChunk) streamCallbacks.onChunk(text);
                },
                onToolCall: streamCallbacks.onToolCall || null,
                onUsage: streamCallbacks.onUsage || null,
                onError: (err) => {
                    // Log parse errors but don't reject — partial data is still useful
                    consoleStyler.log('warn', `SSE parse error: ${err.message}`);
                },
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');

            const pump = async () => {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) {
                            parser.finish();
                            break;
                        }

                        const chunk = decoder.decode(value, { stream: true });
                        parser.feed(chunk);

                        // If the parser detected [DONE] or message_stop, we're done
                        if (parser.isDone) break;
                    }

                    resolve(parser.toResponse());
                } catch (err) {
                    // On error, return whatever was accumulated
                    if (isCancellationError(err) || providerOptions.signal?.aborted) {
                        // Return partial content on cancellation
                        resolve(parser.toResponse());
                    } else {
                        // For other errors, still return partial if we have content
                        if (parser.content) {
                            resolve(parser.toResponse());
                        } else {
                            reject(err);
                        }
                    }
                }
            };

            pump();
        });
    }
}
