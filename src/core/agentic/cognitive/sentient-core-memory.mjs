/**
 * Memory helper functions extracted from SentientCognitiveCore.
 *
 * Handles storing and recalling interactions through the SentientObserver
 * memory system, with fallback to simple in-memory storage.
 *
 * @module src/core/agentic/cognitive/sentient-core-memory
 */

/**
 * Store an interaction in sentient memory.
 *
 * @param {Object} params
 * @param {Object} params.observer  - SentientObserver instance
 * @param {string} params.input     - User input text
 * @param {string} params.output    - LLM output text
 * @param {number} params.coherence - Current coherence value
 * @param {number} params.entropy   - Current entropy value
 * @param {number} params.interactionCount
 * @param {Array}  params.memories  - Fallback memories array (mutated on fallback)
 * @param {number} params.maxMemories - Max size of fallback array
 */
function storeInteraction({ observer, input, output, coherence, entropy, interactionCount, memories, maxMemories }) {
  // Store via sentient memory with full context
  try {
    observer.memory.store(input + ' ' + output, {
      type: 'interaction',
      input: input.substring(0, 200),
      output: output.substring(0, 200),
      activePrimes: observer.currentState.activePrimes || [],
      momentId: observer.temporal.currentMoment?.id,
      phraseId: observer.entanglement.currentPhrase?.id,
      smf: observer.smf.s ? Array.from(observer.smf.s) : null,
      importance: 0.7,
      coherence,
      interactionId: interactionCount,
    });
  } catch (_e) {
    // Fallback: store in simple memories array
    memories.push({
      timestamp: Date.now(),
      input: input.substring(0, 200),
      output: output.substring(0, 200),
      coherence,
      interactionId: interactionCount,
    });
    if (memories.length > maxMemories) {
      memories.shift();
    }
  }

  // Force a moment for this interaction
  try {
    observer.temporal.forceMoment(
      {
        coherence,
        entropy,
        activePrimes: (observer.currentState.activePrimes || []).slice(0, 5),
      },
      'interaction'
    );
  } catch (_e) {
    // TemporalLayer may not support forceMoment
  }
}

/**
 * Recall relevant memories by text query.
 *
 * @param {Object} params
 * @param {Object} params.observer  - SentientObserver instance
 * @param {Object} params.backend   - TinyAleph backend (for textToOrderedState)
 * @param {string} params.query     - Search query text
 * @param {number} params.limit     - Maximum results to return
 * @param {Array}  params.memories  - Fallback memories array
 * @returns {Array<{ input: string, output: string, coherence: number, timestamp: number, score: number }>}
 */
function recallByQuery({ observer, backend, query, limit, memories }) {
  try {
    // Use sentient memory's similarity-based recall
    const primeState = backend.textToOrderedState(query);
    const results = observer.memory.recallBySimilarity(primeState, {
      threshold: 0.2,
      maxResults: limit,
    });

    return results.map((r) => ({
      input: r.trace?.content?.input || r.trace?.content || '',
      output: r.trace?.content?.output || '',
      coherence: r.trace?.metadata?.coherence || 0,
      timestamp: r.trace?.timestamp || Date.now(),
      score: r.similarity || 0,
    }));
  } catch (_e) {
    // Fallback to simple memory search (mirrors CognitiveCore.recall)
    const queryWords = new Set(
      query.toLowerCase().split(/\s+/).filter((w) => w.length > 0)
    );

    const scored = memories.map((mem) => {
      const memWords = new Set(
        `${mem.input} ${mem.output}`.toLowerCase().split(/\s+/)
      );
      let overlap = 0;
      for (const w of queryWords) {
        if (memWords.has(w)) overlap++;
      }
      const recency =
        1 / (1 + (Date.now() - mem.timestamp) / (1000 * 60 * 60));
      return { ...mem, score: overlap * 0.7 + recency * 0.3 };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .filter((m) => m.score > 0);
  }
}

export { storeInteraction, recallByQuery };
