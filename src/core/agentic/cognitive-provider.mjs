/**
 * CognitiveProvider — alternate agentic provider that uses the tinyaleph
 * cognitive agent loop with prime-resonant cognitive middleware.
 *
 * Implements the 11-step cognitive loop:
 *  PERCEIVE → ENCODE → ORIENT → ATTEND → GUARD → RECALL →
 *  THINK → EXECUTE → VALIDATE → REMEMBER → EVOLVE
 *
 * Uses ai-man's AI provider for LLM calls and ToolExecutor for tools,
 * so it benefits from all configured backends (Gemini, OpenAI, LMStudio, etc.)
 * and the full ai-man tool ecosystem.
 *
 * @module src/core/agentic/cognitive-provider
 */

import { AgenticProvider } from './base-provider.mjs';
import { CognitiveAgent } from './cognitive/agent.mjs';

export class CognitiveProvider extends AgenticProvider {
    get id() { return 'cognitive'; }
    get name() { return 'Cognitive Agent (TinyAleph)'; }
    get description() {
        return '11-step cognitive loop with prime-resonant middleware, holographic memory, semantic field tracking, and objectivity gating.';
    }

    async initialize(deps) {
        await super.initialize(deps);

        // Create the cognitive agent with ai-man's dependencies
        this._agent = new CognitiveAgent(
            {
                aiProvider: deps.aiProvider,
                toolExecutor: deps.toolExecutor,
                historyManager: deps.historyManager,
                workingDir: deps.workingDir
            },
            // Pass any cognitive-specific config overrides
            deps.cognitiveConfig || {}
        );

        // Initialize the cognitive state with a few physics ticks
        const initTicks = deps.cognitiveConfig?.initTicks ?? 10;
        for (let i = 0; i < initTicks; i++) {
            this._agent.cognitive.tick();
        }

        console.log(
            `[CognitiveProvider] Initialized — coherence=${this._agent.cognitive.coherence.toFixed(3)}, ` +
            `entropy=${this._agent.cognitive.entropy.toFixed(3)}`
        );
    }

    /**
     * Process input through the cognitive agent loop.
     *
     * @param {string} input
     * @param {Object} options
     * @returns {Promise<string>}
     */
    async run(input, options = {}) {
        if (!this._agent) {
            throw new Error('CognitiveProvider not initialized. Call initialize() first.');
        }

        const { aiProvider } = this._deps;
        const originalModel = aiProvider.model;
        if (options.model) {
            aiProvider.model = options.model;
        }

        try {
            const result = await this._agent.turn(input, { signal: options.signal });

            let streamed = false;
            // If streaming was requested, emit the full response as a single chunk
            if (options.stream && typeof options.onChunk === 'function') {
                options.onChunk(result.response);
                streamed = true;
            }

            // Sync the final response into ai-man's history manager
            // so it persists across sessions
            if (this._deps.historyManager) {
                this._deps.historyManager.addMessage('user', input);
                this._deps.historyManager.addMessage('assistant', result.response);
            }

            // Emit metadata to eventBus if available
            if (this._deps.eventBus) {
                this._deps.eventBus.emitTyped('agentic:cognitive-metadata', result.metadata);
            }

            return { response: result.response, streamed };
        } finally {
            aiProvider.model = originalModel;
        }
    }

    /**
     * Get the underlying CognitiveAgent for diagnostics.
     * @returns {CognitiveAgent|null}
     */
    getAgent() {
        return this._agent || null;
    }

    /**
     * Get cognitive diagnostics.
     * @returns {Object|null}
     */
    getDiagnostics() {
        return this._agent?.getStats() || null;
    }

    async dispose() {
        if (this._agent) {
            this._agent.reset();
            this._agent = null;
        }
        await super.dispose();
    }
}
