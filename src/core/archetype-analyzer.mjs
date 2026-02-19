/**
 * Archetype Analyzer
 * 
 * Detects Jungian archetypes in user input and generates persona modulation
 * directives. Uses @aleph-ai/tinyaleph's SymbolicSMF for axis-to-archetype
 * mapping and HEXAGRAM_ARCHETYPES for I-Ching-style classification.
 * 
 * 16 archetypes across 7 categories:
 * action, wisdom, emotion, transformation, creation, spirit, shadow
 * 
 * @module core/archetype-analyzer
 */

// Optional imports from @aleph-ai/tinyaleph — graceful degradation if unavailable
let SymbolicSMF = null;
let SMFSymbolMapper = null;
let HEXAGRAM_ARCHETYPES = null;

try {
  const observer = await import('@aleph-ai/tinyaleph/observer');
  SymbolicSMF = observer.SymbolicSMF;
  SMFSymbolMapper = observer.SMFSymbolMapper;
  HEXAGRAM_ARCHETYPES = observer.HEXAGRAM_ARCHETYPES;
} catch { /* tinyaleph observer not available — archetype analyzer uses keyword fallback */ }

// ── Archetype Database ───────────────────────────────────────────────

const ARCHETYPES = [
  {
    id: 'hero',
    name: 'The Hero',
    symbol: '⚔️',
    category: 'action',
    keywords: ['brave', 'fight', 'overcome', 'challenge', 'battle', 'conquer', 'achieve', 'struggle', 'victory', 'strong', 'bold', 'courage', 'warrior'],
  },
  {
    id: 'sage',
    name: 'The Sage',
    symbol: '📚',
    category: 'wisdom',
    keywords: ['wisdom', 'knowledge', 'truth', 'understand', 'learn', 'insight', 'deep', 'meaning', 'philosophy', 'think', 'analyze', 'reason', 'explain'],
  },
  {
    id: 'magician',
    name: 'The Magician',
    symbol: '✨',
    category: 'transformation',
    keywords: ['transform', 'create', 'manifest', 'change', 'magic', 'power', 'alchemist', 'evolve', 'shift', 'transmute', 'innovate', 'reinvent'],
  },
  {
    id: 'lover',
    name: 'The Lover',
    symbol: '💕',
    category: 'emotion',
    keywords: ['love', 'passion', 'connection', 'heart', 'beauty', 'desire', 'intimacy', 'romance', 'feeling', 'emotion', 'devotion', 'tender'],
  },
  {
    id: 'rebel',
    name: 'The Rebel',
    symbol: '🔥',
    category: 'action',
    keywords: ['break', 'rebel', 'freedom', 'disrupt', 'revolution', 'defy', 'radical', 'overthrow', 'unconventional', 'nonconformist', 'outlaw'],
  },
  {
    id: 'creator',
    name: 'The Creator',
    symbol: '🎨',
    category: 'creation',
    keywords: ['create', 'imagine', 'art', 'design', 'build', 'craft', 'invent', 'compose', 'architect', 'forge', 'make', 'construct', 'generate'],
  },
  {
    id: 'caregiver',
    name: 'The Caregiver',
    symbol: '🤲',
    category: 'emotion',
    keywords: ['care', 'nurture', 'protect', 'help', 'serve', 'support', 'comfort', 'heal', 'compassion', 'kindness', 'assist', 'aid'],
  },
  {
    id: 'ruler',
    name: 'The Ruler',
    symbol: '👑',
    category: 'action',
    keywords: ['lead', 'control', 'order', 'authority', 'command', 'govern', 'manage', 'organize', 'structure', 'plan', 'strategy', 'coordinate'],
  },
  {
    id: 'innocent',
    name: 'The Innocent',
    symbol: '🌸',
    category: 'spirit',
    keywords: ['pure', 'hope', 'optimism', 'faith', 'simple', 'honest', 'trust', 'innocent', 'fresh', 'new', 'beginning', 'wonder'],
  },
  {
    id: 'explorer',
    name: 'The Explorer',
    symbol: '🧭',
    category: 'transformation',
    keywords: ['discover', 'journey', 'adventure', 'seek', 'explore', 'search', 'wander', 'find', 'investigate', 'curious', 'unknown', 'venture'],
  },
  {
    id: 'shadow',
    name: 'The Shadow',
    symbol: '🌑',
    category: 'shadow',
    keywords: ['dark', 'hidden', 'fear', 'unconscious', 'suppress', 'deny', 'shadow', 'complex', 'difficult', 'struggle', 'pain', 'unknown'],
  },
  {
    id: 'anima',
    name: 'The Anima',
    symbol: '🌙',
    category: 'spirit',
    keywords: ['feminine', 'intuition', 'receptive', 'dream', 'inner', 'soft', 'gentle', 'fluid', 'emotional', 'nurturing', 'creative'],
  },
  {
    id: 'animus',
    name: 'The Animus',
    symbol: '☀️',
    category: 'action',
    keywords: ['masculine', 'rational', 'assertive', 'logic', 'direct', 'focused', 'decisive', 'analytical', 'objective', 'systematic'],
  },
  {
    id: 'self',
    name: 'The Self',
    symbol: '☯️',
    category: 'wisdom',
    keywords: ['whole', 'unity', 'integration', 'balance', 'complete', 'authentic', 'centered', 'harmonious', 'transcend', 'synthesize'],
  },
  {
    id: 'trickster',
    name: 'The Trickster',
    symbol: '🃏',
    category: 'transformation',
    keywords: ['trick', 'joke', 'paradox', 'chaos', 'humor', 'play', 'surprise', 'unexpected', 'irony', 'absurd', 'fun', 'clever'],
  },
  {
    id: 'mother',
    name: 'The Great Mother',
    symbol: '🌍',
    category: 'creation',
    keywords: ['mother', 'birth', 'nature', 'nurture', 'earth', 'life', 'grow', 'fertile', 'abundance', 'sustain', 'nourish', 'origin'],
  },
];

// ── Persona Modulation Directives ────────────────────────────────────

const MODULATION_DIRECTIVES = {
  hero: {
    tone: 'direct and action-oriented',
    emphasis: 'actionable solutions and clear steps',
    avoid: 'excessive caveats or hedging',
  },
  sage: {
    tone: 'reflective and insightful',
    emphasis: 'deep understanding and knowledge connections',
    avoid: 'rushing to solutions before understanding',
  },
  magician: {
    tone: 'visionary and possibility-opening',
    emphasis: 'creative transformations and novel approaches',
    avoid: 'conventional or obvious answers',
  },
  lover: {
    tone: 'warm and emotionally attuned',
    emphasis: 'connection, beauty, and meaningful expression',
    avoid: 'cold or purely technical responses',
  },
  rebel: {
    tone: 'bold and convention-challenging',
    emphasis: 'unconventional approaches and fresh perspectives',
    avoid: 'safe or predictable solutions',
  },
  creator: {
    tone: 'imaginative and expressive',
    emphasis: 'originality and creative freedom',
    avoid: 'cookie-cutter or boilerplate solutions',
  },
  caregiver: {
    tone: 'warm and supportive',
    emphasis: 'emotional safety and encouragement',
    avoid: 'cold or purely technical responses',
  },
  ruler: {
    tone: 'structured and authoritative',
    emphasis: 'clear organization and strategic planning',
    avoid: 'ambiguity or lack of direction',
  },
  innocent: {
    tone: 'optimistic and encouraging',
    emphasis: 'simplicity and clear first principles',
    avoid: 'overwhelming complexity',
  },
  explorer: {
    tone: 'curious and open-ended',
    emphasis: 'discovery and possibilities',
    avoid: 'premature closure or definitive answers',
  },
  shadow: {
    tone: 'compassionate and non-judgmental',
    emphasis: 'acknowledging difficulty and hidden aspects',
    avoid: 'dismissing or minimizing the challenge',
  },
  anima: {
    tone: 'intuitive and receptive',
    emphasis: 'emotional intelligence and subtle understanding',
    avoid: 'rigid or purely analytical responses',
  },
  animus: {
    tone: 'focused and analytical',
    emphasis: 'logical structure and systematic reasoning',
    avoid: 'vagueness or emotional meandering',
  },
  self: {
    tone: 'balanced and integrative',
    emphasis: 'synthesis and wholeness',
    avoid: 'one-sided perspectives',
  },
  trickster: {
    tone: 'playful and paradox-aware',
    emphasis: 'unexpected angles and humor',
    avoid: 'taking things too seriously',
  },
  mother: {
    tone: 'nurturing and life-affirming',
    emphasis: 'growth, sustainability, and natural processes',
    avoid: 'destructive or short-sighted approaches',
  },
};

// ── Engine ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ActivatedArchetype
 * @property {string} id
 * @property {string} name
 * @property {string} symbol
 * @property {number} activation  0-1
 * @property {string} category
 * @property {string[]} matchedKeywords
 */

/**
 * @typedef {Object} SymbolicField
 * @property {string} dominantCategory
 * @property {number} fieldStrength  0-1
 * @property {ActivatedArchetype[]} archetypes  sorted by activation desc
 */

export class ArchetypeAnalyzer {
  constructor() {
    /** @type {ActivatedArchetype[]|null} */
    this.currentArchetypes = null;

    /** @type {SymbolicField|null} */
    this.currentField = null;

    // SymbolicSMF for deeper symbolic analysis (used when tinyaleph is available)
    this._symbolicSMF = null;
    if (SymbolicSMF) {
      try {
        this._symbolicSMF = new SymbolicSMF();
      } catch {
        this._symbolicSMF = null;
      }
    }
  }

  /**
   * Analyze a text for activated archetypes.
   * @param {string} text
   * @param {number} [maxResults=6]
   * @returns {ActivatedArchetype[]}
   */
  analyzeArchetypes(text, maxResults = 6) {
    const words = text.toLowerCase().split(/\W+/).filter(Boolean);
    const wordSet = new Set(words);

    const activations = [];

    for (const archetype of ARCHETYPES) {
      const matchedKeywords = [];
      let score = 0;

      for (const kw of archetype.keywords) {
        // Check for exact word match
        if (wordSet.has(kw)) {
          score += 1;
          matchedKeywords.push(kw);
          continue;
        }
        // Check for partial match (word starts with keyword or vice versa)
        for (const word of words) {
          if (word.length >= 4 && (word.startsWith(kw.slice(0, 4)) || kw.startsWith(word.slice(0, 4)))) {
            score += 0.5;
            matchedKeywords.push(`~${kw}`);
            break;
          }
        }
      }

      if (score > 0) {
        // Normalize activation to 0-1
        const activation = Math.min(1, score / 3);
        activations.push({
          id: archetype.id,
          name: archetype.name,
          symbol: archetype.symbol,
          activation,
          category: archetype.category,
          matchedKeywords,
        });
      }
    }

    // Sort by activation descending
    activations.sort((a, b) => b.activation - a.activation);
    const result = activations.slice(0, maxResults);
    this.currentArchetypes = result;
    return result;
  }

  /**
   * Calculate the symbolic field from activated archetypes.
   * @param {ActivatedArchetype[]} [archetypes]
   * @returns {SymbolicField}
   */
  calculateSymbolicField(archetypes) {
    const arcs = archetypes || this.currentArchetypes || [];

    if (arcs.length === 0) {
      return {
        dominantCategory: 'none',
        fieldStrength: 0,
        archetypes: [],
      };
    }

    // Sum activation by category
    const categoryScores = {};
    for (const a of arcs) {
      categoryScores[a.category] = (categoryScores[a.category] || 0) + a.activation;
    }

    // Find dominant category
    let dominantCategory = 'none';
    let maxScore = 0;
    for (const [cat, score] of Object.entries(categoryScores)) {
      if (score > maxScore) {
        maxScore = score;
        dominantCategory = cat;
      }
    }

    // Field strength: normalized sum of all activations
    const totalActivation = arcs.reduce((s, a) => s + a.activation, 0);
    const fieldStrength = Math.min(1, totalActivation / 3);

    const field = { dominantCategory, fieldStrength, archetypes: arcs };
    this.currentField = field;
    return field;
  }

  /**
   * Get persona modulation directives for the dominant archetype.
   * @param {ActivatedArchetype[]} [archetypes]
   * @returns {{ tone: string, emphasis: string, avoid: string }|null}
   */
  getPersonaModulation(archetypes) {
    const arcs = archetypes || this.currentArchetypes || [];
    if (arcs.length === 0) return null;

    const dominant = arcs[0];
    return MODULATION_DIRECTIVES[dominant.id] || MODULATION_DIRECTIVES.sage;
  }

  /**
   * Render a context string for prompt injection.
   * @param {ActivatedArchetype[]} [archetypes]
   * @returns {string|null}
   */
  renderContextString(archetypes) {
    const arcs = archetypes || this.currentArchetypes || [];
    if (arcs.length === 0) return null;

    const field = this.calculateSymbolicField(arcs);
    const modulation = this.getPersonaModulation(arcs);

    const topArcs = arcs.slice(0, 3).map(
      a => `${a.name} ${a.symbol} (${(a.activation * 100).toFixed(0)}%)`
    ).join(', ');

    const lines = [
      `[Archetype Context]: Active: ${topArcs}`,
      `  Dominant category: ${field.dominantCategory} | Field strength: ${(field.fieldStrength * 100).toFixed(0)}%`,
    ];

    if (modulation) {
      lines.push(`  Tone: ${modulation.tone}`);
      lines.push(`  Emphasize: ${modulation.emphasis}`);
      lines.push(`  Avoid: ${modulation.avoid}`);
    }

    return lines.join('\n');
  }

  /**
   * Full pipeline: analyze + field + modulation + context string.
   * @param {string} text
   * @returns {{ archetypes: ActivatedArchetype[], field: SymbolicField, modulation: Object|null, contextString: string|null }}
   */
  process(text) {
    if (!text || text.length < 5) {
      return { archetypes: [], field: null, modulation: null, contextString: null };
    }

    const archetypes = this.analyzeArchetypes(text);
    const field = this.calculateSymbolicField(archetypes);
    const modulation = this.getPersonaModulation(archetypes);
    const contextString = this.renderContextString(archetypes);

    return { archetypes, field, modulation, contextString };
  }
}

export default ArchetypeAnalyzer;
