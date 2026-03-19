/**
 * SentientCognitiveCore — adapter that wraps the full SentientObserver
 * and exposes the same API surface as CognitiveCore.
 *
 * This allows the CognitiveAgent to seamlessly upgrade from the lightweight
 * CognitiveCore to the full sentient-core.js observer by changing a single
 * config flag (`sentient.enabled: true`), without modifying any of the
 * 11-step cognitive loop logic.
 *
 * The adapter:
 *  - Proxies processInput() → SentientObserver.processText() + tick()
 *  - Proxies validateOutput() → BoundaryLayer.objectivityGate.check()
 *  - Proxies remember() → SentientObserver.memory.store()
 *  - Proxies recall() → SentientObserver.memory.recallBySimilarity()
 *  - Proxies tick() → SentientObserver.tick()
 *  - Exposes getStateContext() with richer SMF/temporal/entanglement data
 *  - Exposes getDiagnostics() with full observer status
 *  - Bridges SentientObserver events to an optional eventBus
 *
 * Additionally provides sentient-specific APIs not on CognitiveCore:
 *  - processTextAdaptive() — ACT-style adaptive processing
 *  - introspect() — deep observer introspection
 *  - getAdaptiveStats() — adaptive processing history
 *  - startBackground() / stopBackground() — background tick lifecycle
 *  - toJSON() / loadFromJSON() — state serialization
 *
 * @module src/core/agentic/cognitive/sentient-cognitive-core
 */

import { loadSentientCore, loadTinyAlephBackend } from './sentient-bridge.mjs';
import {
  loadSMFAxesLabels,
  waitForSMFAxes,
  buildStateContext,
  buildDiagnostics,
  checkSafetyConstraints,
  wireEventBridge,
} from './sentient-core-helpers.mjs';
import { storeInteraction, recallByQuery } from './sentient-core-memory.mjs';

class SentientCognitiveCore {
  /**
   * @param {Object} config - Sentient configuration
   * @param {number}  [config.primeCount=64]
   * @param {number}  [config.tickRate=60]
   * @param {boolean} [config.backgroundTick=true]
   * @param {boolean} [config.adaptiveProcessing=true]
   * @param {number}  [config.adaptiveMaxSteps=50]
   * @param {number}  [config.adaptiveCoherenceThreshold=0.7]
   * @param {number}  [config.coherenceThreshold=0.7]
   * @param {number}  [config.objectivityThreshold=0.6]
   * @param {string}  [config.memoryPath]
   * @param {string}  [config.name='Sentient Observer']
   * @param {import('events').EventEmitter} [config.eventBus]
   */
  constructor(config = {}) {
    this.config = config;

    // Load the CJS SentientObserver via the bridge
    const { SentientObserver } = loadSentientCore();
    const backend = loadTinyAlephBackend({ primeCount: config.primeCount || 64 });

    // Instantiate the full SentientObserver
    this.observer = new SentientObserver(backend, {
      primeCount: config.primeCount || 64,
      tickRate: config.tickRate || 60,
      coherenceThreshold: config.coherenceThreshold || 0.7,
      name: config.name || 'Sentient Observer',
      memoryPath: config.memoryPath,
      adaptiveProcessing: config.adaptiveProcessing !== false,
      adaptiveMaxSteps: config.adaptiveMaxSteps || 50,
      adaptiveCoherenceThreshold: config.adaptiveCoherenceThreshold || 0.7,
    });

    // Store the backend for direct text encoding
    this.backend = backend;

    // ── CognitiveCore-compatible state ──────────────────────────────
    // These mirror the public properties that CognitiveCore exposes
    this.tickCount = 0;
    this.coherence = 0;
    this.entropy = 0;
    this.lastInputPrimes = [];
    this.interactionCount = 0;

    // CognitiveCore exposes memories[] and maxMemories
    // We proxy to SentientObserver.memory but keep a shallow list
    // for compatibility with recall() prime-overlap scoring
    this.memories = [];
    this.maxMemories = 200;

    // Safety constraints — proxy to SentientObserver.safety
    this.safetyConstraints = [];

    // Event bus bridge (optional)
    this._eventBus = config.eventBus || null;
    /** @type {Array<{event: string, handler: Function}>} */
    this._eventBridgeListeners = [];
    if (this._eventBus) {
      this._eventBridgeListeners = wireEventBridge(this.observer, this._eventBus);
    }

    // Background tick state
    this._backgroundRunning = false;

    // Eagerly start SMF axes loading so it resolves before first
    // getStateContext() call.  Callers should await ensureReady()
    // after construction for guaranteed availability.
    loadSMFAxesLabels();
  }

  /**
   * Wait for async initialisation to complete (SMF axis label import).
   * Must be called (and awaited) after construction before the first
   * call to getStateContext() to guarantee axis labels are available.
   *
   * @returns {Promise<void>}
   */
  async ensureReady() {
    await waitForSMFAxes();
  }

  // ════════════════════════════════════════════════════════════════════
  // CognitiveCore API — drop-in compatible methods
  // ════════════════════════════════════════════════════════════════════

  /**
   * Process input text through the full sentient observer pipeline.
   * Compatible with CognitiveCore.processInput() return shape.
   *
   * @param {string} text
   * @returns {Object} { primes, coherence, entropy, smfOrientation, activePrimes, topFocus, activeGoals, processingLoad, interactionCount }
   */
  processInput(text) {
    // Pause background tick to avoid interleaving during settle ticks
    const wasBg = this._backgroundRunning;
    if (wasBg) this.stopBackground();

    try {
      // Feed text into the observer
      this.observer.processText(text);

      // Run a few ticks to let oscillators settle (matches CognitiveCore behavior)
      const settleTicks = this.config.settleTicksPerInput ?? 5;
      for (let i = 0; i < settleTicks; i++) {
        this._forceTick();
      }

      // Sync state from observer
      this._syncState();
      this.interactionCount++;

      const state = this.observer.currentState;
      const agencyStats = this.observer.agency.getStats();

      return {
        primes: state.activePrimes || [],
        coherence: this.coherence,
        entropy: this.entropy,
        smfOrientation: state.smfOrientation
          ? Array.from(state.smfOrientation)
          : null,
        activePrimes: (state.activePrimes || []).slice(0, 10),
        topFocus: state.topFocus || null,
        activeGoals: agencyStats.activeGoals || 0,
        processingLoad: state.processingLoad || 0,
        interactionCount: this.interactionCount,
      };
    } finally {
      // Resume background tick if it was running — must happen even if
      // processText/tick threw, otherwise the loop is permanently stopped.
      if (wasBg) this.startBackground();
    }
  }

  /**
   * Validate LLM output through the ObjectivityGate.
   * Compatible with CognitiveCore.validateOutput() return shape.
   *
   * @param {string} output
   * @param {Object} context
   * @returns {Object} { passed, R, reason, decoderResults }
   */
  validateOutput(output, context = {}) {
    try {
      const gateResult = this.observer.boundary.objectivityGate.check(
        output,
        context
      );
      return {
        passed: gateResult.shouldBroadcast,
        R: gateResult.R,
        reason: gateResult.reason,
        decoderResults: gateResult.decoderResults,
      };
    } catch (_e) {
      // Fallback if objectivityGate is not available on the boundary
      return { passed: true, R: 1.0, reason: 'gate_unavailable', decoderResults: [] };
    }
  }

  /**
   * Build a human-readable cognitive-state summary for the LLM system prompt.
   * Enhanced version with richer sentient observer data.
   *
   * @returns {string}
   */
  getStateContext() {
    this._syncState();
    return buildStateContext({
      observer: this.observer,
      coherence: this.coherence,
      entropy: this.entropy,
      interactionCount: this.interactionCount,
      tickCount: this.tickCount,
      backgroundRunning: this._backgroundRunning,
    });
  }

  /**
   * Store an interaction in sentient memory.
   * Compatible with CognitiveCore.remember() API.
   *
   * @param {string} input
   * @param {string} output
   */
  remember(input, output) {
    storeInteraction({
      observer: this.observer,
      input,
      output,
      coherence: this.coherence,
      entropy: this.entropy,
      interactionCount: this.interactionCount,
      memories: this.memories,
      maxMemories: this.maxMemories,
    });
  }

  /**
   * Recall relevant memories by text query.
   * Compatible with CognitiveCore.recall() return shape.
   *
   * @param {string} query
   * @param {number} limit
   * @returns {Array<{ input: string, output: string, coherence: number, timestamp: number, score: number }>}
   */
  recall(query, limit = 5) {
    return recallByQuery({
      observer: this.observer,
      backend: this.backend,
      query,
      limit,
      memories: this.memories,
    });
  }

  /**
   * Create a goal from user intent.
   * Compatible with CognitiveCore.createGoal() API.
   *
   * @param {string} description
   * @param {number} priority
   * @returns {Object|null}
   */
  createGoal(description, priority = 0.8) {
    return this.observer.agency.createExternalGoal(description, { priority });
  }

  /**
   * Advance physics simulation by one timestep.
   * Compatible with CognitiveCore.tick() API.
   */
  tick() {
    this._forceTick();
    this._syncState();
  }

  /**
   * Return full diagnostic state.
   * Compatible with CognitiveCore.getDiagnostics() return shape,
   * plus additional sentient-specific fields.
   *
   * @returns {Object}
   */
  getDiagnostics() {
    this._syncState();
    return buildDiagnostics({
      observer: this.observer,
      tickCount: this.tickCount,
      coherence: this.coherence,
      entropy: this.entropy,
      interactionCount: this.interactionCount,
      memories: this.memories,
      backgroundRunning: this._backgroundRunning,
    });
  }

  /**
   * Check safety constraints.
   * Compatible with CognitiveCore.checkSafety() return shape.
   *
   * @returns {Array} Array of violations (empty if safe)
   */
  checkSafety() {
    return checkSafetyConstraints(this.observer, this.coherence, this.entropy);
  }

  /**
   * Reset all state to initial conditions.
   * Compatible with CognitiveCore.reset() API.
   */
  reset() {
    this.stopBackground();

    // Remove bridged event listeners before observer.reset() to prevent
    // duplicates if wireEventBridge() is called again after re-initialisation.
    for (const { event, handler } of this._eventBridgeListeners) {
      try { this.observer.removeListener(event, handler); } catch (_e) { /* ignore */ }
    }
    this._eventBridgeListeners = [];

    this.observer.reset();
    this.tickCount = 0;
    this.coherence = 0;
    this.entropy = 0;
    this.lastInputPrimes = [];
    this.interactionCount = 0;
    this.memories = [];
  }

  // ════════════════════════════════════════════════════════════════════
  // Sentient-specific extended API
  // ════════════════════════════════════════════════════════════════════

  /**
   * Process text with adaptive (ACT-style) depth.
   * Uses coherenceGatedCompute to determine processing depth.
   *
   * @param {string} text
   * @param {Object} [options]
   * @returns {Object} Processing result with steps, halted, coherence, etc.
   */
  processTextAdaptive(text, options = {}) {
    return this.observer.processTextAdaptive(text, options);
  }

  /**
   * Get deep introspection report from the observer.
   *
   * @returns {Object}
   */
  introspect() {
    return this.observer.introspect();
  }

  /**
   * Get adaptive processing statistics.
   *
   * @returns {Object}
   */
  getAdaptiveStats() {
    return this.observer.getAdaptiveStats();
  }

  /**
   * Get the full observer status.
   *
   * @returns {Object}
   */
  getStatus() {
    return this.observer.getStatus();
  }

  /**
   * Start the background tick loop.
   * SentientObserver runs a continuous setInterval at tickRate Hz.
   */
  startBackground() {
    if (this._backgroundRunning) return;
    this.observer.start();
    this._backgroundRunning = true;
  }

  /**
   * Stop the background tick loop.
   */
  stopBackground() {
    if (!this._backgroundRunning) return;
    this.observer.stop();
    this._backgroundRunning = false;
  }

  /**
   * Check if background tick is running.
   * @returns {boolean}
   */
  isBackgroundRunning() {
    return this._backgroundRunning;
  }

  /**
   * Save observer state to JSON.
   *
   * @returns {Object}
   */
  toJSON() {
    return {
      observerState: this.observer.toJSON(),
      interactionCount: this.interactionCount,
      memories: this.memories.slice(-50), // Keep last 50 simple memories as backup
    };
  }

  /**
   * Load observer state from JSON.
   *
   * @param {Object} data
   */
  loadFromJSON(data) {
    if (data.observerState) {
      this.observer.loadFromJSON(data.observerState);
    }
    if (data.interactionCount !== undefined) {
      this.interactionCount = data.interactionCount;
    }
    if (data.memories) {
      this.memories = data.memories;
    }
    this._syncState();
  }

  /**
   * Get the SentientObserver's event emitter for direct subscription.
   *
   * @returns {Object} AlephEventEmitter
   */
  getEmitter() {
    return this.observer.getEmitter();
  }

  /**
   * Create an evolution stream for async iteration over observer state.
   *
   * @param {Object} [options]
   * @returns {Object} EvolutionStream
   */
  createEvolutionStream(options = {}) {
    return this.observer.createEvolutionStream(options);
  }

  // ════════════════════════════════════════════════════════════════════
  // Internal Methods
  // ════════════════════════════════════════════════════════════════════

  /**
   * Execute a single tick on the SentientObserver, temporarily enabling
   * `running` if the background loop is not active.
   *
   * JavaScript is single-threaded, so the background setInterval callback
   * cannot fire during this synchronous call — no need to stop/restart the
   * interval (which would destroy and recreate it, causing unnecessary
   * overhead and a brief window where background events could be missed).
   *
   * @private
   */
  _forceTick() {
    const wasRunning = this.observer.running;
    if (!wasRunning) {
      this.observer.running = true;
    }
    try {
      this.observer.tick();
    } finally {
      if (!wasRunning) {
        this.observer.running = false;
      }
    }
  }

  /**
   * Sync local state from the SentientObserver's current state.
   * @private
   */
  _syncState() {
    const state = this.observer.currentState;
    this.tickCount = this.observer.tickCount;
    this.coherence = state.coherence || 0;
    this.entropy = state.entropy || 0;
    this.lastInputPrimes = state.activePrimes || [];
  }
}

export { SentientCognitiveCore };
export default SentientCognitiveCore;
