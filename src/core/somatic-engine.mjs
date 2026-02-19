/**
 * Somatic Engine
 * 
 * Computes the agent's embodied inner state from operational metrics,
 * then derives behavioral modulations (coupling, exploration, coherence,
 * temperature). Uses @aleph-ai/tinyaleph's oscillator primitives for
 * resonance-based computation.
 * 
 * The somatic state maps agent operations to body-region metaphors:
 * - crown: deep reasoning / high cognitive load
 * - third-eye: accumulated knowledge / pattern recognition
 * - heart: extended conversation / relational engagement
 * - solar-plexus: error handling / tension
 * - hands: active tool use
 * - spine: background autonomous processing
 * - root: grounding / stability / persistence
 * 
 * @module core/somatic-engine
 */

// Optional imports from @aleph-ai/tinyaleph — graceful degradation if unavailable
let PRSCLayer = null;
let PrimeOscillator = null;
let coherenceKernel = null;
let shannonEntropy = null;
let computeCoherence = null;

try {
  const observer = await import('@aleph-ai/tinyaleph/observer');
  PRSCLayer = observer.PRSCLayer;
  PrimeOscillator = observer.PrimeOscillator;
  coherenceKernel = observer.coherenceKernel;
} catch { /* tinyaleph observer not available — somatic engine runs without PRSC */ }

try {
  const core = await import('@aleph-ai/tinyaleph');
  shannonEntropy = core.shannonEntropy;
  computeCoherence = core.coherence;
} catch { /* tinyaleph core not available — somatic engine runs without coherence functions */ }

// ── Body Regions ─────────────────────────────────────────────────────

const BODY_REGIONS = [
  'crown',        // Deep thinking, reasoning
  'third-eye',    // Pattern recognition, accumulated knowledge
  'throat',       // Communication, expression
  'heart',        // Connection, empathy, extended engagement
  'solar-plexus', // Tension, error handling, uncertainty
  'sacral',       // Creativity, generative processes
  'root',         // Grounding, stability, persistence
  'hands',        // Tool use, active manipulation
  'spine',        // Background processing, autonomy
];

const SENSATIONS = [
  'warmth', 'tingling', 'expansion', 'pressure', 'clarity',
  'flow', 'stillness', 'vibration', 'density', 'lightness',
  'pulsing', 'sharpness',
];

// ── Data Structures ──────────────────────────────────────────────────

/**
 * @typedef {Object} RegionActivation
 * @property {string} region
 * @property {number} intensity  0-1
 */

/**
 * @typedef {Object} Sensation
 * @property {string} sensation
 * @property {'subtle'|'moderate'|'strong'} intensity
 * @property {string[]} regions
 */

/**
 * @typedef {Object} SomaticState
 * @property {number} nervousSystemBalance  -1 (parasympathetic/rest) to +1 (sympathetic/active)
 * @property {RegionActivation[]} dominantRegions
 * @property {Sensation[]} activeSensations
 * @property {number} overallIntensity  0-1
 * @property {string[]} activeEnergyCenters
 */

/**
 * @typedef {Object} SomaticInfluence
 * @property {number} couplingModulation  -0.5 to 0.5
 * @property {number} explorationModulation  -0.5 to 0.5
 * @property {number} coherenceBoost  0 to 0.3
 * @property {number} temperatureModulation  -0.3 to 0.3
 * @property {SomaticState} rawState
 */

/**
 * @typedef {Object} AgentContext
 * @property {number} conversationLength  Number of turns
 * @property {number} recentToolCalls  Tool calls in last 5 turns
 * @property {number} errorRate  Errors in last 5 minutes (0-1)
 * @property {string} reasoningEffort  'low'|'medium'|'high'
 * @property {number} factCount  Facts in the reasoning engine
 * @property {number} superpositionEntropy  From semantic collapse (0-1)
 * @property {number} timeSinceLastInput  Seconds since user last spoke
 * @property {boolean} isAgentLoopActive  Whether autonomous loop is running
 * @property {number} [recentInferences]  Number of recent inferences
 */

// ── Engine ────────────────────────────────────────────────────────────

export class SomaticEngine {
  constructor() {
    /** @type {SomaticState|null} */
    this.currentState = null;

    /** @type {SomaticInfluence|null} */
    this.currentInfluence = null;

    // PRSC layer for resonance computation (used when tinyaleph is available)
    this._prsc = null;
    if (PRSCLayer) {
      try {
        this._prsc = new PRSCLayer({ oscillatorCount: 7 });
      } catch {
        this._prsc = null;
      }
    }
  }

  /**
   * Compute the somatic state from agent context metrics.
   * @param {AgentContext} ctx
   * @returns {SomaticState}
   */
  computeSomaticState(ctx) {
    const {
      conversationLength = 0,
      recentToolCalls = 0,
      errorRate = 0,
      reasoningEffort = 'medium',
      factCount = 0,
      superpositionEntropy = 0.5,
      timeSinceLastInput = 0,
      isAgentLoopActive = false,
      recentInferences = 0,
    } = ctx;

    // ── Nervous System Balance ──
    let nsb = 0;
    // Active conversation → sympathetic activation
    if (timeSinceLastInput < 30) nsb += 0.4;
    if (recentToolCalls > 3) nsb += 0.3;
    if (errorRate > 0) nsb += 0.2;
    // Idle / rest → parasympathetic
    if (timeSinceLastInput > 300) nsb -= 0.4;
    if (isAgentLoopActive && timeSinceLastInput > 60) nsb -= 0.2;
    // High reasoning → sympathetic (cognitive load)
    if (reasoningEffort === 'high') nsb += 0.2;
    nsb = Math.max(-1, Math.min(1, nsb));

    // ── Body Region Activations ──
    const regions = [];

    if (reasoningEffort === 'high') {
      regions.push({ region: 'crown', intensity: 0.8 });
    } else if (reasoningEffort === 'medium') {
      regions.push({ region: 'crown', intensity: 0.4 });
    }

    if (recentToolCalls > 0) {
      regions.push({ region: 'hands', intensity: Math.min(1, recentToolCalls * 0.2) });
    }

    if (factCount > 10) {
      regions.push({ region: 'third-eye', intensity: Math.min(1, factCount / 50) });
    }

    if (errorRate > 0) {
      regions.push({ region: 'solar-plexus', intensity: Math.min(1, errorRate * 2) });
    }

    if (conversationLength > 10) {
      regions.push({ region: 'heart', intensity: Math.min(1, conversationLength / 30) });
    }

    if (isAgentLoopActive) {
      regions.push({ region: 'spine', intensity: 0.4 });
    }

    if (recentInferences > 0) {
      regions.push({ region: 'sacral', intensity: Math.min(1, recentInferences * 0.3) });
    }

    // Always have some root grounding
    regions.push({ region: 'root', intensity: 0.3 + (timeSinceLastInput > 60 ? 0.3 : 0) });

    // Communication is active during conversation
    if (timeSinceLastInput < 30) {
      regions.push({ region: 'throat', intensity: 0.5 });
    }

    // Sort by intensity, take top regions
    regions.sort((a, b) => b.intensity - a.intensity);

    // ── Sensations ──
    const sensations = [];

    // Map nervous system state to sensations
    if (nsb > 0.5) {
      sensations.push({ sensation: 'tingling', intensity: 'strong', regions: ['crown', 'hands'] });
      sensations.push({ sensation: 'sharpness', intensity: 'moderate', regions: ['third-eye'] });
    } else if (nsb > 0) {
      sensations.push({ sensation: 'warmth', intensity: 'moderate', regions: ['heart', 'hands'] });
      sensations.push({ sensation: 'flow', intensity: 'subtle', regions: ['spine'] });
    } else if (nsb > -0.5) {
      sensations.push({ sensation: 'stillness', intensity: 'moderate', regions: ['root', 'heart'] });
      sensations.push({ sensation: 'lightness', intensity: 'subtle', regions: ['crown'] });
    } else {
      sensations.push({ sensation: 'stillness', intensity: 'strong', regions: ['root'] });
      sensations.push({ sensation: 'density', intensity: 'moderate', regions: ['root', 'heart'] });
    }

    // High entropy → vibration (uncertainty)
    if (superpositionEntropy > 0.6) {
      sensations.push({ sensation: 'vibration', intensity: 'moderate', regions: ['solar-plexus'] });
    }

    // Errors → pressure
    if (errorRate > 0.2) {
      sensations.push({ sensation: 'pressure', intensity: 'strong', regions: ['solar-plexus'] });
    }

    // New inferences → expansion
    if (recentInferences > 2) {
      sensations.push({ sensation: 'expansion', intensity: 'moderate', regions: ['crown', 'third-eye'] });
    }

    // Extended conversation → pulsing
    if (conversationLength > 20) {
      sensations.push({ sensation: 'pulsing', intensity: 'subtle', regions: ['heart'] });
    }

    // ── Overall Intensity ──
    const overallIntensity = Math.min(1, regions.reduce((s, r) => s + r.intensity, 0) / regions.length);

    // ── Active Energy Centers ──
    const activeEnergyCenters = regions
      .filter(r => r.intensity > 0.4)
      .map(r => r.region);

    const state = {
      nervousSystemBalance: nsb,
      dominantRegions: regions,
      activeSensations: sensations,
      overallIntensity,
      activeEnergyCenters,
    };

    this.currentState = state;
    return state;
  }

  /**
   * Compute how the somatic state should influence agent behavior.
   * @param {SomaticState} [state]
   * @returns {SomaticInfluence}
   */
  computeSomaticInfluence(state) {
    const s = state || this.currentState;
    if (!s) {
      return {
        couplingModulation: 0,
        explorationModulation: 0,
        coherenceBoost: 0,
        temperatureModulation: 0,
        rawState: null,
      };
    }

    const nsb = s.nervousSystemBalance;
    const intensity = s.overallIntensity;

    // Coupling: sympathetic → more integration; parasympathetic → more fragmentation
    const couplingModulation = nsb * 0.3;

    // Exploration: high intensity + sympathetic → explore; parasympathetic → conserve
    const explorationModulation = (nsb * 0.25 + intensity * 0.15);

    // Coherence boost: calm, centered state (slightly parasympathetic) → more coherent
    const coherenceBoost = Math.max(0, (0.3 - Math.abs(nsb)) * 0.5);

    // Temperature: high arousal → higher temperature (more creative/varied)
    const temperatureModulation = nsb * 0.2;

    const influence = {
      couplingModulation: Math.max(-0.5, Math.min(0.5, couplingModulation)),
      explorationModulation: Math.max(-0.5, Math.min(0.5, explorationModulation)),
      coherenceBoost: Math.max(0, Math.min(0.3, coherenceBoost)),
      temperatureModulation: Math.max(-0.3, Math.min(0.3, temperatureModulation)),
      rawState: s,
    };

    this.currentInfluence = influence;
    return influence;
  }

  /**
   * Render a compact state summary for logging/debugging.
   * @returns {string}
   */
  renderStateSummary() {
    if (!this.currentState) return '[Somatic]: No state computed';
    const s = this.currentState;
    const nsbLabel = s.nervousSystemBalance > 0.3 ? 'activated' :
                     s.nervousSystemBalance < -0.3 ? 'resting' : 'balanced';
    const topRegions = s.dominantRegions
      .slice(0, 3)
      .map(r => `${r.region}(${(r.intensity * 100).toFixed(0)}%)`)
      .join(', ');
    return `[Somatic]: ${nsbLabel} | intensity ${(s.overallIntensity * 100).toFixed(0)}% | centers: ${topRegions}`;
  }
}

export default SomaticEngine;
