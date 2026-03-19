/**
 * EventicProvider — default agentic provider that wraps the existing
 * Eventic engine agent loop (EventicAgentLoopPlugin).
 *
 * This provider preserves 100% of the current behavior. The run() method
 * delegates to engine.dispatch('AGENT_START'), exactly as EventicFacade.run()
 * did before modularization.
 *
 * @module src/core/agentic/eventic-provider
 */

import { AgenticProvider } from './base-provider.mjs';
import { EventicAgentLoopPlugin } from '../eventic-agent-loop-plugin.mjs';

export class EventicProvider extends AgenticProvider {
    get id() { return 'eventic'; }
    get name() { return 'Eventic Agent Loop'; }
    get description() {
        return 'Default actor-critic agent loop with pre-check, tool execution, and quality evaluation.';
    }

    /**
     * Install the EventicAgentLoopPlugin handlers on the Eventic engine.
     * Called by EventicFacade during construction.
     * @param {import('../eventic.mjs').Eventic} engine
     */
    install(engine) {
        engine.use(EventicAgentLoopPlugin);
    }

    async initialize(deps) {
        await super.initialize(deps);
        // The EventicAgentLoopPlugin is already installed on the engine
        // during EventicFacade construction — nothing else to do.
    }

    /**
     * Process input through the Eventic engine.
     *
     * @param {string} input
     * @param {Object} options
     * @returns {Promise<{response: string, tokenUsage: Object|null}>}
     */
    async run(input, options = {}) {
        return this._deduplicatedRun(input, options, async () => {
            const { engine } = this._deps;

            const result = await engine.dispatch('AGENT_START', {
                input,
                signal: options.signal,
                stream: options.stream,
                onChunk: options.onChunk,
                // Pass model via payload so the plugin can use per-request
                // model override via options threading (no shared state mutation)
                model: options.model || undefined,
            });
            const response = result?.response || '';
            return {
                response: response.trim() ? response : 'No response generated.',
                tokenUsage: result?.tokenUsage || null,
            };
        });
    }

    async dispose() {
        // EventicAgentLoopPlugin handlers are stateless — nothing to clean up
        await super.dispose();
    }
}
