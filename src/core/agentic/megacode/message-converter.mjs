/**
 * MessageConverter — converts between ai-man's history format and the
 * structured message format needed by the ReAct loop.
 *
 * ai-man history format:
 *   { role: 'user'|'assistant'|'system', content: string, ... }
 *
 * ReAct/LLM format (OpenAI-style):
 *   { role: 'system'|'user'|'assistant'|'tool',
 *     content: string|array,
 *     tool_calls?: array,
 *     tool_call_id?: string,
 *     name?: string }
 *
 * @module src/core/agentic/megacode/message-converter
 */

export class MessageConverter {
    /**
     * Convert ai-man history messages to the structured format the ReAct
     * loop uses.  Passes through role/content and preserves any tool_calls
     * or tool_call_id fields already present.
     *
     * @param {Array<{role: string, content: string}>} historyMessages
     * @returns {Array<{role: string, content: string}>}
     */
    static toReactMessages(historyMessages) {
        if (!Array.isArray(historyMessages)) return [];

        return historyMessages.map(msg => {
            const out = {
                role: msg.role || 'user',
                content: typeof msg.content === 'string'
                    ? msg.content
                    : JSON.stringify(msg.content ?? ''),
            };

            // Preserve tool-related fields if present
            if (msg.tool_calls) out.tool_calls = msg.tool_calls;
            if (msg.tool_call_id) out.tool_call_id = msg.tool_call_id;
            if (msg.name) out.name = msg.name;

            return out;
        });
    }

    /**
     * Convert ReAct loop messages back to the flat text format used by
     * ai-man's historyManager.
     *
     * Tool messages and tool_calls metadata are flattened into text
     * so the history remains human-readable.
     *
     * @param {Array} reactMessages
     * @returns {Array<{role: string, content: string}>}
     */
    static toHistoryFormat(reactMessages) {
        if (!Array.isArray(reactMessages)) return [];

        return reactMessages.map(msg => {
            let content = '';

            if (msg.role === 'tool') {
                // Tool result — prefix with tool name for context
                const toolLabel = msg.name ? `[Tool: ${msg.name}]` : '[Tool Result]';
                content = `${toolLabel}\n${msg.content || ''}`;
                return { role: 'assistant', content };
            }

            if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
                // Assistant message with tool calls — include the text + call summaries
                const callSummaries = msg.tool_calls.map(tc => {
                    const fn = tc.function || tc;
                    return `[Called: ${fn.name || 'unknown'}(${fn.arguments || '{}'})]`;
                }).join('\n');
                content = (msg.content || '') + '\n' + callSummaries;
                return { role: msg.role || 'assistant', content: content.trim() };
            }

            content = typeof msg.content === 'string'
                ? msg.content
                : JSON.stringify(msg.content ?? '');

            return { role: msg.role || 'user', content };
        });
    }

    /**
     * Build an LLM-ready message array from a system prompt and
     * conversation turns.
     *
     * Each turn is { role, content, tool?, toolCalls? }.
     * The output follows OpenAI's chat completions message format.
     *
     * @param {string} systemPrompt — the system prompt text
     * @param {Array} conversationTurns — ordered conversation turns
     * @param {Object} [options]
     * @param {number} [options.maxMessages] — cap the number of messages
     * @returns {Array<{role: string, content: string}>}
     */
    static buildLLMMessages(systemPrompt, conversationTurns, options = {}) {
        const messages = [];

        // System prompt as the first message
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }

        // Append each conversation turn
        for (const turn of conversationTurns) {
            if (turn.role === 'tool') {
                // Tool results use the OpenAI tool role format
                messages.push({
                    role: 'tool',
                    content: typeof turn.content === 'string'
                        ? turn.content
                        : JSON.stringify(turn.content ?? ''),
                    ...(turn.tool ? { name: turn.tool } : {}),
                    ...(turn.tool_call_id ? { tool_call_id: turn.tool_call_id } : {}),
                });
            } else {
                messages.push({
                    role: turn.role || 'user',
                    content: typeof turn.content === 'string'
                        ? turn.content
                        : JSON.stringify(turn.content ?? ''),
                });
            }
        }

        // Optionally cap message count (keep system + most recent N)
        if (options.maxMessages && messages.length > options.maxMessages + 1) {
            const system = messages[0];
            const recent = messages.slice(-(options.maxMessages));
            return [system, ...recent];
        }

        return messages;
    }

    /**
     * Estimate token count for a message array.
     * Uses rough heuristic: ~4 chars per token.
     *
     * @param {Array<{role: string, content: string}>} messages
     * @returns {number}
     */
    static estimateTokens(messages) {
        if (!Array.isArray(messages)) return 0;

        let chars = 0;
        for (const msg of messages) {
            // Count role overhead (~4 tokens per message for role/delimiters)
            chars += 16;
            if (typeof msg.content === 'string') {
                chars += msg.content.length;
            } else if (msg.content != null) {
                chars += JSON.stringify(msg.content).length;
            }
            // Count tool_calls if present
            if (msg.tool_calls) {
                chars += JSON.stringify(msg.tool_calls).length;
            }
        }

        return Math.ceil(chars / 4);
    }

    /**
     * Prune old tool results from messages, keeping recent ones intact.
     *
     * Implements megacode's pruning strategy:
     * 1. Walk backward through messages
     * 2. Protect the most recent `protectTokens` worth of tool outputs
     * 3. Truncate older tool outputs to "[output pruned]"
     *
     * @param {Array} messages
     * @param {Object} [options]
     * @param {number} [options.protectTokens=40000] — recent tokens to protect
     * @param {number} [options.minimumTokens=20000] — minimum tokens to prune
     * @returns {Array} — messages with old tool outputs pruned
     */
    static pruneToolOutputs(messages, options = {}) {
        const protectTokens = options.protectTokens ?? 40000;
        const minimumTokens = options.minimumTokens ?? 20000;

        // Estimate current total
        const totalTokens = MessageConverter.estimateTokens(messages);
        if (totalTokens < minimumTokens) {
            return messages; // Nothing to prune
        }

        const result = [...messages];
        let protectedSoFar = 0;
        let prunedTokens = 0;

        // Walk backward — protect recent tool outputs, prune older ones.
        // Matches both OpenAI-style tool-role messages and text-based
        // tool results (role: 'user' with '[Tool Result: ...]' prefix)
        // used by the megacode ReAct loop.
        for (let i = result.length - 1; i >= 0; i--) {
            const msg = result[i];

            // Match tool-role messages or user messages containing tool results
            const isToolResult = msg.role === 'tool' ||
                (msg.role === 'user' && typeof msg.content === 'string' && msg.content.startsWith('[Tool Result:'));

            if (!isToolResult) continue;

            const msgTokens = MessageConverter.estimateTokens([msg]);

            if (protectedSoFar < protectTokens) {
                // Still in the protected zone — keep this tool output
                protectedSoFar += msgTokens;
            } else {
                // Outside the protected zone — prune this tool output
                result[i] = {
                    ...msg,
                    content: '[output pruned]',
                };
                prunedTokens += msgTokens;
            }
        }

        return result;
    }
}
