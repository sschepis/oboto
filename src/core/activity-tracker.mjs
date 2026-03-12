/**
 * ActivityTracker — periodic heartbeat status emitter.
 *
 * Tracks the current activity description and re-emits it every
 * `intervalMs` (default 3 000 ms) with elapsed time so the operator
 * always knows what the assistant is doing, even during long-running
 * operations like LLM calls.
 *
 * Usage:
 *   const tracker = new ActivityTracker();
 *   tracker.setActivity('Thinking…');  // emits immediately
 *   // ... every 3s: "Thinking… (3s)", "Thinking… (6s)", ...
 *   tracker.setActivity('Executing: read_file'); // resets timer, emits immediately
 *   tracker.stop(); // cleans up
 *
 * @module src/core/activity-tracker
 */

import { emitStatus } from './status-reporter.mjs';

export class ActivityTracker {
    /**
     * @param {Object} [opts]
     * @param {number} [opts.intervalMs=3000] — heartbeat interval in milliseconds
     */
    constructor(opts = {}) {
        this.intervalMs = opts.intervalMs || 3000;
        this._activity = null;
        this._phase = null;
        this._startedAt = null;
        this._timer = null;
        this._stopped = false;
    }

    /**
     * Set the current activity description with an optional phase context.
     * Emits immediately, then re-emits with elapsed time on each heartbeat tick.
     * The phase determines the heartbeat message style so the user knows whether
     * the agent is waiting for the LLM, executing a tool, or doing internal work.
     *
     * @param {string} description — e.g. "Sending request to AI model", "Reading src/main.mjs"
     * @param {Object} [opts]
     * @param {string} [opts.phase] — 'llm-call' (uses dedicated heartbeat text) | 'tool-exec' | null
     */
    setActivity(description, opts = {}) {
        // Reset the stopped flag so the tracker can be reused across
        // multiple CognitiveAgent.turn() calls without re-instantiation.
        this._stopped = false;
        this._activity = description;
        this._phase = opts.phase || null;
        this._startedAt = Date.now();

        // Emit immediately
        emitStatus(description);

        // Restart heartbeat timer.
        // unref() prevents the timer from keeping the Node.js event loop
        // alive if stop() is never called (e.g. unhandled error path).
        this._clearTimer();
        this._timer = setInterval(() => this._tick(), this.intervalMs);
        if (this._timer.unref) this._timer.unref();
    }

    /**
     * Stop all heartbeat emissions. Safe to call multiple times.
     */
    stop() {
        this._stopped = true;
        this._clearTimer();
        this._activity = null;
        this._phase = null;
        this._startedAt = null;
    }

    /**
     * Get the current activity description (or null if idle).
     * @returns {string|null}
     */
    get currentActivity() {
        return this._activity;
    }

    // ── Internal ───────────────────────────────────────────────

    /**
     * Emit the current activity with elapsed time suffix.
     * Uses phase-aware messaging so the user understands what kind
     * of wait is happening (LLM call vs tool execution vs processing).
     */
    _tick() {
        if (this._stopped || !this._activity) return;
        const elapsed = Math.round((Date.now() - this._startedAt) / 1000);

        if (this._phase === 'llm-call') {
            emitStatus(`Waiting for AI response… (${elapsed}s)`);
        } else {
            emitStatus(`${this._activity} (${elapsed}s)`);
        }
    }

    _clearTimer() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }
}
