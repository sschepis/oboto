/**
 * Semantic Collapse Engine
 * 
 * Holds user input in a probability-weighted superposition of interpretations.
 * Uses @aleph-ai/tinyaleph's coherence and collapse primitives to:
 * - Generate weighted meaning states
 * - Apply measurement context from conversation
 * - Collapse to a single interpretation when coherence is sufficient
 * - Support reanalysis if contradictory evidence appears
 * 
 * @module reasoning/semantic-collapse
 */

// Optional imports from @aleph-ai/tinyaleph — not used directly yet but reserved
// for future enhanced coherence computation. Engine works without them.
let _tinyaleph = null;
try {
  _tinyaleph = await import('@aleph-ai/tinyaleph');
} catch { /* tinyaleph not available — using built-in implementations */ }

// ── Embedding (shared with fact-inference-engine) ────────────────────

const EMBED_DIM = 16;

function textToEmbedding(text) {
  const embedding = new Array(EMBED_DIM).fill(0);
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  for (let w = 0; w < words.length; w++) {
    const word = words[w];
    for (let i = 0; i < word.length; i++) {
      const idx = (word.charCodeAt(i) + w) % EMBED_DIM;
      embedding[idx] += 1 / (w + 1) / (i + 1);
    }
  }
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0)) || 1;
  return embedding.map(v => v / norm);
}

function cosineSimilarity(a, b) {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nA += a[i] * a[i];
    nB += b[i] * b[i];
  }
  return dot / (Math.sqrt(nA) * Math.sqrt(nB) + 1e-8);
}

// ── Interpretation Templates ─────────────────────────────────────────

const INTERPRETATION_TEMPLATES = [
  { template: 'requesting code changes to {topic}', weight: 0.9 },
  { template: 'asking for explanation of {topic}', weight: 0.85 },
  { template: 'debugging an issue with {topic}', weight: 0.8 },
  { template: 'exploring possibilities around {topic}', weight: 0.6 },
  { template: 'establishing context about {topic}', weight: 0.7 },
  { template: 'requesting a creative/design approach to {topic}', weight: 0.5 },
  { template: 'seeking validation of approach to {topic}', weight: 0.65 },
  { template: 'providing feedback on {topic}', weight: 0.55 },
];

// ── Data Structures ──────────────────────────────────────────────────

/**
 * @typedef {Object} MeaningState
 * @property {string} id
 * @property {string} interpretation
 * @property {number[]} primeSignature  embedding vector
 * @property {number} amplitude        probability amplitude
 * @property {number} phase
 * @property {number} probability      |amplitude|^2 normalized
 */

/**
 * @typedef {Object} Superposition
 * @property {string} id
 * @property {string} input
 * @property {MeaningState[]} states
 * @property {number} entropy
 * @property {boolean} collapsed
 * @property {string|null} collapsedTo  MeaningState.id
 * @property {number} createdAt
 * @property {number|null} collapsedAt
 */

/**
 * @typedef {Object} CollapseEvent
 * @property {string} id
 * @property {string} superpositionId
 * @property {string} context
 * @property {MeaningState} collapsedState
 * @property {number} probability
 * @property {number} coherenceAtCollapse
 * @property {number} timestamp
 */

// ── Engine ────────────────────────────────────────────────────────────

export class SemanticCollapseEngine {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.collapseCoherenceThreshold] default 0.7
   * @param {number} [opts.collapseEntropyThreshold] default 0.4
   * @param {number} [opts.maxCollapseHistory] default 100
   */
  constructor(opts = {}) {
    this.collapseCoherenceThreshold = opts.collapseCoherenceThreshold ?? 0.7;
    this.collapseEntropyThreshold = opts.collapseEntropyThreshold ?? 0.4;
    this.maxCollapseHistory = opts.maxCollapseHistory ?? 100;

    /** @type {Superposition|null} */
    this.currentSuperposition = null;

    /** @type {CollapseEvent[]} */
    this.collapseHistory = [];
  }

  /**
   * Extract the topic from user input (simplified extraction).
   * @param {string} input
   * @returns {string}
   */
  _extractTopic(input) {
    // Strip common prefixes
    let topic = input
      .replace(/^(can you|could you|please|I want to|I need to|help me)\s+/i, '')
      .replace(/^(fix|explain|create|build|debug|analyze|review|check)\s+/i, '')
      .trim();
    // Truncate to first 60 chars
    if (topic.length > 60) topic = topic.slice(0, 60) + '…';
    return topic || input.slice(0, 40);
  }

  /**
   * Generate a superposition of meaning states from user input.
   * @param {string} input
   * @returns {Superposition}
   */
  createSuperposition(input) {
    const topic = this._extractTopic(input);
    const inputEmb = textToEmbedding(input);

    const states = INTERPRETATION_TEMPLATES.map((tmpl, idx) => {
      const interpretation = tmpl.template.replace('{topic}', topic);
      const interpEmb = textToEmbedding(interpretation);

      // Bias amplitude by template weight AND similarity to actual input
      const sim = cosineSimilarity(inputEmb, interpEmb);
      const amplitude = tmpl.weight * (0.5 + 0.5 * sim);
      const phase = (idx * Math.PI * 2) / INTERPRETATION_TEMPLATES.length;

      return {
        id: `ms_${idx}_${Date.now()}`,
        interpretation,
        primeSignature: interpEmb,
        amplitude,
        phase,
        probability: 0, // Will be normalized below
      };
    });

    // Normalize probabilities (Born rule: |amplitude|^2)
    this._normalizeProbabilities(states);

    // Compute entropy of the distribution
    const probs = states.map(s => s.probability);
    const entropy = this._shannonEntropy(probs);

    const superposition = {
      id: `sp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      input,
      states,
      entropy,
      collapsed: false,
      collapsedTo: null,
      createdAt: Date.now(),
      collapsedAt: null,
    };

    this.currentSuperposition = superposition;
    return superposition;
  }

  /**
   * Normalize state probabilities using Born rule.
   * @param {MeaningState[]} states
   */
  _normalizeProbabilities(states) {
    const total = states.reduce((s, st) => s + st.amplitude * st.amplitude, 0) || 1;
    for (const st of states) {
      st.probability = (st.amplitude * st.amplitude) / total;
    }
  }

  /**
   * Shannon entropy of a probability distribution.
   * @param {number[]} probs
   * @returns {number}
   */
  _shannonEntropy(probs) {
    let H = 0;
    for (const p of probs) {
      if (p > 0) H -= p * Math.log2(p);
    }
    // Normalize to [0,1] by dividing by max entropy
    const maxH = Math.log2(probs.length);
    return maxH > 0 ? H / maxH : 0;
  }

  /**
   * Apply measurement context to bias amplitudes.
   * Context comes from conversation history, active facts, etc.
   * @param {Superposition} superposition
   * @param {string[]} contextStrings  recent conversation context
   * @param {number} conversationCoherence  0-1 how coherent the conversation has been
   * @returns {Superposition}
   */
  applyMeasurementContext(superposition, contextStrings, conversationCoherence = 0.5) {
    if (superposition.collapsed) return superposition;

    // Build a composite context embedding
    const contextEmbs = contextStrings.map(s => textToEmbedding(s));

    for (const state of superposition.states) {
      let contextBias = 0;
      for (const ce of contextEmbs) {
        contextBias += cosineSimilarity(state.primeSignature, ce);
      }
      if (contextEmbs.length > 0) {
        contextBias /= contextEmbs.length;
      }

      // Apply context: amplify states that align with context
      state.amplitude *= (1 + contextBias * conversationCoherence * 0.5);
    }

    this._normalizeProbabilities(superposition.states);
    superposition.entropy = this._shannonEntropy(superposition.states.map(s => s.probability));

    return superposition;
  }

  /**
   * Should we collapse now?
   * @param {Superposition} superposition
   * @param {number} conversationCoherence
   * @returns {boolean}
   */
  shouldCollapse(superposition, conversationCoherence = 0.5) {
    if (superposition.collapsed) return false;

    // Auto-collapse conditions:
    // 1. High coherence + low entropy
    if (conversationCoherence >= this.collapseCoherenceThreshold &&
        superposition.entropy < this.collapseEntropyThreshold) {
      return true;
    }

    // 2. One state has overwhelming probability
    const maxProb = Math.max(...superposition.states.map(s => s.probability));
    if (maxProb > 0.5) return true;

    // 3. Time since creation > 5 seconds (prevent infinite superposition)
    if (Date.now() - superposition.createdAt > 5000) return true;

    return false;
  }

  /**
   * Collapse the superposition to a single interpretation.
   * Uses probabilistic selection (Born rule) — not always the top one.
   * @param {Superposition} superposition
   * @param {number} conversationCoherence
   * @returns {MeaningState}
   */
  collapseState(superposition, conversationCoherence = 0.5) {
    if (superposition.collapsed) {
      return superposition.states.find(s => s.id === superposition.collapsedTo);
    }

    // Probabilistic selection weighted by probability
    const rand = Math.random();
    let cumulative = 0;
    let selected = superposition.states[0];
    for (const state of superposition.states) {
      cumulative += state.probability;
      if (rand <= cumulative) {
        selected = state;
        break;
      }
    }

    superposition.collapsed = true;
    superposition.collapsedTo = selected.id;
    superposition.collapsedAt = Date.now();

    // Record collapse event
    const event = {
      id: `ce_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      superpositionId: superposition.id,
      context: superposition.input.slice(0, 80),
      collapsedState: selected,
      probability: selected.probability,
      coherenceAtCollapse: conversationCoherence,
      timestamp: Date.now(),
    };

    this.collapseHistory.push(event);
    if (this.collapseHistory.length > this.maxCollapseHistory) {
      this.collapseHistory = this.collapseHistory.slice(-this.maxCollapseHistory);
    }

    return selected;
  }

  /**
   * Trigger reanalysis: if new input contradicts the collapsed state,
   * re-open the superposition.
   * @param {Superposition} superposition
   * @param {string} newInput
   * @returns {Superposition}
   */
  triggerReanalysis(superposition, newInput) {
    if (!superposition.collapsed) return superposition;

    const newEmb = textToEmbedding(newInput);
    const collapsedState = superposition.states.find(
      s => s.id === superposition.collapsedTo
    );

    if (!collapsedState) return superposition;

    const sim = cosineSimilarity(newEmb, collapsedState.primeSignature);

    // If new input is significantly different from collapsed interpretation
    if (sim < 0.3) {
      superposition.collapsed = false;
      superposition.collapsedTo = null;
      superposition.collapsedAt = null;

      // Re-expand: boost states that are more similar to new input
      for (const state of superposition.states) {
        const newSim = cosineSimilarity(newEmb, state.primeSignature);
        state.amplitude = state.amplitude * 0.5 + newSim * 0.5;
      }
      this._normalizeProbabilities(superposition.states);
      superposition.entropy = this._shannonEntropy(
        superposition.states.map(s => s.probability)
      );
    }

    return superposition;
  }

  /**
   * Get the dominant interpretation without collapsing.
   * @param {Superposition} superposition
   * @returns {MeaningState}
   */
  getDominantInterpretation(superposition) {
    const sp = superposition || this.currentSuperposition;
    if (!sp) return null;
    if (sp.collapsed) {
      return sp.states.find(s => s.id === sp.collapsedTo);
    }
    return sp.states.reduce(
      (best, s) => (s.probability > best.probability ? s : best),
      sp.states[0]
    );
  }

  /**
   * Render a context string for prompt injection.
   * @param {Superposition|null} [superposition]
   * @returns {string|null}
   */
  renderContextString(superposition) {
    const sp = superposition || this.currentSuperposition;
    if (!sp) return null;

    const dominant = this.getDominantInterpretation(sp);
    if (!dominant) return null;

    if (sp.collapsed) {
      return `[Semantic Context]: Interpretation: ${dominant.interpretation} (confidence: ${(dominant.probability * 100).toFixed(0)}%)`;
    }

    // Not yet collapsed — show top 2
    const sorted = [...sp.states].sort((a, b) => b.probability - a.probability);
    const top2 = sorted.slice(0, 2);
    const lines = [
      `[Semantic Context]: ${sp.states.length} interpretations in superposition (entropy: ${sp.entropy.toFixed(2)})`,
    ];
    for (const s of top2) {
      lines.push(`  • ${s.interpretation} (${(s.probability * 100).toFixed(0)}%)`);
    }
    return lines.join('\n');
  }

  /**
   * Process a user input through the full collapse pipeline.
   * Returns the context string to inject, or null if not applicable.
   * @param {string} input
   * @param {string[]} recentContext  recent conversation messages
   * @param {number} conversationCoherence  0-1
   * @returns {{ contextString: string|null, interpretation: MeaningState, entropy: number, collapsed: boolean }}
   */
  process(input, recentContext = [], conversationCoherence = 0.5) {
    // Skip very short inputs
    if (input.length < 10) {
      return { contextString: null, interpretation: null, entropy: 0, collapsed: false };
    }

    const sp = this.createSuperposition(input);
    this.applyMeasurementContext(sp, recentContext, conversationCoherence);

    let collapsed = false;
    let interpretation;

    if (this.shouldCollapse(sp, conversationCoherence)) {
      interpretation = this.collapseState(sp, conversationCoherence);
      collapsed = true;
    } else {
      interpretation = this.getDominantInterpretation(sp);
    }

    return {
      contextString: this.renderContextString(sp),
      interpretation,
      entropy: sp.entropy,
      collapsed,
    };
  }
}

export default SemanticCollapseEngine;
