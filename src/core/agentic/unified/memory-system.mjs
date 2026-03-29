/**
 * MemorySystem — unified 3-layer memory system for the UnifiedProvider.
 *
 * Merges three complementary memory approaches:
 *
 *  1. **Holographic Memory** — backed by {@link HolographicMemoryAdapter}
 *     from `src/core/agentic/lmscript/holographic-memory.mjs`.  Provides
 *     prime-resonant + ResoLang dual-store recall/remember.
 *
 *  2. **Experience Memory** — simple in-memory ring buffer of past
 *     interactions with metadata (tools used, success, cost, duration).
 *     Enables the LearningEngine to mine patterns.
 *
 *  3. **Pattern Memory** — extracted recurring patterns from the experience
 *     store (successful tool sequences, failure signatures, etc.).
 *
 * All three layers are queried through a single `recallAll()` surface and
 * stored through `storeInteraction()`.
 *
 * @module src/core/agentic/unified/memory-system
 */

import { HolographicMemoryAdapter } from '../lmscript/holographic-memory.mjs';

/**
 * Unified memory system combining holographic, experience, and pattern layers.
 */
export class MemorySystem {
  /**
   * @param {Object} params
   * @param {Object} params.config — resolved unified config
   */
  constructor({ config }) {
    /** @type {Object} */
    this._config = config;

    // ── Holographic layer ──────────────────────────────────────────
    /** @type {HolographicMemoryAdapter|null} */
    this._holographic = null;

    // ── Experience layer ───────────────────────────────────────────
    /**
     * Ring buffer of experience records.
     * @type {Array<ExperienceRecord>}
     */
    this._experiences = [];

    /** @type {number} */
    this._maxExperiences = config.memory?.maxExperiences ?? 1000;

    // ── Pattern layer ──────────────────────────────────────────────
    /**
     * Extracted patterns from the experience store.
     * @type {Array<PatternRecord>}
     */
    this._patterns = [];

    /** @type {number} */
    this._maxPatterns = config.memory?.maxPatterns ?? 100;

    /** @type {boolean} */
    this._initialized = false;
  }

  // ════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ════════════════════════════════════════════════════════════════════

  /**
   * Initialize memory layers.
   *
   * @param {Object} [deps={}] — dependency overrides
   * @param {Object} [deps.resoLangService] — optional ResoLangService instance
   * @param {number} [deps.primeCount] — prime count for CognitiveCore
   * @param {number} [deps.objectivityThreshold] — ObjectivityGate threshold
   * @returns {Promise<void>}
   */
  async initialize(deps = {}) {
    const memConfig = this._config.memory ?? {};

    // ── Holographic memory ─────────────────────────────────────────
    if (memConfig.holographicEnabled) {
      try {
        this._holographic = new HolographicMemoryAdapter({
          resoLangService: deps.resoLangService ?? null,
          maxAssociativeResults: 5,
          maxRecallResults: 10,
          primeCount: deps.primeCount ?? 64,
          objectivityThreshold: deps.objectivityThreshold ?? 0.6,
        });
        await this._holographic.initialize(deps);
      } catch (err) {
        console.warn(
          '[MemorySystem] HolographicMemoryAdapter init failed — running without holographic memory:',
          err.message
        );
        this._holographic = null;
      }
    }

    // Experience and pattern stores are in-memory — no async init needed
    this._initialized = true;
  }

  // ════════════════════════════════════════════════════════════════════
  // Holographic Memory Layer
  // ════════════════════════════════════════════════════════════════════

  /**
   * Retrieve from holographic memory using similarity.
   *
   * @param {string} query — search text
   * @param {Object} [opts={}] — forwarded to HolographicMemoryAdapter
   * @returns {Promise<Array<Object>>} matched memories
   */
  async recall(query, opts = {}) {
    if (!this._holographic) return [];
    try {
      return await this._holographic.recall(query, opts);
    } catch (err) {
      console.warn('[MemorySystem] holographic recall failed:', err.message);
      return [];
    }
  }

  /**
   * Store an interaction in holographic memory.
   *
   * @param {string} input — user input text
   * @param {string} response — agent response text
   */
  store(input, response) {
    if (!this._holographic) return;
    try {
      this._holographic.rememberInteraction(input, response);
    } catch (err) {
      console.warn('[MemorySystem] holographic store failed:', err.message);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Experience Memory Layer
  // ════════════════════════════════════════════════════════════════════

  /**
   * @typedef {Object} ExperienceRecord
   * @property {string}  input        — user input text (truncated)
   * @property {string}  response     — agent response text (truncated)
   * @property {Array<string>} toolsUsed — tool names invoked
   * @property {boolean} success      — whether the turn succeeded
   * @property {number}  timestamp    — Date.now() at recording time
   * @property {number}  duration     — turn duration in ms
   * @property {Object}  [tokenUsage] — token usage stats
   */

   /**
    * Store an experience record.
    * When a conversationId is provided, the record is tagged with it
    * so it can be scoped during queries.
    *
    * @param {ExperienceRecord} experience
    * @param {string} [conversationId] — optional conversation identifier
    */
   recordExperience(experience, conversationId) {
     const record = {
       input: (experience.input ?? '').substring(0, 500),
       response: (experience.response ?? '').substring(0, 500),
       toolsUsed: experience.toolsUsed ?? [],
       success: !!experience.success,
       timestamp: experience.timestamp ?? Date.now(),
       duration: experience.duration ?? 0,
       tokenUsage: experience.tokenUsage ?? null,
       conversationId: conversationId || null,
     };

     this._experiences.push(record);

     // Evict oldest when capacity is reached
     while (this._experiences.length > this._maxExperiences) {
       this._experiences.shift();
     }
   }

   /**
    * Find similar past experiences by keyword matching against input text.
    * When a conversationId is provided, only experiences from that
    * conversation are searched (isolated write model).  Without a
    * conversationId, all experiences are searched (shared read model).
    *
    * @param {string} input — current input to match against
    * @param {number} [limit=5] — max results
    * @param {string} [conversationId] — optional conversation scope
    * @returns {Array<ExperienceRecord>} matched experiences sorted by relevance
    */
   queryExperiences(input, limit = 5, conversationId) {
     let pool = this._experiences;
     // Filter to the target conversation if specified
     if (conversationId) {
       pool = pool.filter(exp => exp.conversationId === conversationId);
     }
     if (pool.length === 0) return [];

     const queryWords = new Set(
       input.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
     );

     const scored = pool.map((exp) => {
       const expWords = exp.input.toLowerCase().split(/\s+/);
       const overlap = expWords.filter((w) => queryWords.has(w)).length;
       const recency =
         1 / (1 + (Date.now() - exp.timestamp) / (1000 * 60 * 60));
       return { ...exp, _score: overlap * 0.7 + recency * 0.3 };
     });

     return scored
       .sort((a, b) => b._score - a._score)
       .slice(0, limit)
       .filter((s) => s._score > 0);
   }

   /**
    * Get the N most recent experiences.
    *
    * @param {number} [count=10] — number of experiences to return
    * @returns {Array<ExperienceRecord>}
    */
   getRecentExperiences(count = 10) {
     return this._experiences.slice(-count);
   }

   /**
     * Return a deep copy of all experiences for a specific conversation.
     * Used when promoting a conversation to an agent — the cloned experiences
     * seed the agent's local experience store.
     *
     * @param {string} conversationId — conversation to clone experiences from
     * @returns {Array<ExperienceRecord>} deep-cloned array of experiences
     */
    cloneConversationExperiences(conversationId) {
      if (!conversationId) return [];
      const filtered = this._experiences.filter(
        exp => exp.conversationId === conversationId
      );
      return JSON.parse(JSON.stringify(filtered));
    }

   /**
     * Get references to all experiences for a specific conversation.
     * Unlike `cloneConversationExperiences`, this does NOT deep copy —
     * use when read-only access is sufficient.
     *
     * @param {string} conversationId — conversation to retrieve experiences for
     * @returns {Array<ExperienceRecord>}
     */
    getExperiencesForConversation(conversationId) {
      if (!conversationId) return [];
      return this._experiences.filter(
        exp => exp.conversationId === conversationId
      );
    }

   /**
     * Remove all experience records for a specific conversation.
     * Called when a conversation is cleared to prevent stale experiences
     * from influencing future interactions.
     *
     * @param {string} conversationId — conversation to clear
     * @returns {number} number of experiences removed
     */
    clearConversationExperiences(conversationId) {
     if (!conversationId) return 0;
     const before = this._experiences.length;
     this._experiences = this._experiences.filter(
       exp => exp.conversationId !== conversationId
     );
     return before - this._experiences.length;
   }

  // ════════════════════════════════════════════════════════════════════
  // Pattern Memory Layer
  // ════════════════════════════════════════════════════════════════════

  /**
   * @typedef {Object} PatternRecord
   * @property {string}  type         — 'success_sequence' | 'failure_pattern' | 'tool_preference'
   * @property {string}  description  — human-readable pattern description
   * @property {Array<string>} toolSequence — ordered tool names
   * @property {number}  frequency    — how many times this pattern was observed
   * @property {number}  successRate  — fraction of successes with this pattern
   * @property {Array<string>} keywords — input keywords associated with this pattern
   */

  /**
   * Analyze the experience store for recurring patterns.
   *
   * Groups experiences by similar inputs (keyword overlap), then identifies:
   *  - Commonly successful tool sequences
   *  - Failure patterns to avoid
   *
   * @returns {Array<PatternRecord>} newly extracted patterns
   */
  extractPatterns() {
    if (this._experiences.length < 3) return [];

    const newPatterns = [];

    // ── Group by tool sequence ─────────────────────────────────────
    /** @type {Map<string, Array<ExperienceRecord>>} */
    const bySequence = new Map();

    for (const exp of this._experiences) {
      const seqKey = exp.toolsUsed.join(' → ');
      if (!seqKey) continue;
      if (!bySequence.has(seqKey)) bySequence.set(seqKey, []);
      bySequence.get(seqKey).push(exp);
    }

    for (const [seqKey, group] of bySequence) {
      if (group.length < 2) continue;

      const successCount = group.filter((e) => e.success).length;
      const successRate = successCount / group.length;

      // Collect common keywords from inputs
      const allWords = group.flatMap((e) =>
        e.input.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
      );
      const wordFreq = new Map();
      for (const w of allWords) {
        wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
      }
      const keywords = [...wordFreq.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([w]) => w);

      const type = successRate >= 0.7 ? 'success_sequence' : 'failure_pattern';
      const tools = group[0].toolsUsed;

      newPatterns.push({
        type,
        description: `${type === 'success_sequence' ? 'Successful' : 'Often-failing'} sequence: ${seqKey} (${(successRate * 100).toFixed(0)}% success, ${group.length} occurrences)`,
        toolSequence: tools,
        frequency: group.length,
        successRate,
        keywords,
      });
    }

    // ── Merge with existing patterns, respecting max ───────────────
    for (const p of newPatterns) {
      const existing = this._patterns.find(
        (ep) => ep.toolSequence.join(',') === p.toolSequence.join(',')
      );
      if (existing) {
        existing.frequency = p.frequency;
        existing.successRate = p.successRate;
        existing.keywords = p.keywords;
        existing.description = p.description;
        existing.type = p.type;
      } else {
        this._patterns.push(p);
      }
    }

    // Evict least-frequent patterns when over capacity
    if (this._patterns.length > this._maxPatterns) {
      this._patterns.sort((a, b) => b.frequency - a.frequency);
      this._patterns.length = this._maxPatterns;
    }

    return newPatterns;
  }

  /**
   * Return all extracted patterns.
   *
   * @returns {Array<PatternRecord>}
   */
  getPatterns() {
    return this._patterns;
  }

  /**
   * Find patterns applicable to the current input by keyword matching.
   *
   * @param {string} input — current user input
   * @returns {Array<PatternRecord>} matching patterns sorted by relevance
   */
  applyPatterns(input) {
    if (this._patterns.length === 0) return [];

    const inputWords = new Set(
      input.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
    );

    const scored = this._patterns.map((p) => {
      const overlap = p.keywords.filter((k) => inputWords.has(k)).length;
      return { ...p, _relevance: overlap };
    });

    return scored
      .filter((p) => p._relevance > 0)
      .sort((a, b) => b._relevance - a._relevance);
  }

  // ════════════════════════════════════════════════════════════════════
  // Unified API
  // ════════════════════════════════════════════════════════════════════

  /**
   * Query all memory layers and merge results.
   *
   * @param {string} query — search text
   * @returns {Promise<{ holographic: Array, experiences: Array, patterns: Array }>}
   */
  async recallAll(query) {
    const [holographic, experiences, patterns] = await Promise.all([
      this.recall(query),
      Promise.resolve(this.queryExperiences(query)),
      Promise.resolve(this.applyPatterns(query)),
    ]);

    return { holographic, experiences, patterns };
  }

   /**
    * Store an interaction in all appropriate memory layers.
    *
    * @param {Object} interaction
    * @param {string}  interaction.input       — user input text
    * @param {string}  interaction.response    — agent response text
    * @param {Array<string>} [interaction.toolsUsed] — tool names
    * @param {boolean} [interaction.success]   — whether the turn succeeded
    * @param {number}  [interaction.timestamp] — epoch ms
    * @param {number}  [interaction.duration]  — turn duration ms
    * @param {Object}  [interaction.tokenUsage] — token stats
    * @param {string}  [conversationId] — optional conversation identifier for experience scoping
    */
   storeInteraction(interaction, conversationId) {
     // Holographic layer (shared workspace-level — all conversations benefit)
     if (interaction.input && interaction.response) {
       this.store(interaction.input, interaction.response);
     }

     // Experience layer (scoped to conversation)
     this.recordExperience(interaction, conversationId);
   }

  /**
   * Return memory system diagnostics.
   *
   * @returns {Object}
   */
  getDiagnostics() {
    return {
      initialized: this._initialized,
      holographicAvailable: !!this._holographic,
      holographicDiagnostics: this._holographic?.getDiagnostics?.() ?? null,
      experienceCount: this._experiences.length,
      maxExperiences: this._maxExperiences,
      patternCount: this._patterns.length,
      maxPatterns: this._maxPatterns,
    };
  }

  /**
   * Clean up resources.
   */
  dispose() {
    if (this._holographic) {
      try {
        this._holographic.reset();
      } catch (_e) {
        // best-effort cleanup
      }
      this._holographic = null;
    }
    this._experiences = [];
    this._patterns = [];
    this._initialized = false;
  }
}

export default MemorySystem;
