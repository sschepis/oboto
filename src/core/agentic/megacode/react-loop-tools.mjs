/**
 * ReactLoop tool/LLM execution — extracted from react-loop.mjs.
 *
 * Contains LLM call logic (with retry), tool execution dispatch,
 * context compaction handling, and synthesis at iteration limit.
 *
 * All functions are stateless and accept dependencies as parameters.
 *
 * @module src/core/agentic/megacode/react-loop-tools
 */

import { MessageConverter } from './message-converter.mjs';
import { sleep } from './react-loop-helpers.mjs';
import {
    emitStatus,
    emitCommentary,
} from '../../status-reporter.mjs';

export class LLMExhaustedError extends Error {
    constructor(message, { attempts, lastError } = {}) {
        super(message);
        this.name = 'LLMExhaustedError';
        this.attempts = attempts;
        this.lastError = lastError;
    }
}

/**
 * Call the LLM with automatic retry for transient errors.
 *
 * Retries on rate limit (429) and server errors (5xx) with
 * exponential backoff. Reports retry status to the user.
 *
 * @param {Array} messages — OpenAI-format messages
 * @param {Object} deps
 * @param {Object} options
 * @param {TokenBudget} budget
 * @param {StreamManager|null} streamManager
 * @param {Object} runMetrics — mutable run metrics
 * @param {number} retryAttempts — max retry attempts
 * @returns {Promise<string>} — raw LLM response text
 */
export async function callLLMWithRetry(messages, deps, options, budget, streamManager, runMetrics, retryAttempts) {
    let lastError = null;

    for (let attempt = 1; attempt <= retryAttempts; attempt++) {
        try {
            return await callLLM(messages, deps, options, budget, streamManager);
        } catch (err) {
            lastError = err;

            // Always rethrow abort/cancellation errors
            if (options.signal?.aborted ||
                err.name === 'AbortError' ||
                err.name === 'CancellationError') {
                throw err;
            }

            // Fatal errors — don't retry
            const status = err.status || err.statusCode;
            if (status === 401 || status === 403 || status === 404) {
                throw err;
            }

            // Retryable: 429 (rate limit), 5xx (server errors), network errors
            const isRetryable = status === 429 ||
                (status >= 500 && status < 600) ||
                err.code === 'ECONNRESET' ||
                err.code === 'ETIMEDOUT' ||
                err.code === 'ENOTFOUND';

            if (isRetryable && attempt < retryAttempts) {
                runMetrics.retries++;
                const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
                emitStatus(`LLM error (${err.message}) — retrying in ${delay / 1000}s (attempt ${attempt}/${retryAttempts})`);
                await sleep(delay, options.signal);
                continue;
            }

            // Non-retryable or exhausted retries — throw structured error
            emitCommentary(`⚠️ LLM call failed after ${retryAttempts} attempts: ${err.message}`);
            throw new LLMExhaustedError(`LLM call failed after ${retryAttempts} attempts: ${err.message}`, {
                attempts: retryAttempts,
                lastError: err,
            });
        }
    }

    // Should not reach here, but just in case
    throw new LLMExhaustedError(lastError?.message || 'Unknown error after retries', {
        attempts: retryAttempts,
        lastError,
    });
}

/**
 * Call the LLM via deps.aiProvider.
 *
 * Uses `askWithMessages()` to send the full message array without
 * mutating the provider's internal conversation history.
 *
 * @param {Array} messages — OpenAI-format messages
 * @param {Object} deps
 * @param {Object} options
 * @param {TokenBudget} budget
 * @param {StreamManager|null} streamManager
 * @returns {Promise<string>} — raw LLM response text
 */
export async function callLLM(messages, deps, options, budget, streamManager = null) {
    const { aiProvider } = deps;

    const askOptions = {
        signal: options.signal,
        temperature: options.temperature ?? 0.7,
        recordHistory: false, // We manage our own message history
    };
    if (options.model) {
        askOptions.model = options.model;
    }

    // Forward streaming callbacks when the StreamManager is active and
    // not suppressed, so the LLM response is streamed incrementally.
    if (streamManager && !streamManager.isSuppressed) {
        const callbacks = streamManager.getCallbacks();
        if (callbacks.onToken) askOptions.onToken = callbacks.onToken;
        if (callbacks.onChunk) askOptions.onChunk = callbacks.onChunk;
    }

    const response = await aiProvider.askWithMessages(messages, askOptions);

    // Extract text content
    let text;
    if (typeof response === 'string') {
        text = response;
    } else if (response?.content) {
        text = response.content;
    } else if (response?.response) {
        text = response.response;
    } else {
        text = String(response ?? '');
    }

    // Accumulate token usage if available.
    // EventicAIProvider may return usage via rawMessage or directly.
    const usage = response?.usage
        || response?.rawMessage?.usage
        || null;
    if (usage) {
        budget.add(usage);
    }

    return text;
}

/**
 * Execute a tool via deps.toolExecutor.
 *
 * Translates from the ReAct loop's simple (toolName, args) format
 * to ToolExecutor's OpenAI tool_call format:
 *   { id, function: { name, arguments } }
 *
 * Reports tool errors to the user via emitCommentary.
 *
 * @param {string} toolName
 * @param {Object} args
 * @param {Object} deps
 * @param {Object} options
 * @param {Object} [runMetrics] — mutable run metrics
 * @returns {Promise<string>} — tool result text
 */
export async function executeTool(toolName, args, deps, options, runMetrics = {}) {
    const { toolExecutor } = deps;

    if (!toolExecutor) {
        const errMsg = `Error: No tool executor available. Cannot execute tool "${toolName}".`;
        emitCommentary(`⚠️ ${errMsg}`);
        return errMsg;
    }

    // Build an OpenAI-style tool call object that ToolExecutor.executeTool() expects
    const toolCall = {
        id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        function: {
            name: toolName,
            arguments: JSON.stringify(args || {}),
        },
    };

    try {
        const result = await toolExecutor.executeTool(toolCall, {
            signal: options.signal,
        });

        // ToolExecutor returns { role: 'tool', tool_call_id, name, content }
        return result?.content || '';
    } catch (err) {
        // Report tool errors to the user
        if (runMetrics) runMetrics.toolErrors = (runMetrics.toolErrors || 0) + 1;
        const errMsg = `Error executing tool "${toolName}": ${err.message}`;
        emitCommentary(`⚠️ Tool "${toolName}" failed: ${err.message}`);
        return errMsg;
    }
}

/**
 * Handle context compaction when overflow is detected.
 *
 * Strategy:
 * 1. If pruneFirst is enabled, try pruning old tool outputs
 * 2. If still overflowing, perform full LLM-based compaction
 * 3. Replace conversation turns with the compacted summary
 *
 * Reports compaction progress to the user via status messages.
 *
 * @param {Array} messages — current LLM messages
 * @param {Array} conversationTurns — mutable conversation turns array
 * @param {Object} deps
 * @param {Object} options
 * @param {ActivityTracker} tracker — for heartbeat during compaction LLM calls
 * @param {CompactionAgent} compaction — compaction agent instance
 * @returns {Promise<boolean>} — true if compaction was performed
 */
export async function handleCompaction(messages, conversationTurns, deps, options, tracker, compaction) {
    // Phase 1: Try pruning first
    if (compaction.pruneFirst) {
        emitStatus('Pruning old tool outputs to free context space…');
        const pruned = compaction.prune(messages);
        const afterPrune = compaction.checkOverflow(pruned);

        if (!afterPrune.needed) {
            // Pruning was sufficient — rebuild turns from pruned messages
            // (skip the system message at index 0)
            const prunedCount = messages.length - pruned.length;
            conversationTurns.length = 0;
            for (let i = 1; i < pruned.length; i++) {
                conversationTurns.push(pruned[i]);
            }

            emitCommentary(`Pruned ${prunedCount} old tool outputs — context within limits`);

            if (deps.eventBus) {
                deps.eventBus.emit('agentic:compaction', {
                    type: 'prune',
                    tokensBefore: messages.length,
                    tokensAfter: pruned.length,
                    timestamp: Date.now(),
                });
            }
            return true;
        }
    }

    // Phase 2: Full LLM-based compaction
    emitStatus('Context still too large — summarizing conversation via AI…');
    tracker.setActivity('Compacting conversation…', { phase: 'llm-call' });

    try {
        const result = await compaction.compact(messages, {
            aiProvider: deps.aiProvider,
            signal: options.signal,
        });

        // Replace all conversation turns with the summary
        conversationTurns.length = 0;
        conversationTurns.push({
            role: 'system',
            content: `[Previous conversation summary]\n\n${result.summary}`,
        });

        emitCommentary(`Conversation compacted: ${result.originalCount} messages → summary`);

        if (deps.eventBus) {
            deps.eventBus.emit('agentic:compaction', {
                type: 'summarize',
                originalCount: result.originalCount,
                compactedCount: result.compactedCount,
                timestamp: Date.now(),
            });
        }

        return true;
    } catch (err) {
        // Compaction failed — log and continue without compaction
        // The next LLM call may fail due to context overflow, which
        // will be caught as an LLM error
        emitCommentary(`⚠️ Compaction failed: ${err.message} — continuing without compaction`);

        if (deps.eventBus) {
            deps.eventBus.emit('agentic:compaction', {
                type: 'error',
                error: err.message,
                timestamp: Date.now(),
            });
        }
        return false;
    }
}

/**
 * Attempt a final LLM call to synthesize a response when max iterations are reached.
 *
 * Rather than returning a crude "last progress" dump, asks the LLM to produce
 * a proper response from all accumulated context.
 *
 * @param {string} systemPrompt
 * @param {Array} conversationTurns
 * @param {Array} allToolCalls
 * @param {Object} deps
 * @param {Object} options
 * @param {TokenBudget} budget
 * @param {number} maxIterations
 * @returns {Promise<string>} — synthesized response
 */
export async function synthesizeAtLimit(systemPrompt, conversationTurns, allToolCalls, deps, options, budget, maxIterations) {
    try {
        const synthesisPrompt = `You have reached the maximum number of iterations (${maxIterations}). ` +
            `You executed ${allToolCalls.length} tool call(s) during this run. ` +
            `Based on all the information gathered from tool results, provide a complete and helpful response ` +
            `to the user's original request. Summarize what was accomplished and what, if anything, remains to be done.`;

        conversationTurns.push({ role: 'system', content: synthesisPrompt });

        const messages = MessageConverter.buildLLMMessages(systemPrompt, conversationTurns);
        const response = await callLLM(messages, deps, options, budget);

        return response || `Reached maximum iterations (${maxIterations}). ${allToolCalls.length} tool calls were made but the task could not be completed within the iteration limit.`;
    } catch (err) {
        // Synthesis failed — return a descriptive fallback
        emitCommentary(`⚠️ Could not synthesize final response: ${err.message}`);
        const lastContent = conversationTurns[conversationTurns.length - 1]?.content;
        return `Reached maximum iterations (${maxIterations}). ${allToolCalls.length} tool call(s) completed. Last progress: ${
            typeof lastContent === 'string'
                ? lastContent.substring(0, 500)
                : 'none'
        }`;
    }
}
