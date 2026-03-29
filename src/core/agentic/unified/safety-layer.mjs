/**
 * SafetyLayer — safety check layer wrapping cognitive safety + doom detection.
 *
 * Combines two protection mechanisms:
 *  1. **Cognitive safety** — delegated to {@link CognitiveLayer.checkSafety}
 *     for coherence / entropy boundary violations.
 *  2. **Doom detection** — ported from {@link DoomDetector} in
 *     `src/core/agentic/megacode/doom-detector.mjs`.  Detects infinite
 *     tool-call loops by tracking recent calls in a sliding window.
 *
 * The doom detector supports both the original DoomDetector `check(tool, args)`
 * pattern and an additional `checkDoom(history, toolResults, iteration)`
 * higher-level API that scans recent history for doom patterns.
 *
 * @module src/core/agentic/unified/safety-layer
 */

/**
 * Safety guard that the UnifiedProvider agent loop calls before and during
 * tool execution to prevent runaway loops and cognitive instability.
 */
export class SafetyLayer {
  /**
   * @param {Object} params
   * @param {Object} params.config — resolved unified config
   * @param {import('./cognitive-layer.mjs').CognitiveLayer} params.cognitiveLayer
   */
  constructor({ config, cognitiveLayer }) {
    /** @type {Object} */
    this._config = config;

    /** @type {import('./cognitive-layer.mjs').CognitiveLayer} */
    this._cognitiveLayer = cognitiveLayer;

    /**
     * Sliding window of recent tool call dedup keys.
     * Each entry carries the iteration index so that batched same-turn
     * calls can be collapsed when counting doom hits.
     * @type {Array<{ key: string, toolName: string, iteration: number }>}
     */
    this._recentCalls = [];

    /** @type {number} */
    this._windowSize = 10;

    /** @type {number} */
    this._threshold = 3;

    /**
     * Internal iteration counter used by {@link recordToolCall} which
     * doesn't receive an explicit iteration parameter.  Incremented
     * each time {@link checkDoom} is called.
     * @type {number}
     */
    this._iterationCounter = 0;

    /** @type {Array<RegExp>} compiled doom patterns */
    this._doomPatterns = this._buildDoomPatterns(config);
  }

  // ════════════════════════════════════════════════════════════════════
  // Cognitive Safety
  // ════════════════════════════════════════════════════════════════════

  /**
   * Run cognitive safety checks (coherence floor, entropy ceiling).
   *
   * @param {string} _input — current user input (reserved for future use)
   * @returns {{ safe: boolean, violations: Array<Object>, shouldBlock: boolean }}
   */
  checkSafety(_input) {
    const safetyConfig = this._config.safety ?? {};
    if (!safetyConfig.enabled) {
      return { safe: true, violations: [], shouldBlock: false };
    }

    const violations = this._cognitiveLayer
      ? this._cognitiveLayer.checkSafety()
      : [];

    const shouldBlock =
      safetyConfig.blockOnViolation &&
      violations.some((v) => v.response === 'block');

    return {
      safe: violations.length === 0,
      violations,
      shouldBlock,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // Doom Detection
  // ════════════════════════════════════════════════════════════════════

  /**
   * Check for doom-loop patterns in recent tool call history.
   *
   * Doom detection combines two strategies (ported from
   * `src/core/agentic/megacode/doom-detector.mjs`):
   *
   *  1. **Consecutive identical calls** — the same tool+args dedup key
   *     appearing `threshold` times in a row.
   *  2. **Pattern matching** — regex patterns from `config.doom.patterns`
   *     tested against recent dedup keys.
   *  3. **Empty response detection** — flagged when tool results are
   *     repeatedly empty.
   *  4. **Iteration ceiling** — hard limit from `config.loop.maxIterations`.
   *
   * @param {Array<Object>} history — conversation history messages
   * @param {Array<Object>} toolResults — recent tool call results
   *   (`[{ toolName, args, result }]`)
   * @param {number} iteration — current loop iteration index
   * @param {number} [maxIterOverride] — optional per-task max iteration override
   *   (e.g. background tasks use `maxBackgroundIterations`)
   * @returns {{ doomed: boolean, reason: string|null, pattern: string|null }}
   */
  checkDoom(history, toolResults, iteration, maxIterOverride) {
    const doomConfig = this._config.doom ?? {};
    if (!doomConfig.enabled) {
      return { doomed: false, reason: null, pattern: null };
    }

    // Track the iteration for recordToolCall's internal counter
    this._iterationCounter = iteration;

    const maxIterations = maxIterOverride || (this._config.loop?.maxIterations ?? 25);

    // ── 1. Iteration ceiling ─────────────────────────────────────────
    if (iteration >= maxIterations) {
      return {
        doomed: true,
        reason: `Reached maximum iteration limit (${maxIterations})`,
        pattern: 'max_iterations',
      };
    }

    // ── 2. Record latest tool calls & check consecutive duplicates ───
    // All tool calls from this batch share the same iteration index so
    // that N batched calls within a single turn count as 1 turn-hit for
    // doom detection purposes.
    for (const tr of toolResults) {
      const key = this._makeKey(tr.toolName, tr.args);
      this._recentCalls.push({ key, toolName: tr.toolName, iteration });
      if (this._recentCalls.length > this._windowSize) {
        this._recentCalls.shift();
      }
    }

    // Check for consecutive identical calls — count *distinct iterations*
    // sharing the same trailing dedup key, not individual entries.
    // This prevents a batch of e.g. 6 curls (all different args) from
    // triggering the consecutive-identical check, while still catching
    // "same tool+args across 3 separate turns".
    if (this._recentCalls.length >= this._threshold) {
      const lastKey = this._recentCalls[this._recentCalls.length - 1]?.key;
      const consecutiveIterations = new Set();
      for (let i = this._recentCalls.length - 1; i >= 0; i--) {
        if (this._recentCalls[i].key === lastKey) {
          consecutiveIterations.add(this._recentCalls[i].iteration);
        } else {
          break;
        }
      }
      if (consecutiveIterations.size >= this._threshold) {
        return {
          doomed: true,
          reason: `Tool "${this._recentCalls[this._recentCalls.length - 1].toolName}" called across ${consecutiveIterations.size} iterations with identical arguments`,
          pattern: 'consecutive_identical',
        };
      }
    }

    // ── 3. Regex pattern matching against recent keys ────────────────
    // Count *distinct iterations* matching the pattern, not individual
    // entries.  This is the fix for the false positive: 6 `run_command`
    // calls in a single batch now count as 1 iteration-hit, not 6.
    for (const re of this._doomPatterns) {
      const matchingIterations = new Set(
        this._recentCalls.filter((c) => re.test(c.key)).map((c) => c.iteration),
      );
      if (matchingIterations.size >= this._threshold) {
        return {
          doomed: true,
          reason: `Doom pattern matched: ${re.source} (${matchingIterations.size} iterations in window)`,
          pattern: re.source,
        };
      }
    }

    // ── 4. Empty response detection ──────────────────────────────────
    const recentEmpty = toolResults.filter((tr) => {
      const r = tr.result;
      return r === '' || r === null || r === undefined || r === '{}' || r === '[]';
    });
    if (recentEmpty.length >= this._threshold) {
      return {
        doomed: true,
        reason: `${recentEmpty.length} consecutive empty tool results`,
        pattern: 'empty_results',
      };
    }

    return { doomed: false, reason: null, pattern: null };
  }

  /**
   * Record a single tool call for doom tracking (lower-level API matching
   * the original DoomDetector interface).
   *
   * @param {string} toolName
   * @param {Object} args
   * @param {number} [iteration] — optional iteration index; falls back to
   *   the internal counter tracked via {@link checkDoom} calls.
   * @returns {{ isDoom: boolean, tool?: string, count?: number }}
   */
  recordToolCall(toolName, args, iteration) {
    const iter = iteration ?? this._iterationCounter;
    const key = this._makeKey(toolName, args);
    this._recentCalls.push({ key, toolName, iteration: iter });
    if (this._recentCalls.length > this._windowSize) {
      this._recentCalls.shift();
    }

    // Count distinct iterations with this key in consecutive tail
    const consecutiveIterations = new Set();
    for (let i = this._recentCalls.length - 1; i >= 0; i--) {
      if (this._recentCalls[i].key === key) {
        consecutiveIterations.add(this._recentCalls[i].iteration);
      } else {
        break;
      }
    }

    if (consecutiveIterations.size >= this._threshold) {
      return { isDoom: true, tool: toolName, count: consecutiveIterations.size };
    }
    return { isDoom: false, count: consecutiveIterations.size };
  }

  /**
   * Reset the doom detector — call at the start of each turn.
   */
  reset() {
    this._recentCalls = [];
    this._iterationCounter = 0;
  }

  // ════════════════════════════════════════════════════════════════════
  // Accessors
  // ════════════════════════════════════════════════════════════════════

  /**
   * Whether safety checks are active.
   *
   * @returns {boolean}
   */
  get enabled() {
    return !!(this._config.safety?.enabled || this._config.doom?.enabled);
  }

  // ════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ════════════════════════════════════════════════════════════════════

  /**
   * Compile regex patterns from `config.doom.patterns`.
   *
   * Accepts both `RegExp` instances and plain strings.
   *
   * @param {Object} config — resolved unified config
   * @returns {Array<RegExp>}
   * @private
   */
  _buildDoomPatterns(config) {
    const raw = config.doom?.patterns ?? [];
    const compiled = [];
    for (const p of raw) {
      try {
        if (p instanceof RegExp) {
          compiled.push(p);
        } else if (typeof p === 'string') {
          compiled.push(new RegExp(p));
        }
      } catch (err) {
        console.warn('[SafetyLayer] Invalid doom pattern, skipping:', p, err.message);
      }
    }
    return compiled;
  }

  /**
   * Generate a dedup key from tool name + args (mirrors DoomDetector._makeKey).
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
      return `${toolName}::__unserializable__`;
    }
  }
}

export default SafetyLayer;
