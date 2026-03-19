/**
 * CompactionAgent — handles context window compaction when the conversation
 * gets too long for the LLM's context window.
 *
 * Implements a two-phase strategy ported from megacode's SessionCompaction:
 *  1. **Pruning** (cheap): walk backward through tool outputs, protect recent
 *     ones, truncate older ones to "[output pruned]".
 *  2. **Summarization** (expensive): if still over limit after pruning, send
 *     the full conversation to the LLM with a compaction prompt and replace
 *     the history with a structured summary.
 *
 * @module src/core/agentic/megacode/compaction-agent
 */

import { MessageConverter } from './message-converter.mjs';

/**
 * Compaction prompt template — asks the LLM to produce a structured summary
 * following megacode's compaction pattern.
 */
const COMPACTION_PROMPT = `Provide a detailed summary for continuing our conversation.
Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next.

When constructing the summary, stick to this template:
---
## Goal
[What goals is the user trying to accomplish?]

## Instructions
- [What important instructions did the user give]
- [If there is a plan or spec, include information about it]

## Discoveries
[What notable things were learned during this conversation]

## Accomplished
[What work has been completed, in progress, or left?]

## Remaining
[What still needs to be done]

## Relevant files / directories
[List of relevant files that have been read, edited, or created]
---`;

export class CompactionAgent {
    /**
     * @param {Object} [options]
     * @param {number} [options.contextLimit=100000]    — max tokens before compaction
     * @param {number} [options.reservedTokens=8000]    — tokens to keep free for next response
     * @param {boolean} [options.pruneFirst=true]        — try pruning before full compaction
     * @param {number} [options.pruneProtectTokens=40000] — recent tool output tokens to protect
     * @param {number} [options.pruneMinimumTokens=20000] — minimum total tokens before pruning
     */
    constructor(options = {}) {
        this._contextLimit = options.contextLimit ?? 100000;
        this._reservedTokens = options.reservedTokens ?? 8000;
        this._pruneFirst = options.pruneFirst ?? true;
        this._pruneProtectTokens = options.pruneProtectTokens ?? 40000;
        this._pruneMinimumTokens = options.pruneMinimumTokens ?? 20000;
    }

    /**
     * Whether pruning should be attempted before full LLM-based compaction.
     * @type {boolean}
     */
    get pruneFirst() {
        return this._pruneFirst;
    }

    /**
     * Check if compaction is needed based on current token usage.
     *
     * @param {Array} messages — current conversation messages
     * @returns {{ needed: boolean, reason?: string, currentTokens: number, limit: number }}
     */
    checkOverflow(messages) {
        const currentTokens = MessageConverter.estimateTokens(messages);
        const usableLimit = this._contextLimit - this._reservedTokens;

        if (currentTokens >= usableLimit) {
            return {
                needed: true,
                reason: `Token count (${currentTokens}) exceeds usable limit (${usableLimit} = ${this._contextLimit} - ${this._reservedTokens} reserved)`,
                currentTokens,
                limit: usableLimit,
            };
        }

        return {
            needed: false,
            currentTokens,
            limit: usableLimit,
        };
    }

    /**
     * Perform compaction using the LLM to summarize conversation.
     *
     * Uses `deps.aiProvider` to generate a structured summary, then
     * replaces the full conversation with a single system message
     * containing the summary.
     *
     * @param {Array} messages — full conversation messages
     * @param {Object} deps
     * @param {Object} deps.aiProvider — ai-man's EventicAIProvider
     * @param {AbortSignal} [deps.signal]
     * @returns {Promise<{ summary: string, originalCount: number, compactedCount: number }>}
     */
    async compact(messages, deps) {
        const { aiProvider, signal } = deps;

        if (!aiProvider) {
            throw new Error('CompactionAgent.compact() requires deps.aiProvider');
        }

        const originalCount = messages.length;

        // Build the compaction request — append the compaction prompt as a user message
        const compactionMessages = [
            ...messages,
            { role: 'user', content: COMPACTION_PROMPT },
        ];

        let summary;
        try {
            // Use askWithMessages to avoid mutating aiProvider's internal history.
            // This is a stateless utility call — no tools needed.
            const response = await aiProvider.askWithMessages(compactionMessages, {
                signal,
                temperature: 0.3,
                recordHistory: false,
            });

            // Extract text from the response (may be string or { content })
            summary = typeof response === 'string'
                ? response
                : (response?.content || response?.response || String(response));
        } catch (err) {
            // If compaction LLM call fails, return a fallback summary
            // so the loop can continue (degraded but not broken)
            summary = this._buildFallbackSummary(messages);
        }

        return {
            summary,
            originalCount,
            compactedCount: 1, // Single summary message replaces everything
        };
    }

    /**
     * Prune old tool outputs from messages (lighter than full compaction).
     *
     * Delegates to MessageConverter.pruneToolOutputs with configured thresholds.
     *
     * @param {Array} messages
     * @returns {Array} — pruned message array
     */
    prune(messages) {
        return MessageConverter.pruneToolOutputs(messages, {
            protectTokens: this._pruneProtectTokens,
            minimumTokens: this._pruneMinimumTokens,
        });
    }

    /**
     * Build the compaction prompt that asks the LLM to summarize.
     * Exposed for testing.
     *
     * @param {Array} messages
     * @returns {Array} — messages with compaction prompt appended
     */
    _buildCompactionPrompt(messages) {
        return [
            ...messages,
            { role: 'user', content: COMPACTION_PROMPT },
        ];
    }

    /**
     * Build a fallback summary when the LLM compaction call fails.
     * Extracts key information from messages heuristically.
     *
     * @param {Array} messages
     * @returns {string}
     * @private
     */
    _buildFallbackSummary(messages) {
        const parts = ['[Compaction fallback — LLM summarization failed]\n'];

        // Extract the first user message as the goal
        const firstUser = messages.find(m => m.role === 'user');
        if (firstUser) {
            parts.push(`## Goal\n${firstUser.content.substring(0, 500)}\n`);
        }

        // Extract the last assistant message as the most recent progress
        const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
        if (lastAssistant) {
            parts.push(`## Last Progress\n${lastAssistant.content.substring(0, 500)}\n`);
        }

        // Count tool calls for context
        const toolMessages = messages.filter(m => m.role === 'tool');
        if (toolMessages.length > 0) {
            parts.push(`## Tool Usage\n${toolMessages.length} tool calls were made during the conversation.\n`);
        }

        return parts.join('\n');
    }
}
