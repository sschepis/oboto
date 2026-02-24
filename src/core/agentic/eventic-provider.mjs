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
     * @returns {Promise<string>}
     */
    async run(input, options = {}) {
        const { engine, aiProvider } = this._deps;

        const originalModel = aiProvider.model;
        if (options.model) {
            aiProvider.model = options.model;
        }

        try {
            const result = await engine.dispatch('AGENT_START', {
                input,
                signal: options.signal,
                stream: options.stream,
                onChunk: options.onChunk
            });
            return result.response || 'No response generated.';
        } finally {
            aiProvider.model = originalModel;
        }
    }

    async dispose() {
        // EventicAgentLoopPlugin handlers are stateless — nothing to clean up
        await super.dispose();
    }
}
