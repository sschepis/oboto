/**
 * AgenticProvider — abstract base class for pluggable agentic loop providers.
 *
 * Every agentic provider must extend this class and implement the required
 * methods. The EventicFacade delegates user input processing to whichever
 * provider is currently active in the AgenticProviderRegistry.
 *
 * @module src/core/agentic/base-provider
 */

import { RequestDeduplicator } from './request-deduplicator.mjs';

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

    constructor() {
        /** @type {RequestDeduplicator} */
        this._deduplicator = new RequestDeduplicator();
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
     * @returns {Promise<{response: string, streamed?: boolean, tokenUsage?: Object, metadata?: Object}>}
     *   Returns an object with at minimum `response`. Optional fields:
     *   `streamed` (true → caller must NOT re-emit), `tokenUsage` (token counts),
     *   `metadata` (provider-specific diagnostics).
     */
    async run(input, options = {}) {
        throw new Error('AgenticProvider.run() must be overridden');
    }

    /**
     * Wrap a run function with request deduplication.
     *
     * Streaming requests (those with `onChunk` or `onToken` callbacks) are
     * excluded — each streaming caller needs its own stream.  Non-streaming
     * identical concurrent requests share a single Promise.
     *
     * @param {string} input - User input
     * @param {Object} options - Request options (model, signal, onChunk, etc.)
     * @param {Function} runFn - Async function that performs the actual run
     * @returns {Promise<any>}
     * @protected
     */
    async _deduplicatedRun(input, options, runFn) {
        // Streaming requests must NOT be deduplicated — each caller has its
        // own onChunk/onToken callback and potentially its own WebSocket.
        if (options.stream || options.onChunk || options.onToken) {
            return runFn();
        }

        const key = this._deduplicator.makeKey(input, options.model);
        return this._deduplicator.dedupe(key, runFn);
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
     * Check if this provider is healthy and ready to handle requests.
     * Subclasses can override for provider-specific checks.
     * @returns {Promise<{healthy: boolean, reason?: string}>}
     */
    async healthCheck() {
        if (!this._deps) return { healthy: false, reason: 'Not initialized' };
        return { healthy: true };
    }

    /**
     * Cleanup when switching away from this provider.
     * Override to release resources, remove event listeners, etc.
     */
    async dispose() {
        this._deduplicator?.dispose();
        this._deps = null;
    }
}
