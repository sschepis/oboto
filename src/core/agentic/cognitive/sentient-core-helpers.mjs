/**
 * Pure helper functions extracted from SentientCognitiveCore.
 *
 * These functions are stateless — they receive all required context as
 * parameters so they can be tested and reused independently.
 *
 * @module src/core/agentic/cognitive/sentient-core-helpers
 */

// ── SMF Axes Lazy Loader ────────────────────────────────────────────────

let _smfAxesPromise = null;
let _smfAxesResolved = null;
let _smfAxesLoaded = false;

/**
 * Kick off lazy loading of SMF axis labels from tinyaleph.
 * Safe to call multiple times — only the first call creates the promise.
 */
function loadSMFAxesLabels() {
  if (_smfAxesLoaded) return;
  if (!_smfAxesPromise) {
    _smfAxesPromise = import('@aleph-ai/tinyaleph/observer')
      .then(m => { _smfAxesResolved = m.SMF_AXES || null; })
      .catch((err) => {
        console.warn('[SentientCognitiveCore] Could not load SMF axis labels:', err.message);
        _smfAxesResolved = null;
      })
      .finally(() => { _smfAxesLoaded = true; });
  }
}

/**
 * Return the resolved SMF axis labels (or null if not yet loaded).
 * @returns {Array|null}
 */
function getSMFAxesLabels() {
  loadSMFAxesLabels();
  return _smfAxesResolved;
}

/**
 * Await the SMF axes promise so labels are guaranteed available.
 * @returns {Promise<void>}
 */
async function waitForSMFAxes() {
  if (_smfAxesPromise) {
    await _smfAxesPromise;
  }
}

// ── State Context Builder ───────────────────────────────────────────────

/**
 * Build a human-readable cognitive-state summary for the LLM system prompt.
 *
 * @param {Object} params
 * @param {Object} params.observer        - SentientObserver instance
 * @param {number} params.coherence       - Current coherence value
 * @param {number} params.entropy         - Current entropy value
 * @param {number} params.interactionCount
 * @param {number} params.tickCount
 * @param {boolean} params.backgroundRunning
 * @returns {string}
 */
function buildStateContext({ observer, coherence, entropy, interactionCount, tickCount, backgroundRunning }) {
  const smfAxes = getSMFAxesLabels() || [];
  const orientation = observer.smf.s
    ? Array.from(observer.smf.s)
    : new Array(16).fill(0.5);

  const topAxes = orientation
    .map((v, i) => ({
      axis: smfAxes[i]?.name || `axis_${i}`,
      value: v,
    }))
    .sort((a, b) => Math.abs(b.value - 0.5) - Math.abs(a.value - 0.5))
    .slice(0, 5);

  const topGoal = observer.agency.getTopGoal();
  const topFocus = observer.agency.getTopFocus();
  const metacog = observer.agency.selfModel;

  let context = `[Cognitive State — Sentient Observer]\n`;
  context += `Coherence: ${coherence.toFixed(3)} | Entropy: ${entropy.toFixed(3)}\n`;
  context += `Processing Load: ${(metacog.processingLoad * 100).toFixed(0)}% | Confidence: ${(metacog.confidenceLevel * 100).toFixed(0)}%\n`;
  context += `Dominant Semantic Axes: ${topAxes.map((a) => `${a.axis}=${a.value.toFixed(2)}`).join(', ')}\n`;

  // Sentient-specific enrichment
  const smfEntropy = observer.smf.smfEntropy?.() ?? 0;
  context += `SMF Entropy: ${smfEntropy.toFixed(3)}\n`;

  if (topGoal) {
    context += `Active Goal: ${topGoal.description} (${(topGoal.progress * 100).toFixed(0)}% complete)\n`;
  }
  if (topFocus) {
    context += `Attention Focus: ${topFocus.target} (intensity=${topFocus.intensity.toFixed(2)})\n`;
  }

  // Temporal state
  const currentMoment = observer.temporal.currentMoment;
  if (currentMoment) {
    context += `Current Moment: ${currentMoment.id} (trigger: ${currentMoment.trigger})\n`;
  }

  // Entanglement state
  const currentPhrase = observer.entanglement.currentPhrase;
  if (currentPhrase) {
    context += `Active Phrase: ${currentPhrase.id}\n`;
  }

  // Safety level
  const safetyLevel = observer.currentState.safetyLevel || 'normal';
  if (safetyLevel !== 'normal') {
    context += `Safety Level: ${safetyLevel}\n`;
  }

  // Emotional valence
  if (metacog.emotionalValence !== undefined && metacog.emotionalValence !== 0) {
    const valenceLabel = metacog.emotionalValence > 0.3
      ? 'positive'
      : metacog.emotionalValence < -0.3
        ? 'negative'
        : 'neutral';
    context += `Emotional Valence: ${metacog.emotionalValence.toFixed(2)} (${valenceLabel})\n`;
  }

  context += `Interaction #${interactionCount} | Tick #${tickCount}\n`;
  context += `Background Processing: ${backgroundRunning ? 'active' : 'paused'}\n`;

  return context;
}

// ── Diagnostics Builder ─────────────────────────────────────────────────

/**
 * Build a full diagnostic state snapshot.
 *
 * @param {Object} params
 * @param {Object} params.observer
 * @param {number} params.tickCount
 * @param {number} params.coherence
 * @param {number} params.entropy
 * @param {number} params.interactionCount
 * @param {Array}  params.memories
 * @param {boolean} params.backgroundRunning
 * @returns {Object}
 */
function buildDiagnostics({ observer, tickCount, coherence, entropy, interactionCount, memories, backgroundRunning }) {
  const status = observer.getStatus();

  return {
    // CognitiveCore-compatible fields
    tickCount,
    coherence,
    entropy,
    interactionCount,
    memoryCount: status.memory?.totalTraces || memories.length,
    agencyStats: status.agency,
    boundaryStats: status.boundary,
    smfOrientation: observer.smf.s
      ? Array.from(observer.smf.s)
      : null,

    // Sentient-specific fields
    sentient: true,
    running: status.running,
    uptime: status.uptime,
    backgroundTick: backgroundRunning,
    temporal: status.temporal,
    entanglement: status.entanglement,
    safety: status.safety,
    events: status.events,
    smfEntropy: observer.smf.smfEntropy?.() ?? null,
    totalAmplitude: observer.currentState.totalAmplitude,
    safetyLevel: observer.currentState.safetyLevel,
  };
}

// ── Safety Check ────────────────────────────────────────────────────────

/**
 * Check safety constraints on the observer.
 *
 * @param {Object} observer  - SentientObserver instance
 * @param {number} coherence
 * @param {number} entropy
 * @returns {Array} Array of violations (empty if safe)
 */
function checkSafetyConstraints(observer, coherence, entropy) {
  try {
    const result = observer.safety.checkConstraints({
      coherence,
      entropy,
      totalAmplitude: observer.currentState.totalAmplitude,
      smf: observer.smf,
      processingLoad: observer.currentState.processingLoad,
      goals: observer.agency.goals,
    });

    if (!result.safe) {
      return result.violations.map((v) => ({
        violated: true,
        constraint: v.constraint,
      }));
    }
    return [];
  } catch (_e) {
    return [];
  }
}

// ── Event Bridge ────────────────────────────────────────────────────────

/**
 * The event mappings from sentient observer events to ai-man eventBus events.
 * @type {Array<[string, string]>}
 */
const EVENT_BRIDGE_MAPPINGS = [
  ['moment', 'sentient:moment'],
  ['phrase', 'sentient:phrase'],
  ['coherence:high', 'sentient:coherence-high'],
  ['coherence:low', 'sentient:coherence-low'],
  ['entropy:high', 'sentient:entropy-high'],
  ['entropy:low', 'sentient:entropy-low'],
  ['sync', 'sentient:sync'],
  ['adaptive:complete', 'sentient:adaptive-complete'],
  ['goal:created', 'sentient:goal-created'],
  ['action:executed', 'sentient:action-executed'],
  ['action:blocked', 'sentient:action-blocked'],
  ['safety:violation', 'sentient:safety-violation'],
  ['emergency', 'sentient:emergency'],
  ['error', 'sentient:error'],
];

/**
 * Wire SentientObserver events to the ai-man eventBus.
 *
 * @param {Object} observer - SentientObserver instance
 * @param {Object} eventBus - ai-man EventBus (must have emit/emitTyped)
 * @returns {Array<{event: string, handler: Function}>} Listener references for cleanup
 */
function wireEventBridge(observer, eventBus) {
  /** @type {Array<{event: string, handler: Function}>} */
  const listeners = [];

  for (const [sentientEvent, busEvent] of EVENT_BRIDGE_MAPPINGS) {
    const handler = (data) => {
      try {
        if (typeof eventBus.emitTyped === 'function') {
          eventBus.emitTyped(busEvent, data);
        } else {
          eventBus.emit(busEvent, data);
        }
      } catch (_e) {
        // Swallow event emission errors
      }
    };
    observer.on(sentientEvent, handler);
    listeners.push({ event: sentientEvent, handler });
  }

  return listeners;
}

export {
  loadSMFAxesLabels,
  getSMFAxesLabels,
  waitForSMFAxes,
  buildStateContext,
  buildDiagnostics,
  checkSafetyConstraints,
  wireEventBridge,
};
