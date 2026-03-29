/**
 * MemoryBridge — Unified memory interface that consolidates the 5 memory
 * systems (voluntary, involuntary, holographic, experience, pattern) into
 * a single recall/store API with deduplication and ranking.
 *
 * Sits between the AgentRunner and the various memory subsystems so the
 * agent loop gets a single, deduplicated context block for prompt injection.
 *
 * @module src/core/agent/memory-bridge
 */

/**
 * @typedef {Object} MemoryResult
 * @property {string} text — the memory content
 * @property {number} score — relevance score (0–1)
 * @property {string} source — origin system ('involuntary'|'voluntary'|'holographic'|'experience'|'pattern')
 * @property {string} [validity] — 'valid'|'retracted'|'superseded'
 */

export class MemoryBridge {
  /**
   * @param {Object} opts
   * @param {import('./memory.mjs').AssociativeStringStore} [opts.voluntaryMem]
   * @param {import('./memory.mjs').AssociativeStringStore} [opts.involuntaryMem]
   * @param {Object} [opts.memorySystem]  — MemorySystem (holographic + experience + pattern)
   * @param {Object} [opts.cognitiveLayer] — CognitiveLayer
   * @param {Object} [opts.learningEngine] — LearningEngine
   */
  constructor({ voluntaryMem, involuntaryMem, memorySystem, cognitiveLayer, learningEngine } = {}) {
    /** @type {import('./memory.mjs').AssociativeStringStore|null} */
    this.voluntaryMem = voluntaryMem ?? null;
    /** @type {import('./memory.mjs').AssociativeStringStore|null} */
    this.involuntaryMem = involuntaryMem ?? null;
    /** @type {Object|null} */
    this.memorySystem = memorySystem ?? null;
    /** @type {Object|null} */
    this.cognitiveLayer = cognitiveLayer ?? null;
    /** @type {Object|null} */
    this.learningEngine = learningEngine ?? null;
  }

  // ════════════════════════════════════════════════════════════════════
  // Static Factory — Agent-scoped Bridge
  // ════════════════════════════════════════════════════════════════════

  /**
   * Create a MemoryBridge for a promoted conversation agent.
   *
   * The bridge shares the workspace-level MemorySystem (holographic +
   * experience + pattern read access) but uses agent-local
   * AssociativeStringStore instances for voluntary and involuntary memory.
   *
   * @param {Object} sharedMemorySystem — workspace-level MemorySystem
   * @param {import('./memory.mjs').AssociativeStringStore} localVoluntary — agent-owned voluntary store
   * @param {import('./memory.mjs').AssociativeStringStore} localInvoluntary — agent-owned involuntary store
   * @param {Object} [opts] — additional options
   * @param {Object} [opts.cognitiveLayer]
   * @param {Object} [opts.learningEngine]
   * @returns {MemoryBridge}
   */
  static forAgent(sharedMemorySystem, localVoluntary, localInvoluntary, opts = {}) {
    return new MemoryBridge({
      voluntaryMem: localVoluntary,
      involuntaryMem: localInvoluntary,
      memorySystem: sharedMemorySystem,
      cognitiveLayer: opts.cognitiveLayer ?? null,
      learningEngine: opts.learningEngine ?? null,
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // Unified Recall
  // ════════════════════════════════════════════════════════════════════

  /**
   * Query all connected memory systems in parallel, deduplicate, rank,
   * and return a formatted context block ready for system-prompt injection.
   *
   * @param {string} query — the recall query (usually recent context)
   * @param {number} [maxItems=10] — maximum results to return
   * @returns {Promise<{ items: MemoryResult[], formatted: string }>}
   */
  async recall(query, maxItems = 10) {
    if (!query) return { items: [], formatted: '' };

    /** @type {MemoryResult[]} */
    const allResults = [];

    // Query all systems in parallel
    const [involuntary, voluntary, systemRecall] = await Promise.allSettled([
      this.involuntaryMem?.associate(query, 5),
      this.voluntaryMem?.associate(query, 5),
      this.memorySystem?.recallAll?.(query),
    ]);

    // ── Normalize involuntary results ─────────────────────────────
    if (involuntary.status === 'fulfilled' && Array.isArray(involuntary.value)) {
      for (const m of involuntary.value) {
        allResults.push({
          text: m.text,
          score: m.score ?? 0,
          source: 'involuntary',
          validity: m.validity ?? 'valid',
        });
      }
    }

    // ── Normalize voluntary results ───────────────────────────────
    if (voluntary.status === 'fulfilled' && Array.isArray(voluntary.value)) {
      for (const m of voluntary.value) {
        allResults.push({
          text: m.text,
          score: m.score ?? 0,
          source: 'voluntary',
          validity: m.validity ?? 'valid',
        });
      }
    }

    // ── Normalize MemorySystem (holographic + experience + pattern) ─
    if (systemRecall.status === 'fulfilled' && systemRecall.value) {
      const recall = systemRecall.value;

      if (Array.isArray(recall.holographic)) {
        for (const m of recall.holographic) {
          const text = `${m.input || m.query || ''}: ${m.response || m.result || ''}`.trim();
          if (text && text !== ':') {
            allResults.push({
              text,
              score: m.score ?? 0.5,
              source: 'holographic',
              validity: 'valid',
            });
          }
        }
      }

      if (Array.isArray(recall.experiences)) {
        for (const e of recall.experiences) {
          const text = `${e.input || ''}: ${e.response || ''}`.trim();
          if (text && text !== ':') {
            allResults.push({
              text,
              score: e.score ?? 0.4,
              source: 'experience',
              validity: 'valid',
            });
          }
        }
      }

      if (Array.isArray(recall.patterns)) {
        for (const p of recall.patterns) {
          if (p.type === 'success_sequence' && p.successRate >= 0.7) {
            const text = `Pattern: ${(p.toolSequence || []).join(' → ')} (${(p.successRate * 100).toFixed(0)}% success)`;
            allResults.push({
              text,
              score: p.successRate ?? 0.7,
              source: 'pattern',
              validity: 'valid',
            });
          }
        }
      }
    }

    // ── Deduplicate by text similarity ────────────────────────────
    const deduplicated = this._deduplicate(allResults);

    // ── Rank by score, take top N ─────────────────────────────────
    deduplicated.sort((a, b) => b.score - a.score);
    const topItems = deduplicated.slice(0, maxItems);

    return {
      items: topItems,
      formatted: this._formatForPrompt(topItems),
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // Unified Store
  // ════════════════════════════════════════════════════════════════════

  /**
   * Route a memory entry to the appropriate system(s).
   *
   * @param {Object} entry
   * @param {string} entry.text — content to store
   * @param {'voluntary'|'involuntary'|'experience'} [entry.type='voluntary'] — target system
   * @param {Object} [entry.meta] — optional metadata / provenance
   * @returns {Promise<{id?: number, stored: boolean}>}
   */
  async store(entry) {
    const { text, type = 'voluntary', meta = null } = entry;
    if (!text) return { stored: false };

    try {
      switch (type) {
        case 'voluntary': {
          const id = await this.voluntaryMem?.add(text, meta);
          return { id, stored: id != null };
        }
        case 'involuntary': {
          const id = await this.involuntaryMem?.add(text, meta);
          return { id, stored: id != null };
        }
        case 'experience': {
          if (this.memorySystem?.storeInteraction) {
            this.memorySystem.storeInteraction({
              input: text,
              response: meta?.response || '',
              toolsUsed: meta?.toolsUsed || [],
              success: meta?.success ?? true,
              timestamp: Date.now(),
            });
            return { stored: true };
          }
          // Fall back to voluntary
          const id = await this.voluntaryMem?.add(text, meta);
          return { id, stored: id != null };
        }
        default: {
          const id = await this.voluntaryMem?.add(text, meta);
          return { id, stored: id != null };
        }
      }
    } catch (err) {
      console.warn('[MemoryBridge] Store failed:', err.message);
      return { stored: false };
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Diagnostics
  // ════════════════════════════════════════════════════════════════════

  /**
   * Return a snapshot of all connected memory systems.
   * @returns {Object}
   */
  getDiagnostics() {
    return {
      voluntarySize: this.voluntaryMem?.items?.size ?? 0,
      involuntarySize: this.involuntaryMem?.items?.size ?? 0,
      memorySystemConnected: !!this.memorySystem,
      cognitiveLayerConnected: !!this.cognitiveLayer,
      learningEngineConnected: !!this.learningEngine,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ════════════════════════════════════════════════════════════════════

  /**
   * Deduplicate results by checking for substring overlap.
   * If text A is a substring of text B (or vice versa), keep the higher-scored one.
   *
   * @param {MemoryResult[]} results
   * @returns {MemoryResult[]}
   * @private
   */
  _deduplicate(results) {
    if (results.length <= 1) return results;

    // Sort by score descending so we keep the best version
    const sorted = [...results].sort((a, b) => b.score - a.score);
    const kept = [];
    const seen = new Set();

    for (const item of sorted) {
      // Normalize text for comparison
      const norm = item.text.toLowerCase().trim();

      // Check if this is a duplicate of something we've already kept
      let isDup = false;
      for (const keptNorm of seen) {
        // Exact match
        if (norm === keptNorm) { isDup = true; break; }
        // Substring containment (one contains the other)
        if (norm.length > 30 && keptNorm.length > 30) {
          if (norm.includes(keptNorm) || keptNorm.includes(norm)) {
            isDup = true;
            break;
          }
        }
      }

      if (!isDup) {
        kept.push(item);
        seen.add(norm);
      }
    }

    return kept;
  }

  /**
   * Format deduplicated results into a prompt-ready string.
   *
   * @param {MemoryResult[]} items
   * @returns {string}
   * @private
   */
  _formatForPrompt(items) {
    if (!items || items.length === 0) return '';

    const sourceLabels = {
      involuntary: 'auto',
      voluntary: 'stored',
      holographic: 'holographic',
      experience: 'experience',
      pattern: 'pattern',
    };

    return items
      .map(item => {
        const label = sourceLabels[item.source] || item.source;
        return `* [${label}] ${item.text}`;
      })
      .join('\n');
  }
}
