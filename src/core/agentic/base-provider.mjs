/**
 * AgenticProvider — abstract base class for pluggable agentic loop providers.
 *
 * Every agentic provider must extend this class and implement the required
 * methods. The EventicFacade delegates user input processing to whichever
 * provider is currently active in the AgenticProviderRegistry.
 *
 * @module src/core/agentic/base-provider
 */

export class AgenticProvider {
    /**
     * Unique machine-readable identifier for this provider.
     * @type {string}
     */
    get id() {
        throw new Error('AgenticProvider.id must be overridden');
    }

    /**
     * Human-readable display name.
     * @type {string}
     */
    get name() {
        throw new Error('AgenticProvider.name must be overridden');
    }

    /**
     * Short description of what this provider does.
     * @type {string}
     */
    get description() {
        return '';
    }

    /**
     * Initialize the provider with shared dependencies from EventicFacade.
     * Called once when this provider becomes active.
     *
     * @param {Object} deps
     * @param {import('../eventic-ai-plugin.mjs').EventicAIProvider} deps.aiProvider
     * @param {import('../../execution/tool-executor.mjs').ToolExecutor} deps.toolExecutor
     * @param {import('../history-manager.mjs').HistoryManager} deps.historyManager
     * @param {import('../../lib/event-bus.mjs').AiManEventBus} deps.eventBus
     * @param {Object} deps.consciousness
     * @param {string} deps.workingDir
     * @param {import('../eventic.mjs').Eventic} deps.engine
     * @param {Object} deps.facade — the EventicFacade instance (for reading state)
     */
    async initialize(deps) {
        this._deps = deps;
    }

    /**
     * Process a user input and return a response string.
     * This is the main entry point — replaces engine.dispatch('AGENT_START').
     *
     * @param {string} input — user message
     * @param {Object} options
     * @param {AbortSignal} [options.signal]
     * @param {boolean}     [options.stream]
     * @param {Function}    [options.onChunk]
     * @param {string}      [options.model]
     * @returns {Promise<string|{response: string, streamed: boolean}>}
     *   May return a plain string OR an object with a `streamed` flag.
     *   When `streamed` is true the caller must NOT re-emit the response.
     */
    async run(input, options = {}) {
        throw new Error('AgenticProvider.run() must be overridden');
    }

    /**
     * Optional: Install Eventic engine handlers.
     * Only used by providers that integrate with the Eventic engine directly
     * (e.g. the default EventicProvider).
     *
     * @param {import('../eventic.mjs').Eventic} engine
     */
    install(engine) {
        // No-op by default — override in subclasses that need Eventic handlers
    }

    /**
     * Cleanup when switching away from this provider.
     * Override to release resources, remove event listeners, etc.
     */
    async dispose() {
        this._deps = null;
    }
}
