/**
 * LLM-Wrapper Adapter — bridges ai-man's LLM interfaces to llm-wrapper's
 * BaseProvider contract so that oboto-agent can use them directly.
 *
 * Provides two adapter factories:
 * - createRemoteProvider: wraps ai-man's callProvider → llm-wrapper BaseProvider
 * - createLocalProvider: wraps SupportLLM → llm-wrapper BaseProvider
 *
 * @module src/core/agentic/oboto/lmscript-adapter
 */

import { callProvider, callProviderStream } from '../../ai-provider.mjs';

// ── Remote LLM Provider ──────────────────────────────────────────────

/**
 * Create a llm-wrapper-compatible BaseProvider that wraps ai-man's callProvider.
 *
 * Since callProvider already returns OpenAI-compatible responses, this is a
 * thin passthrough that conforms to llm-wrapper's BaseProvider shape.
 *
 * @param {string} modelName - Default model identifier
 * @returns {import('@sschepis/llm-wrapper').BaseProvider}
 */
export function createRemoteProvider(modelName) {
    return {
        providerName: `ai-man-remote(${modelName})`,

        async chat(params) {
            const requestBody = {
                model: params.model || modelName,
                messages: params.messages,
                temperature: params.temperature ?? 0.7,
                max_tokens: params.max_tokens || 4096,
            };

            if (params.tools?.length) {
                requestBody.tools = params.tools;
                requestBody.tool_choice = params.tool_choice ?? 'auto';
            }

            if (params.response_format) {
                requestBody.response_format = params.response_format;
            }

            try {
                const response = await callProvider(requestBody);
                const normalized = normalizeResponse(response, params.model || modelName);

                // Diagnostic: warn if response is completely empty
                const msg = normalized.choices?.[0]?.message;
                if (!msg?.content && !msg?.tool_calls?.length) {
                    console.warn('[ObotoAdapter] LLM returned empty response (no content, no tool_calls)',
                        { model: requestBody.model, messageCount: requestBody.messages?.length });
                }

                return normalized;
            } catch (err) {
                console.error('[ObotoAdapter] callProvider error:', err.message || err);
                throw err;
            }
        },

        async *stream(params) {
            const requestBody = {
                model: params.model || modelName,
                messages: params.messages,
                temperature: params.temperature ?? 0.7,
                stream: true,
            };

            if (params.tools?.length) {
                requestBody.tools = params.tools;
                requestBody.tool_choice = params.tool_choice ?? 'auto';
            }

            if (params.response_format) {
                requestBody.response_format = params.response_format;
            }

            const streamResp = await callProviderStream(requestBody);

            if (streamResp && typeof streamResp[Symbol.asyncIterator] === 'function') {
                for await (const chunk of streamResp) {
                    if (typeof chunk === 'string') {
                        yield {
                            id: 'stream',
                            object: 'chat.completion.chunk',
                            created: Date.now(),
                            model: params.model || modelName,
                            choices: [{
                                index: 0,
                                delta: { content: chunk },
                                finish_reason: null,
                            }],
                        };
                    } else if (chunk?.choices) {
                        yield chunk;
                    }
                }
            }
        },
    };
}

// ── Local LLM Provider ───────────────────────────────────────────────

/**
 * Create a llm-wrapper-compatible BaseProvider that wraps ai-man's SupportLLM.
 *
 * @param {import('../../support-llm.mjs').SupportLLM} supportLlm
 * @param {string} modelName
 * @returns {import('@sschepis/llm-wrapper').BaseProvider | null}
 */
export function createLocalProvider(supportLlm, modelName) {
    if (!supportLlm) return null;

    return {
        providerName: `ai-man-local(${modelName})`,

        async chat(params) {
            if (!supportLlm.isAvailable()) {
                throw new Error('SupportLLM is not available');
            }

            const messages = params.messages.map(m => ({
                role: m.role,
                content: typeof m.content === 'string'
                    ? m.content
                    : Array.isArray(m.content)
                        ? m.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
                        : '',
            }));

            // For JSON mode requests (triage), append formatting instruction
            if (params.response_format?.type === 'json_object') {
                const lastMsg = messages[messages.length - 1];
                if (lastMsg) {
                    lastMsg.content += '\n\nRespond ONLY with valid JSON.';
                }
            }

            const result = await supportLlm._dispatch(messages, 1024);

            return {
                id: `local-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: modelName,
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: result || '',
                    },
                    finish_reason: 'stop',
                }],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0,
                },
            };
        },

        // SupportLLM has no streaming
        async *stream(params) {
            const response = await this.chat(params);
            yield {
                id: response.id,
                object: 'chat.completion.chunk',
                created: response.created,
                model: response.model,
                choices: [{
                    index: 0,
                    delta: { role: 'assistant', content: response.choices[0].message.content },
                    finish_reason: 'stop',
                }],
            };
        },
    };
}

// ── Convenience Factory ──────────────────────────────────────────────

/**
 * Create both local and remote llm-wrapper providers from ai-man deps.
 * Falls back to remote for both if SupportLLM is unavailable.
 *
 * @param {object} deps - ai-man agentic dependencies
 * @returns {{ localProvider, remoteProvider, localModelName, remoteModelName }}
 */
export function createLLMProviderPair(deps) {
    const remoteModelName = deps.config?.ai?.model || 'default';
    const localModelName = deps.config?.ai?.supportLlm?.model || 'embedded-llama';

    const remoteProvider = createRemoteProvider(remoteModelName);

    let localProvider = createLocalProvider(deps.supportLlm, localModelName);

    // Fallback: use remote for triage too if no local model
    if (!localProvider) {
        localProvider = remoteProvider;
    }

    return {
        localProvider,
        remoteProvider,
        localModelName: localProvider === remoteProvider ? remoteModelName : localModelName,
        remoteModelName,
    };
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Normalize a callProvider response to ensure it has all StandardChatResponse fields.
 * callProvider already returns OpenAI-compatible format, but some provider adapters
 * (Anthropic, Gemini) may have slightly different structures.
 */
function normalizeResponse(response, model) {
    // Already in OpenAI format
    if (response.choices?.[0]?.message) {
        return {
            id: response.id || `resp-${Date.now()}`,
            object: 'chat.completion',
            created: response.created || Math.floor(Date.now() / 1000),
            model: response.model || model,
            choices: response.choices.map((c, i) => ({
                index: c.index ?? i,
                message: {
                    role: c.message.role || 'assistant',
                    content: c.message.content ?? '',
                    ...(c.message.tool_calls ? { tool_calls: c.message.tool_calls } : {}),
                },
                finish_reason: c.finish_reason ?? 'stop',
            })),
            usage: {
                prompt_tokens: response.usage?.prompt_tokens ?? response.usage?.input_tokens ?? 0,
                completion_tokens: response.usage?.completion_tokens ?? response.usage?.output_tokens ?? 0,
                total_tokens: response.usage?.total_tokens
                    ?? ((response.usage?.prompt_tokens ?? response.usage?.input_tokens ?? 0)
                        + (response.usage?.completion_tokens ?? response.usage?.output_tokens ?? 0)),
            },
        };
    }

    // Anthropic raw format: content array
    if (Array.isArray(response.content)) {
        const textBlocks = response.content.filter(b => b.type === 'text');
        const toolBlocks = response.content.filter(b => b.type === 'tool_use');
        const content = textBlocks.map(b => b.text).join('');
        const toolCalls = toolBlocks.length > 0
            ? toolBlocks.map(b => ({
                id: b.id,
                type: 'function',
                function: { name: b.name, arguments: JSON.stringify(b.input) },
            }))
            : undefined;

        return {
            id: response.id || `resp-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: response.model || model,
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content,
                    ...(toolCalls ? { tool_calls: toolCalls } : {}),
                },
                finish_reason: toolCalls ? 'tool_calls' : (response.stop_reason || 'stop'),
            }],
            usage: {
                prompt_tokens: response.usage?.input_tokens ?? 0,
                completion_tokens: response.usage?.output_tokens ?? 0,
                total_tokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
            },
        };
    }

    // Fallback
    return {
        id: `resp-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content: typeof response === 'string' ? response : JSON.stringify(response),
            },
            finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
}
