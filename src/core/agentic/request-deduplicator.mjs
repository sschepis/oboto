/**
 * RequestDeduplicator — coalesces identical concurrent LLM requests so only
 * one actual API call is made and all callers receive the same result.
 *
 * When the same request arrives while a previous one is in-flight, returns
 * the same Promise to the second caller. Failed requests are removed
 * immediately so retries can proceed.
 *
 * @module src/core/agentic/request-deduplicator
 */

import { createHash } from 'crypto';

export class RequestDeduplicator {
    /**
     * @param {Object} options
     * @param {number} [options.ttlMs=30000] - Time-to-live for dedup entries
     * @param {number} [options.maxEntries=100] - Max concurrent dedup entries
     */
    constructor(options = {}) {
        this._ttlMs = options.ttlMs ?? 30000;
        this._maxEntries = options.maxEntries ?? 100;
        /** @type {Map<string, { promise: Promise, timestamp: number }>} */
        this._inflight = new Map();
        /** @type {Map<string, NodeJS.Timeout>} Tracks pending cleanup timers */
        this._timers = new Map();
    }

    /**
     * Generate a dedup key from request parameters.
     *
     * The key is a 16-char hex prefix of a SHA-256 hash of the concatenated
     * input, model, and system prompt hash. Temperature, tools, signal, and
     * onChunk are excluded — see design doc §4.2 for rationale.
     *
     * @param {string} input - User input
     * @param {string} model - Model name
     * @param {string} [systemPromptHash] - Hash of system prompt (optional, for efficiency)
     * @returns {string} 16-char hex hash key
     */
    makeKey(input, model, systemPromptHash) {
        const raw = `${input}\x00${model || ''}\x00${systemPromptHash || ''}`;
        return createHash('sha256').update(raw).digest('hex').substring(0, 16);
    }

    /**
     * Execute a function with deduplication. If an identical request is already
     * in-flight, return the same promise instead of executing again.
     *
     * @param {string} key - Dedup key (from makeKey)
     * @param {Function} fn - Async function to execute if not already in-flight
     * @returns {Promise<any>} The result
     */
    async dedupe(key, fn) {
        // If already in-flight and within TTL, return existing promise
        const existing = this._inflight.get(key);
        if (existing && (Date.now() - existing.timestamp) < this._ttlMs) {
            return existing.promise;
        }

        // Evict expired entries
        this._cleanup();

        // Create new entry — fn() is called immediately, and the resulting
        // promise is shared with any subsequent callers that arrive before
        // the promise settles.
        const entry = { timestamp: Date.now() };
        entry.promise = fn()
            .then(result => {
                // Keep in map briefly for very-close-together duplicates, then remove.
                // Track the timer so dispose()/clear() can cancel it.
                const timer = setTimeout(() => {
                    this._inflight.delete(key);
                    this._timers.delete(key);
                }, 100);
                this._timers.set(key, timer);
                return result;
            })
            .catch(err => {
                // On failure, remove immediately so retries can proceed
                this._inflight.delete(key);
                this._timers.delete(key);
                throw err;
            });

        this._inflight.set(key, entry);
        return entry.promise;
    }

    /**
     * Check if a key is currently in-flight.
     * @param {string} key
     * @returns {boolean}
     */
    has(key) {
        const entry = this._inflight.get(key);
        return !!entry && (Date.now() - entry.timestamp) < this._ttlMs;
    }

    /**
     * Get current number of in-flight entries.
     * @returns {number}
     */
    get size() {
        return this._inflight.size;
    }

    /**
     * Remove expired entries and enforce maxEntries.
     * @private
     */
    _cleanup() {
        const now = Date.now();
        for (const [key, entry] of this._inflight) {
            if ((now - entry.timestamp) >= this._ttlMs) {
                this._inflight.delete(key);
                // Clear the associated timer to prevent leaks
                const timer = this._timers.get(key);
                if (timer) { clearTimeout(timer); this._timers.delete(key); }
            }
        }
        // If still over limit, remove oldest entries until under maxEntries
        while (this._inflight.size >= this._maxEntries) {
            const oldest = this._inflight.keys().next().value;
            if (oldest === undefined) break;
            this._inflight.delete(oldest);
            const timer = this._timers.get(oldest);
            if (timer) { clearTimeout(timer); this._timers.delete(oldest); }
        }
    }

    /**
     * Clear all entries and cancel pending cleanup timers.
     */
    clear() {
        for (const timer of this._timers.values()) {
            clearTimeout(timer);
        }
        this._timers.clear();
        this._inflight.clear();
    }

    /**
     * Dispose — clear and prevent further use.
     */
    dispose() {
        this.clear();
    }
}
