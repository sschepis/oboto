/**
 * HolographicMemoryAdapter — dual memory system for the LMScript Agent Loop.
 * 
 * Wraps ResoLangService (workspace-level holographic memory) and optionally
 * CognitiveCore (tinyaleph prime-resonant memory) into two interfaces:
 * 
 * 1. Associative (passive): auto-injected context before each turn,
 *    auto-extracted memories after each turn
 * 2. On-Demand (active): explicit RECALL/REMEMBER commands
 *
 * CognitiveCore is loaded via dynamic import with graceful degradation
 * so the module works even when @aleph-ai/tinyaleph is not installed.
 *
 * Performance notes:
 * - Dual-store queries (ResoLang + CognitiveCore) are parallelized via
 *   Promise.allSettled to avoid serial latency.
 * - getCognitiveStateSummary() provides a lightweight alternative to
 *   getCognitiveStateContext() for event payloads where the full context
 *   string is not needed.
 *
 * @module src/core/agentic/lmscript/holographic-memory
 */

// CognitiveCore is loaded dynamically in initialize() to avoid crashing
// the process if @aleph-ai/tinyaleph (a transitive dependency of
// ../cognitive/cognitive.mjs) is not installed.
let CognitiveCoreCtor = null;

export class HolographicMemoryAdapter {
    constructor(options = {}) {
        this.resoLangService = options.resoLangService || null;
        this.maxAssociativeResults = options.maxAssociativeResults || 5;
        this.maxRecallResults = options.maxRecallResults || 10;
        this._options = options;
        this.cognitiveCore = null;
        this._initialized = false;
    }

    /**
     * Async initialization — loads CognitiveCore dynamically and warms up physics.
     * Must be called after construction before using memory methods.
     * @param {Object} [opts] — override options
     * @returns {Promise<void>}
     */
    async initialize(opts = {}) {
        const options = { ...this._options, ...opts };

        // Dynamic import of CognitiveCore with graceful degradation
        if (!CognitiveCoreCtor) {
            try {
                const mod = await import('../cognitive/cognitive.mjs');
                CognitiveCoreCtor = mod.CognitiveCore;
            } catch (err) {
                console.warn(
                    '[HolographicMemoryAdapter] CognitiveCore module unavailable (tinyaleph not installed?):',
                    err.message
                );
                CognitiveCoreCtor = null;
            }
        }

        // Initialize CognitiveCore for prime-resonant memory
        if (CognitiveCoreCtor) {
            try {
                this.cognitiveCore = new CognitiveCoreCtor({
                    primeCount: options.primeCount || 64,
                    objectivityThreshold: options.objectivityThreshold || 0.6
                });
                // Warm up physics
                const ticks = options.initTicks || 10;
                for (let i = 0; i < ticks; i++) {
                    this.cognitiveCore.tick();
                }
            } catch (err) {
                console.warn('[HolographicMemoryAdapter] CognitiveCore init failed:', err.message);
                this.cognitiveCore = null;
            }
        }

        this._initialized = true;
    }

    /**
     * ASSOCIATIVE MEMORY: Fetch relevant context for the current observation.
     * Called automatically before each agent turn.
     * 
     * Queries both ResoLang and CognitiveCore in parallel for lower latency.
     * 
     * @param {string} observation
     * @param {Object} [opts]
     * @param {AbortSignal} [opts.signal]
     * @returns {Promise<Array>}
     */
    async fetchAssociativeContext(observation, opts = {}) {
        if (opts.signal?.aborted) return [];

        const hasReso = !!this.resoLangService?.isInitialized;
        const hasCog = !!this.cognitiveCore;

        // Fast path: no memory stores available
        if (!hasReso && !hasCog) return [];

        const results = [];
        const limit = this.maxAssociativeResults;

        // Build parallel query promises
        const queries = [];

        if (hasReso) {
            queries.push(
                this.resoLangService.recall(observation, limit)
                    .then(resoResults => {
                        for (const r of resoResults) {
                            results.push({
                                source: 'holographic',
                                text: r.text,
                                score: r.score,
                                metadata: r.metadata
                            });
                        }
                    })
                    .catch(err => {
                        console.warn('[AssociativeMemory] ResoLang recall failed:', err.message);
                    })
            );
        }

        if (hasCog) {
            // CognitiveCore.recall is synchronous — wrap for uniformity
            queries.push(
                Promise.resolve().then(() => {
                    const cogResults = this.cognitiveCore.recall(observation, limit);
                    for (const r of cogResults) {
                        results.push({
                            source: 'cognitive',
                            text: `${r.input} → ${r.output}`,
                            score: r.score,
                            metadata: { coherence: r.coherence, interactionId: r.interactionId }
                        });
                    }
                }).catch(err => {
                    console.warn('[AssociativeMemory] CognitiveCore recall failed:', err.message);
                })
            );
        }

        // Wait for both in parallel
        await Promise.allSettled(queries);

        if (opts.signal?.aborted) return [];

        // Sort by score, return top N
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, limit);
    }

    /**
     * ASSOCIATIVE MEMORY: Store memories extracted from agent output.
     * Called automatically after each agent turn.
     * @param {string[]} memories
     * @param {string} [role='assistant']
     * @param {Object} [opts]
     * @param {AbortSignal} [opts.signal]
     */
    async storeAssociativeMemories(memories, role = 'assistant', opts = {}) {
        if (!this.resoLangService?.isInitialized || memories.length === 0) return;

        for (const memory of memories) {
            if (opts.signal?.aborted) return;
            try {
                await this.resoLangService.processMessage(role, memory);
            } catch (err) {
                console.warn('[AssociativeMemory] ResoLang store failed:', err.message);
            }
        }
    }

    /**
     * Store interaction in CognitiveCore holographic memory.
     * @param {string} input
     * @param {string} output
     */
    rememberInteraction(input, output) {
        if (this.cognitiveCore) {
            try {
                this.cognitiveCore.remember(input, output);
            } catch (err) {
                console.warn('[HolographicMemory] CognitiveCore remember failed:', err.message);
            }
        }
    }

    /**
     * Process input through cognitive core (updates physics state).
     * @param {string} text
     * @returns {Object|null}
     */
    processInput(text) {
        if (this.cognitiveCore) {
            try {
                return this.cognitiveCore.processInput(text);
            } catch (err) {
                console.warn('[HolographicMemory] CognitiveCore processInput failed:', err.message);
                return null;
            }
        }
        return null;
    }

    /**
     * ON-DEMAND MEMORY: Explicit RECALL command.
     * Queries all three stores (ResoLang, CognitiveCore, Global) in parallel.
     * @param {string} query
     * @param {Object} [opts]
     * @param {AbortSignal} [opts.signal]
     * @returns {Promise<Array>}
     */
    async recall(query, opts = {}) {
        if (opts.signal?.aborted) return [];

        const hasReso = !!this.resoLangService?.isInitialized;
        const hasCog = !!this.cognitiveCore;
        const limit = this.maxRecallResults;
        const results = [];

        // Build parallel query promises for all three stores
        const queries = [];

        if (hasReso) {
            // Local holographic recall
            queries.push(
                this.resoLangService.recall(query, limit)
                    .then(resoResults => {
                        for (const r of resoResults) {
                            results.push({
                                source: 'holographic',
                                text: r.text,
                                score: r.score,
                                role: r.role,
                                metadata: r.metadata
                            });
                        }
                    })
                    .catch(err => {
                        console.warn('[HolographicMemory] ResoLang recall failed:', err.message);
                    })
            );

            // Global memory recall
            queries.push(
                this.resoLangService.queryGlobal(query, 3)
                    .then(globalResults => {
                        for (const r of globalResults) {
                            results.push({
                                source: 'global',
                                text: r.text,
                                score: r.score,
                                metadata: r.metadata
                            });
                        }
                    })
                    .catch(_e => { /* ignore — queryGlobal may not be available */ })
            );
        }

        if (hasCog) {
            queries.push(
                Promise.resolve().then(() => {
                    const cogResults = this.cognitiveCore.recall(query, limit);
                    for (const r of cogResults) {
                        results.push({
                            source: 'cognitive',
                            text: `${r.input} → ${r.output}`,
                            score: r.score
                        });
                    }
                }).catch(err => {
                    console.warn('[HolographicMemory] CognitiveCore recall failed:', err.message);
                })
            );
        }

        // Wait for all stores in parallel
        if (queries.length > 0) {
            await Promise.allSettled(queries);
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, limit);
    }

    /**
     * ON-DEMAND MEMORY: Explicit REMEMBER command.
     * Stores in both ResoLang and CognitiveCore in parallel.
     * @param {string} text
     * @returns {Promise<string>}
     */
    async remember(text) {
        const tasks = [];

        if (this.resoLangService?.isInitialized) {
            tasks.push(
                this.resoLangService.processMessage('system', text)
                    .catch(err => {
                        console.warn('[HolographicMemory] ResoLang remember failed:', err.message);
                    })
            );
        }

        if (this.cognitiveCore) {
            try {
                this.cognitiveCore.remember(text, '[explicitly stored]');
            } catch (err) {
                console.warn('[HolographicMemory] CognitiveCore remember failed:', err.message);
            }
        }

        if (tasks.length > 0) {
            await Promise.allSettled(tasks);
        }

        return 'Memory stored successfully.';
    }

    /**
     * GLOBAL MEMORY: Query cross-workspace global memory.
     * @param {string} query
     * @param {number} [limit=5]
     * @returns {Promise<Array>}
     */
    async recallGlobal(query, limit = 5) {
        if (!this.resoLangService?.isInitialized) {
            return [];
        }
        try {
            const results = await this.resoLangService.queryGlobal(query, limit);
            return results.map(r => ({
                source: 'global',
                text: r.text,
                score: r.score,
                metadata: r.metadata
            }));
        } catch (err) {
            console.warn('[HolographicMemory] Global recall failed:', err.message);
            return [];
        }
    }

    /**
     * GLOBAL MEMORY: Promote a memory to cross-workspace global store.
     * @param {string} text
     * @returns {Promise<string>}
     */
    async rememberGlobal(text) {
        if (!this.resoLangService?.isInitialized) {
            return 'Global memory not available — ResoLangService not initialized.';
        }
        try {
            await this.resoLangService.promoteToGlobal(text);
            return 'Memory promoted to global store successfully.';
        } catch (err) {
            return `Global memory store failed: ${err.message}`;
        }
    }

    /**
     * Get cognitive state context string for system prompt injection.
     * @returns {string}
     */
    getCognitiveStateContext() {
        if (this.cognitiveCore) {
            try {
                return this.cognitiveCore.getStateContext();
            } catch (err) {
                console.warn('[HolographicMemory] getStateContext failed:', err.message);
            }
        }
        
        // Fallback: use ResoLangService state
        if (this.resoLangService?.isInitialized) {
            try {
                const state = this.resoLangService.getAgentState();
                if (state) {
                    return `[Cognitive State]\nCoherence: ${state.coherence.toFixed(3)} | Entropy: ${state.entropy.toFixed(3)}\n`;
                }
            } catch (_e) { /* ignore */ }
        }
        
        return '';
    }

    /**
     * Lightweight cognitive state summary for event payloads and diagnostics.
     * Avoids building the full context string when only numeric values are needed.
     * @returns {Object|null}
     */
    getCognitiveStateSummary() {
        if (this.cognitiveCore) {
            try {
                return {
                    coherence: this.cognitiveCore.coherence,
                    entropy: this.cognitiveCore.entropy
                };
            } catch (_e) { /* ignore */ }
        }

        if (this.resoLangService?.isInitialized) {
            try {
                const state = this.resoLangService.getAgentState();
                if (state) {
                    return { coherence: state.coherence, entropy: state.entropy };
                }
            } catch (_e) { /* ignore */ }
        }

        return null;
    }

    /**
     * Tick the physics simulation.
     */
    tick() {
        if (this.cognitiveCore) {
            try {
                this.cognitiveCore.tick();
            } catch (err) {
                console.warn('[HolographicMemory] tick failed:', err.message);
            }
        }
    }

    /**
     * Reset all memory state.
     */
    reset() {
        if (this.cognitiveCore) {
            try {
                this.cognitiveCore.reset();
            } catch (_e) { /* ignore */ }
        }
    }

    /**
     * Get diagnostics.
     * @returns {Object}
     */
    getDiagnostics() {
        return {
            initialized: this._initialized,
            hasResoLang: !!this.resoLangService?.isInitialized,
            hasCognitiveCore: !!this.cognitiveCore,
            cognitiveState: this.cognitiveCore?.getDiagnostics?.() || null,
            resoLangState: this.resoLangService?.getAgentState?.() || null
        };
    }
}
