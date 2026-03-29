/**
 * ConversationContext — encapsulates all per-conversation state.
 *
 * Each conversation gets its own ConversationContext instance, which
 * carries the HistoryManager, LLM history, experience buffer, busy
 * state, and abort controller.  This ensures conversations are
 * independent from conception and prevents state bleeding across them.
 *
 * @module src/core/conversation-context
 */

import { HistoryManager } from './history-manager.mjs';

export class ConversationContext {
    /**
     * @param {string} name — conversation name (e.g. "chat", "dev-task")
     * @param {import('./history-manager.mjs').HistoryManager} historyManager
     */
    constructor(name, historyManager) {
        /** @type {string} Conversation name */
        this.name = name;

        /** @type {import('./history-manager.mjs').HistoryManager} */
        this.historyManager = historyManager;

        /**
         * Per-conversation LLM history for the AI provider.
         * This replaces the singleton `EventicAIProvider.conversationHistory`.
         * @type {Array<{role: string, content: string}>}
         */
        this.aiProviderHistory = [];

        /**
         * Per-conversation experience ring buffer.
         * Stores interaction records scoped to this conversation.
         * @type {Array<Object>}
         */
        this.experiences = [];

        /**
         * Whether this conversation has an active operation in flight.
         * @type {boolean}
         */
        this.isBusy = false;

        /**
         * AbortController for the currently active operation (if any).
         * @type {AbortController|null}
         */
        this.abortController = null;

        /**
         * ISO timestamp of when this conversation was created.
         * @type {string}
         */
        this.createdAt = new Date().toISOString();
    }

    /**
     * Mark this conversation as busy with a new AbortController.
     * @returns {AbortController} the controller for the new operation
     */
    markBusy() {
        this.isBusy = true;
        this.abortController = new AbortController();
        return this.abortController;
    }

    /**
     * Mark this conversation as idle and clear the abort controller.
     */
    markIdle() {
        this.isBusy = false;
        this.abortController = null;
    }

    /**
     * Agent ID if this conversation was promoted to an agent.
     * @type {string|null}
     */
    promotedToAgentId = null;

    /**
     * Whether this conversation has been promoted to an agent.
     * @returns {boolean}
     */
    get isPromoted() {
        return this.promotedToAgentId !== null;
    }

    /**
     * Clear conversation-specific state (experiences, AI history) without
     * affecting the HistoryManager (which has its own reset method).
     */
    clearConversationState() {
        this.aiProviderHistory = [];
        this.experiences = [];
    }

    /**
     * Deep-clone this ConversationContext, producing an independent copy
     * with its own HistoryManager, AI provider history, and experience buffer.
     *
     * The cloned context is suitable for use by a promoted ConversationAgent —
     * mutations to the clone do not affect the original.
     *
     * @param {string} [newName] — optional new name for the clone (defaults to original name)
     * @returns {ConversationContext}
     */
    clone(newName) {
        // Deep-copy the history via JSON round-trip (same approach as facade-conversation.mjs:72)
        const historySnapshot = JSON.parse(JSON.stringify(this.historyManager.getHistory()));

        // Create a new HistoryManager with the same config
        const clonedHm = new HistoryManager(
            this.historyManager.maxTokens,
            this.historyManager.contextWindowSize
        );
        clonedHm.setHistory(historySnapshot, true);

        // If the original has a system message, preserve it
        if (this.historyManager.systemMessage) {
            clonedHm.systemMessage = this.historyManager.systemMessage;
        }

        const cloned = new ConversationContext(newName || this.name, clonedHm);
        cloned.aiProviderHistory = JSON.parse(JSON.stringify(this.aiProviderHistory));
        cloned.experiences = JSON.parse(JSON.stringify(this.experiences));
        cloned.createdAt = new Date().toISOString();

        return cloned;
    }
}
