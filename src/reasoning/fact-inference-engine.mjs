/**
 * Fact/Inference Engine
 * 
 * Wraps @aleph-ai/tinyaleph's prime-resonance primitives to implement:
 * - Fact storage with semantic embeddings
 * - Inference rules with premise matching
 * - Derivation chain tracing
 * - Semantic querying
 * 
 * Facts persist to .ai-man/reasoning/facts.json
 * 
 * @module reasoning/fact-inference-engine
 */

// Optional imports from @aleph-ai/tinyaleph — reserved for future enhanced computation.
// Engine works without them via built-in implementations.
let _tinyaleph = null;
try {
  _tinyaleph = await import('@aleph-ai/tinyaleph');
} catch { /* tinyaleph not available — using built-in implementations */ }

import { promises as fs } from 'fs';
import path from 'path';

// ── Embedding ────────────────────────────────────────────────────────

const EMBED_DIM = 16;

/**
 * Generate a 16-dim semantic embedding from text.
 * Uses positional character-level hashing (tinyaleph-style).
 * @param {string} text
 * @returns {number[]}
 */
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

/**
 * Cosine similarity between two equal-length vectors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function similarity(a, b) {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nA += a[i] * a[i];
    nB += b[i] * b[i];
  }
  return dot / (Math.sqrt(nA) * Math.sqrt(nB) + 1e-8);
}

// ── Data Structures (JSDoc only, no TS) ──────────────────────────────

/**
 * @typedef {Object} Fact
 * @property {string} id
 * @property {string} name
 * @property {string} statement
 * @property {number[]} embedding
 * @property {number} confidence  0-1
 * @property {'input'|'inferred'|'observation'|'tool'} source
 * @property {number} timestamp
 * @property {string[]} derivedFrom  IDs of source facts
 */

/**
 * @typedef {Object} InferenceRule
 * @property {string} id
 * @property {string} name
 * @property {string[]} premises  semantic patterns to match
 * @property {string} conclusion  template for derived fact
 * @property {number} confidenceDecay  0-1
 */

/**
 * @typedef {Object} ReasoningStep
 * @property {string} id
 * @property {string} ruleId
 * @property {string} ruleName
 * @property {Fact[]} inputFacts
 * @property {Fact} outputFact
 * @property {number} confidence
 * @property {number} timestamp
 */

// ── Default Rules ────────────────────────────────────────────────────

const DEFAULT_RULES = [
  {
    id: 'rule_tool_success',
    name: 'Tool Success Pattern',
    premises: ['tool executed successfully', 'file modified'],
    conclusion: 'The codebase has been updated based on the tool action',
    confidenceDecay: 0.9,
  },
  {
    id: 'rule_error_pattern',
    name: 'Error Pattern Recognition',
    premises: ['error encountered', 'similar error before'],
    conclusion: 'This is a recurring issue that may need a different approach',
    confidenceDecay: 0.85,
  },
  {
    id: 'rule_goal_progress',
    name: 'Goal Progress',
    premises: ['action taken', 'goal alignment'],
    conclusion: 'Progress has been made toward the objective',
    confidenceDecay: 0.9,
  },
  {
    id: 'rule_synthesis',
    name: 'Synthesis',
    premises: ['multiple concepts', 'coherent integration'],
    conclusion: 'Concepts have been synthesized into new understanding',
    confidenceDecay: 0.7,
  },
  {
    id: 'rule_user_preference',
    name: 'User Preference Detection',
    premises: ['user repeated pattern', 'consistent style'],
    conclusion: 'User has a preference for this approach',
    confidenceDecay: 0.8,
  },
];

// ── Engine ────────────────────────────────────────────────────────────

export class FactInferenceEngine {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.persistDir] defaults to .ai-man/reasoning
   * @param {number} [opts.matchThreshold] cosine threshold for premise matching (default 0.4)
   * @param {number} [opts.maxFacts] prune oldest beyond this (default 500)
   * @param {number} [opts.pruneAgeDays] prune low-confidence facts older than this (default 7)
   */
  constructor(opts = {}) {
    this.persistDir = opts.persistDir || path.join(process.cwd(), '.ai-man', 'reasoning');
    this.matchThreshold = opts.matchThreshold ?? 0.4;
    this.maxFacts = opts.maxFacts ?? 500;
    this.pruneAgeDays = opts.pruneAgeDays ?? 7;

    /** @type {Map<string, Fact>} */
    this.facts = new Map();

    /** @type {InferenceRule[]} */
    this.rules = [...DEFAULT_RULES];

    /** @type {ReasoningStep[]} */
    this.reasoningHistory = [];

    this.inferenceDepth = 0;
    this._initialized = false;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async initialize() {
    if (this._initialized) return;
    await fs.mkdir(this.persistDir, { recursive: true });
    await this._load();
    this._prune();
    this._initialized = true;
  }

  async _load() {
    try {
      const factsPath = path.join(this.persistDir, 'facts.json');
      const raw = await fs.readFile(factsPath, 'utf8');
      const arr = JSON.parse(raw);
      for (const f of arr) {
        this.facts.set(f.id, f);
      }
    } catch {
      // First run — no file yet
    }
    try {
      const rulesPath = path.join(this.persistDir, 'rules.json');
      const raw = await fs.readFile(rulesPath, 'utf8');
      const customRules = JSON.parse(raw);
      // Merge custom rules (don't duplicate defaults)
      const defaultIds = new Set(DEFAULT_RULES.map(r => r.id));
      for (const r of customRules) {
        if (!defaultIds.has(r.id)) {
          this.rules.push(r);
        }
      }
    } catch {
      // No custom rules
    }
  }

  async _save() {
    try {
      const factsPath = path.join(this.persistDir, 'facts.json');
      const rulesPath = path.join(this.persistDir, 'rules.json');
      const factsArr = Array.from(this.facts.values());
      await fs.writeFile(factsPath, JSON.stringify(factsArr, null, 2));
      const customRules = this.rules.filter(
        r => !DEFAULT_RULES.some(d => d.id === r.id)
      );
      if (customRules.length > 0) {
        await fs.writeFile(rulesPath, JSON.stringify(customRules, null, 2));
      }
    } catch (err) {
      // Log but don't throw — persistence failure is non-critical
      console.error(`[FactInferenceEngine] Failed to persist data: ${err.message}`);
    }
  }

  _prune() {
    const now = Date.now();
    const cutoff = now - this.pruneAgeDays * 86400_000;
    for (const [id, fact] of this.facts) {
      if (fact.timestamp < cutoff && fact.confidence < 0.3) {
        this.facts.delete(id);
      }
    }
    // Also cap total size
    if (this.facts.size > this.maxFacts) {
      const sorted = Array.from(this.facts.values())
        .sort((a, b) => a.timestamp - b.timestamp);
      const toRemove = sorted.slice(0, this.facts.size - this.maxFacts);
      for (const f of toRemove) {
        this.facts.delete(f.id);
      }
    }
  }

  // ── Core Operations ────────────────────────────────────────────────

  /**
   * Store a new fact.
   * @param {string} name
   * @param {string} statement
   * @param {number} [confidence=1]
   * @param {'input'|'inferred'|'observation'|'tool'} [source='input']
   * @param {string[]} [derivedFrom=[]]
   * @returns {Fact}
   */
  addFact(name, statement, confidence = 1, source = 'input', derivedFrom = []) {
    if (!name || typeof name !== 'string') return null;
    if (!statement || typeof statement !== 'string') return null;
    const fact = {
      id: `fact_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      statement,
      embedding: textToEmbedding(statement),
      confidence: Math.max(0, Math.min(1, confidence)),
      source,
      timestamp: Date.now(),
      derivedFrom,
    };
    this.facts.set(fact.id, fact);
    return fact;
  }

  /**
   * Register a custom inference rule.
   * @param {string} name
   * @param {string[]} premises
   * @param {string} conclusion
   * @param {number} [confidenceDecay=0.9]
   * @returns {InferenceRule}
   */
  addRule(name, premises, conclusion, confidenceDecay = 0.9) {
    const rule = {
      id: `rule_${name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
      name,
      premises,
      conclusion,
      confidenceDecay,
    };
    this.rules.push(rule);
    return rule;
  }

  /**
   * Match premises against known facts.
   * @param {string[]} premises
   * @returns {Fact[]|null}
   */
  _matchPremises(premises) {
    const allFacts = Array.from(this.facts.values());
    const matched = [];
    for (const premise of premises) {
      const premEmb = textToEmbedding(premise);
      let best = null;
      let bestScore = 0;
      for (const fact of allFacts) {
        if (matched.includes(fact)) continue;
        const score = similarity(premEmb, fact.embedding);
        if (score > bestScore && score >= this.matchThreshold) {
          bestScore = score;
          best = fact;
        }
      }
      if (best) {
        matched.push(best);
      } else {
        return null; // Not all premises satisfied
      }
    }
    return matched;
  }

  /**
   * Run one inference step. Returns newly inferred facts.
   * @returns {{ newFacts: Fact[], steps: ReasoningStep[] }}
   */
  reason() {
    const allFacts = Array.from(this.facts.values());
    const newFacts = [];
    const steps = [];

    for (const rule of this.rules) {
      const matchedFacts = this._matchPremises(rule.premises);
      if (!matchedFacts) continue;

      const baseConf = matchedFacts.reduce((min, f) => Math.min(min, f.confidence), 1);
      const derivedConf = baseConf * rule.confidenceDecay;

      // Deduplicate: skip if conclusion already exists at ≥ confidence
      const concEmb = textToEmbedding(rule.conclusion);
      const existing = allFacts.find(f => similarity(f.embedding, concEmb) > 0.85);
      if (existing && existing.confidence >= derivedConf) continue;

      const newFact = {
        id: `fact_inferred_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: `Inferred: ${rule.name}`,
        statement: rule.conclusion,
        embedding: concEmb,
        confidence: derivedConf,
        source: 'inferred',
        timestamp: Date.now(),
        derivedFrom: matchedFacts.map(f => f.id),
      };
      newFacts.push(newFact);
      this.facts.set(newFact.id, newFact);

      steps.push({
        id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        ruleId: rule.id,
        ruleName: rule.name,
        inputFacts: matchedFacts,
        outputFact: newFact,
        confidence: derivedConf,
        timestamp: Date.now(),
      });
    }

    this.reasoningHistory = [...this.reasoningHistory.slice(-49), ...steps];
    this.inferenceDepth++;
    return { newFacts, steps };
  }

  /**
   * Run multiple inference steps until fixpoint or maxSteps.
   * @param {number} [maxSteps=5]
   * @returns {{ allNewFacts: Fact[], allSteps: ReasoningStep[] }}
   */
  async runReasoningChain(maxSteps = 5) {
    const allNewFacts = [];
    const allSteps = [];

    for (let i = 0; i < maxSteps; i++) {
      const { newFacts, steps } = this.reason();
      allNewFacts.push(...newFacts);
      allSteps.push(...steps);
      if (newFacts.length === 0) break;
    }

    // Persist after reasoning
    await this._save();
    return { allNewFacts, allSteps };
  }

  /**
   * Semantic search: return facts matching the question.
   * @param {string} question
   * @param {number} [threshold=0.3]
   * @param {number} [limit=5]
   * @returns {{ fact: Fact, similarity: number }[]}
   */
  query(question, threshold = 0.3, limit = 5) {
    const qEmb = textToEmbedding(question);
    const results = [];
    for (const fact of this.facts.values()) {
      const sim = similarity(qEmb, fact.embedding);
      if (sim >= threshold) {
        results.push({ fact, similarity: sim });
      }
    }
    return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  /**
   * Trace a fact back to its root sources.
   * @param {string} factId
   * @returns {Fact[]}
   */
  getDerivationChain(factId) {
    const chain = [];
    const visited = new Set();
    const traverse = (id) => {
      if (visited.has(id)) return;
      visited.add(id);
      const fact = this.facts.get(id);
      if (!fact) return;
      chain.push(fact);
      for (const srcId of fact.derivedFrom) {
        traverse(srcId);
      }
    };
    traverse(factId);
    return chain.reverse();
  }

  /**
   * Get summary statistics.
   * @returns {Object}
   */
  getStats() {
    const facts = Array.from(this.facts.values());
    const bySource = { input: 0, inferred: 0, observation: 0, tool: 0 };
    let confSum = 0;
    for (const f of facts) {
      bySource[f.source] = (bySource[f.source] || 0) + 1;
      confSum += f.confidence;
    }
    return {
      totalFacts: facts.length,
      ...bySource,
      ruleCount: this.rules.length,
      inferenceSteps: this.reasoningHistory.length,
      averageConfidence: facts.length > 0 ? confSum / facts.length : 0,
    };
  }

  /**
   * Get the N most recent inferred facts.
   * @param {number} [n=3]
   * @returns {Fact[]}
   */
  getRecentInferences(n = 3) {
    return Array.from(this.facts.values())
      .filter(f => f.source === 'inferred')
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, n);
  }

  /**
   * Render a compact context string for injection into prompts.
   * @param {string} [contextQuery] optional query to filter relevant facts
   * @returns {string}
   */
  renderContextString(contextQuery) {
    const stats = this.getStats();
    const recentInferences = this.getRecentInferences(3);

    let relevant = [];
    if (contextQuery) {
      relevant = this.query(contextQuery, 0.35, 3).map(r => r.fact);
    }

    const parts = [
      `[Reasoning State]: ${stats.totalFacts} facts (${stats.inferred} inferred), ${stats.ruleCount} rules`,
    ];

    if (recentInferences.length > 0) {
      parts.push('Recent inferences:');
      for (const f of recentInferences) {
        parts.push(`  • ${f.statement} (conf: ${f.confidence.toFixed(2)})`);
      }
    }

    if (relevant.length > 0) {
      parts.push('Relevant knowledge:');
      for (const f of relevant) {
        parts.push(`  • ${f.statement} (conf: ${f.confidence.toFixed(2)})`);
      }
    }

    return parts.join('\n');
  }
}

export default FactInferenceEngine;
