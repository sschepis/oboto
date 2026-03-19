/**
 * MegacodeProvider — agentic provider implementing a ReAct agent loop with
 * multi-step tool execution, context compaction, and doom loop detection.
 *
 * Ported from the megacode/opencode architecture. Delegates all loop logic
 * to the ReactLoop engine, which handles:
 *   Thought → Action → Observation → Thought → Action → …
 *
 * Key features:
 * - ReAct-style iterative reasoning with tool use
 * - Automatic context window compaction when approaching token limits
 * - Doom loop detection to prevent infinite tool call cycles
 * - Streaming and non-streaming modes
 * - Request deduplication via the base class
 * - Rich status reporting via ActivityTracker and emitStatus/emitCommentary
 * - LLM retry logic with exponential backoff for transient errors
 * - Conversation history loading for multi-turn context
 * - Max-iterations synthesis for graceful degradation
 *
 * @module src/core/agentic/megacode/megacode-provider
 */

import { AgenticProvider } from '../base-provider.mjs';
import { ReactLoop } from './react-loop.mjs';
import { CancellationError } from '../../../lib/cancellation-error.mjs';
import { emitStatus, emitCommentary } from '../../status-reporter.mjs';

export class MegacodeProvider extends AgenticProvider {
    constructor(options = {}) {
        super();
        this._options = options;
        this._reactLoop = null;
        this._turnCount = 0;
    }

    /** @type {string} */
    get id() { return 'megacode'; }

    /** @type {string} */
    get name() { return 'Megacode Provider'; }

    /** @type {string} */
    get description() {
        return 'ReAct agent loop with multi-step tool execution, context compaction, and doom loop detection. Ported from megacode/opencode.';
    }

    /**
     * Initialize the provider with shared dependencies from EventicFacade.
     *
     * Creates the ReactLoop engine with configuration derived from the
     * provider options passed at construction time.
     *
     * @param {Object} deps — shared dependencies (aiProvider, toolExecutor, etc.)
     */
    async initialize(deps) {
        await super.initialize(deps);

        // Create the ReactLoop with configuration
        this._reactLoop = new ReactLoop({
            maxIterations: this._options.maxIterations ?? 25,
            compaction: {
                contextLimit: this._options.contextLimit ?? 100000,
                reservedTokens: this._options.reservedTokens ?? 8000,
                pruneFirst: this._options.pruneFirst ?? true,
            },
            doomDetection: {
                threshold: this._options.doomThreshold ?? 3,
                windowSize: this._options.doomWindowSize ?? 10,
            },
            retryAttempts: this._options.retryAttempts ?? 3,
            heartbeatIntervalMs: this._options.heartbeatIntervalMs ?? 3000,
        });

        this._turnCount = 0;
        emitStatus('Megacode provider initialized');
    }

    /**
     * Process a user input through the ReAct loop.
     *
     * Delegates to ReactLoop.execute() for the actual processing. Handles:
     * - History management (saving user/assistant messages)
     * - Streaming via onChunk/onToken callbacks
     * - Request deduplication for non-streaming requests
     * - Abort/cancellation error propagation
     * - Event emission for observability
     * - Rich status reporting at the provider level
     *
     * @param {string} input — user message
     * @param {Object} [options]
     * @param {AbortSignal}  [options.signal]   — abort signal
     * @param {boolean}      [options.stream]   — enable streaming
     * @param {Function}     [options.onChunk]  — streaming chunk callback
     * @param {Function}     [options.onToken]  — streaming token callback
     * @param {string}       [options.model]    — model override
     * @returns {Promise<{response: string, streamed?: boolean, tokenUsage?: Object, metadata?: Object}>}
     */
    async run(input, options = {}) {
        if (!this._deps) {
            throw new Error('MegacodeProvider not initialized. Call initialize(deps) first.');
        }

        return this._deduplicatedRun(input, options, async () => {
            this._turnCount++;

            // --- Status: Turn start ---
            emitStatus(`Starting megacode turn ${this._turnCount}`);

            // Use the facade's CURRENT historyManager (not the stale captured reference)
            // because loadConversation() replaces facade.historyManager after provider init.
            const facade = this._deps.facade;
            const getHistoryManager = () => facade ? facade.historyManager : this._deps.historyManager;

            try {
                // Save user message to history
                const hm = getHistoryManager();
                if (hm) {
                    await hm.addMessage?.({ role: 'user', content: input });
                }

                // Build additional prompt context from the facade if available
                const agentPrompt = facade?.personaManager?.getActivePersona?.()?.prompt;

                // Execute the ReAct loop
                const result = await this._reactLoop.execute(input, this._deps, {
                    signal: options.signal,
                    stream: options.stream || !!options.onChunk,
                    onChunk: options.onChunk,
                    onToken: options.onToken,
                    model: options.model,
                    agentPrompt,
                });

                // Save assistant response to history
                const hmAfter = getHistoryManager();
                if (hmAfter) {
                    await hmAfter.addMessage?.({
                        role: 'assistant',
                        content: result.response,
                        metadata: {
                            provider: 'megacode',
                            iterations: result.iterations,
                            toolCalls: result.toolCalls?.length ?? 0,
                            ...result.metadata,
                        },
                    });
                }

                // --- Status: Turn complete ---
                const elapsed = result.metadata?.elapsed
                    ? `${Math.round(result.metadata.elapsed / 1000)}s`
                    : '';
                const toolCount = result.toolCalls?.length ?? 0;
                emitCommentary(
                    `Turn ${this._turnCount} complete — ` +
                    `${result.iterations} iteration(s), ` +
                    `${toolCount} tool call(s)` +
                    (elapsed ? ` in ${elapsed}` : '')
                );

                // Emit event for UI tracking (machine-readable)
                this._deps.eventBus?.emit?.('agentic:turn-complete', {
                    provider: 'megacode',
                    turnNumber: this._turnCount,
                    iterations: result.iterations,
                    toolCallCount: toolCount,
                    tokenUsage: result.tokenUsage,
                    metadata: result.metadata,
                });

                return {
                    response: result.response,
                    streamed: options.stream || !!options.onChunk,
                    tokenUsage: result.tokenUsage || null,
                    metadata: {
                        provider: 'megacode',
                        iterations: result.iterations,
                        ...result.metadata,
                        toolCalls: result.toolCalls?.map(tc => ({
                            tool: tc.tool,
                            args: tc.args,
                        })) ?? [],
                    },
                };
            } catch (err) {
                // Handle CancellationError / AbortError gracefully
                if (err instanceof CancellationError ||
                    err.name === 'AbortError' ||
                    err.name === 'CancellationError' ||
                    options.signal?.aborted) {
                    const abortMsg = 'Agent processing was cancelled.';
                    emitStatus(abortMsg);
                    const hmAbort = getHistoryManager();
                    if (hmAbort) {
                        await hmAbort.addMessage?.({ role: 'assistant', content: abortMsg });
                    }
                    return { response: abortMsg, tokenUsage: null };
                }

                // --- Status: Error reporting ---
                emitCommentary(`⚠️ Megacode provider error: ${err.message}`);
                throw err;
            }
        });
    }

    /**
     * Check if this provider is healthy and ready to handle requests.
     *
     * Verifies that the provider has been initialized, the ReactLoop
     * is created, and critical dependencies (aiProvider, toolExecutor)
     * are available.
     *
     * @returns {Promise<{healthy: boolean, reason?: string}>}
     */
    async healthCheck() {
        if (!this._deps) {
            return { healthy: false, reason: 'Not initialized' };
        }
        if (!this._reactLoop) {
            return { healthy: false, reason: 'ReactLoop not created' };
        }
        // Check critical deps
        if (!this._deps.aiProvider) {
            return { healthy: false, reason: 'aiProvider not available' };
        }
        if (!this._deps.toolExecutor) {
            return { healthy: false, reason: 'toolExecutor not available' };
        }
        return { healthy: true };
    }

    /**
     * Get provider diagnostics for debugging and monitoring.
     *
     * @returns {Object} diagnostics info
     */
    getDiagnostics() {
        return {
            turnCount: this._turnCount,
            hasReactLoop: !!this._reactLoop,
            options: { ...this._options },
        };
    }

    /**
     * Cleanup when switching away from this provider.
     * Resets the ReactLoop and turn count.
     */
    async dispose() {
        if (this._reactLoop) {
            this._reactLoop.reset();
            this._reactLoop = null;
        }
        this._turnCount = 0;
        await super.dispose();
    }
}
