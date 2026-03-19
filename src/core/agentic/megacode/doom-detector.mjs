/**
 * DoomDetector — prevents infinite tool call cycles in the ReAct loop.
 *
 * Tracks recent tool calls and detects when the LLM is calling the same
 * tool with identical arguments repeatedly (a "doom loop").  Ported from
 * megacode's processor.ts doom loop detection (L154-178).
 *
 * @module src/core/agentic/megacode/doom-detector
 */

export class DoomDetector {
    /**
     * @param {Object} [options]
     * @param {number} [options.threshold=3]   — identical calls before triggering
     * @param {number} [options.windowSize=10] — number of recent calls to track
     */
    constructor(options = {}) {
        this._threshold = options.threshold ?? 3;
        this._windowSize = options.windowSize ?? 10;
        /** @type {Array<{ key: string, toolName: string }>} */
        this._recentCalls = [];
    }

    /**
     * Record a tool call and check if a doom loop is detected.
     *
     * A doom loop occurs when the last `threshold` entries in the window
     * all share the same dedup key (tool name + serialised arguments).
     *
     * @param {string} toolName
     * @param {Object} args
     * @returns {{ isDoom: boolean, tool?: string, count?: number }}
     */
    check(toolName, args) {
        const key = this._makeKey(toolName, args);
        this._recentCalls.push({ key, toolName });

        // Keep the window bounded
        if (this._recentCalls.length > this._windowSize) {
            this._recentCalls.shift();
        }

        // Count consecutive identical calls from the end of the window
        let consecutiveCount = 0;
        for (let i = this._recentCalls.length - 1; i >= 0; i--) {
            if (this._recentCalls[i].key === key) {
                consecutiveCount++;
            } else {
                break;
            }
        }

        if (consecutiveCount >= this._threshold) {
            return { isDoom: true, tool: toolName, count: consecutiveCount };
        }

        return { isDoom: false, count: consecutiveCount };
    }

    /**
     * Generate a dedup key from tool name + args.
     * Uses JSON.stringify for deterministic hashing — objects with
     * identical shapes and values produce the same key.
     *
     * @param {string} toolName
     * @param {Object} args
     * @returns {string}
     * @private
     */
    _makeKey(toolName, args) {
        try {
            return `${toolName}::${JSON.stringify(args)}`;
        } catch {
            // If args contain circular references, fall back to tool name only
            return `${toolName}::__unserializable__`;
        }
    }

    /**
     * Reset the detector — call at the start of each run.
     */
    reset() {
        this._recentCalls = [];
    }
}
