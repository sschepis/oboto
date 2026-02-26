import { config } from '../config.mjs';
import { callProvider, callProviderStream, isCancellationError } from './ai-provider.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';

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
        
        // Append previous history
        messages.push(...this.conversationHistory);
        
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
     * @param {Array<{role: string, content: string}>} messages - Full messages array
     * @param {Object} options - Same as ask() (format, system, schema, tools, signal, etc.)
     * @returns {Promise<any>}
     */
    async askWithMessages(messages, options = {}) {
        // Ensure history is never written — caller manages its own.
        return this._sendRequest(messages, null, { ...options, recordHistory: false });
    }

    /**
     * Internal: send a prepared messages array to the LLM provider.
     * @private
     */
    async _sendRequest(messages, prompt, options = {}) {
        const { format = 'text', schema = null, tools = null } = options;
        
        const requestBody = {
            model: this.model,
            messages,
            temperature: options.temperature !== undefined ? options.temperature : 0.7,
        };

        // Format handling
        if (format === 'json') {
            if (schema) {
                requestBody.response_format = {
                    type: 'json_schema',
                    // ai-provider.mjs uses `.schema` for Gemini
                    schema: schema,
                    // OpenAI REST expects `json_schema` object
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

        if (options.stream && options.onChunk) {
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

            if (options.stream && options.onChunk) {
                const response = await callProviderStream(requestBody, { 
                    signal, 
                    model: this.model 
                });
                
                if (!response.ok) {
                    throw new Error(`Stream Error: ${response.status} ${response.statusText}`);
                }

                // Parse the SSE stream
                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // keep remainder
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6).trim();
                            if (data === '[DONE]') break;
                            try {
                                const parsed = JSON.parse(data);
                                const chunkContent = parsed.choices?.[0]?.delta?.content || '';
                                if (chunkContent) {
                                    content += chunkContent;
                                    options.onChunk(chunkContent);
                                }
                                
                                // Simple extraction for tools if provided in stream
                                if (parsed.choices?.[0]?.delta?.tool_calls) {
                                    if (!toolCalls) toolCalls = [];
                                    const tcs = parsed.choices[0].delta.tool_calls;
                                    for (const tc of tcs) {
                                        if (tc.id) {
                                            toolCalls[tc.index] = { id: tc.id, function: { name: tc.function.name, arguments: tc.function.arguments || '' } };
                                        } else if (toolCalls[tc.index]) {
                                            toolCalls[tc.index].function.arguments += (tc.function.arguments || '');
                                        }
                                    }
                                }
                            } catch (e) {
                                // ignore parse error for incomplete JSON chunk
                            }
                        }
                    }
                }
                
                // Cleanup toolCalls array
                if (toolCalls) {
                    toolCalls = toolCalls.filter(Boolean);
                }
                
                message = { role: 'assistant', content, tool_calls: toolCalls };
            } else {
                const response = await callProvider(requestBody, { signal, model: this.model });
                message = response.choices?.[0]?.message;
                content = message?.content || '';
                toolCalls = message?.tool_calls;
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
}
