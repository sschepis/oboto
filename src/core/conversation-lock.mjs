// ConversationLock — Per-conversation serialization for concurrent requests.
//
// Requests to the SAME conversation are serialized (queued).
// Requests to DIFFERENT conversations run fully in parallel.
//
// This prevents race conditions on shared HistoryManager state within a
// single conversation while allowing true concurrency across conversations.

export class ConversationLock {
    constructor() {
        /** @type {Map<string, Promise<any>>} */
        this._locks = new Map();
    }

    /**
     * Acquire a lock for a conversation and execute a function.
     * If the conversation is already locked, the function waits in queue.
     *
     * @param {string} conversationName
     * @param {Function} fn - Async function to execute while holding the lock
     * @returns {Promise<any>} The result of fn()
     */
    async acquire(conversationName, fn) {
        // Get the current promise chain for this conversation (or resolved if none)
        const prev = this._locks.get(conversationName) || Promise.resolve();

        // Chain our work after the previous work completes
        // Use .then() to chain, but catch errors so the chain continues for the next caller
        let resolve;
        const gate = new Promise(r => { resolve = r; });

        const next = prev.then(async () => {
            try {
                return await fn();
            } finally {
                resolve(); // Release the lock for the next waiter
            }
        });

        // Store the gate (not the result promise) so subsequent callers wait for us
        this._locks.set(conversationName, gate);

        // Clean up when the chain is fully idle
        gate.then(() => {
            // Only clean up if we're still the latest in the chain
            if (this._locks.get(conversationName) === gate) {
                this._locks.delete(conversationName);
            }
        });

        return next;
    }

    /**
     * Check if a conversation currently has a pending lock.
     * @param {string} conversationName
     * @returns {boolean}
     */
    isLocked(conversationName) {
        return this._locks.has(conversationName);
    }
}
