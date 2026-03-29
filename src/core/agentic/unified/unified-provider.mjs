/**
 * UnifiedProvider — pluggable agentic provider that wires all Phase 1-3
 * subsystems together behind a single {@link AgenticProvider} interface.
 *
 * Replaces the Eventic, Cognitive, Megacode, and Maha providers with a
 * single, composable agent loop.  Each subsystem is instantiated once in
 * {@link initialize} and threaded into the {@link AgentLoop} which drives
 * the ReAct cycle.
 *
 * @module src/core/agentic/unified/unified-provider
 */

import { AgenticProvider } from '../base-provider.mjs';
import { resolveUnifiedConfig } from './config.mjs';
import { StreamController } from './stream-controller.mjs';
import { ContextManager } from './context-manager.mjs';
import { ToolExecutorBridge } from './tool-executor-bridge.mjs';
import { CognitiveLayer } from './cognitive-layer.mjs';
import { SafetyLayer } from './safety-layer.mjs';
import { MemorySystem } from './memory-system.mjs';
import { LearningEngine } from './learning-engine.mjs';
import { AgentLoop } from './agent-loop.mjs';
import { SurfacePipeline } from '../../../surfaces/surface-pipeline.mjs';

// ════════════════════════════════════════════════════════════════════════
// UnifiedProvider Class
// ════════════════════════════════════════════════════════════════════════

/**
 * Unified agentic provider combining cognitive processing, safety,
 * memory, learning, and a clean ReAct agent loop into a single provider.
 *
 * @extends AgenticProvider
 */
export class UnifiedProvider extends AgenticProvider {
  // ════════════════════════════════════════════════════════════════════
  // Identity
  // ════════════════════════════════════════════════════════════════════

  /** @type {string} */
  get id() {
    return 'unified';
  }

  /** @type {string} */
  get name() {
    return 'Unified Agent';
  }

  /** @type {string} */
  get description() {
    return (
      'Unified agentic provider combining cognitive processing, safety ' +
      'guard rails, holographic memory, experience-based learning, and a ' +
      'clean ReAct agent loop into a single composable provider.'
    );
  }

  constructor() {
    super();

    /** @private @type {Object|null} */
    this._config = null;
    /** @private @type {ContextManager|null} */
    this._contextManager = null;
    /** @private @type {ToolExecutorBridge|null} */
    this._toolBridge = null;
    /** @private @type {CognitiveLayer|null} */
    this._cognitiveLayer = null;
    /** @private @type {SafetyLayer|null} */
    this._safetyLayer = null;
    /** @private @type {MemorySystem|null} */
    this._memorySystem = null;
    /** @private @type {LearningEngine|null} */
    this._learningEngine = null;
    /** @private @type {AgentLoop|null} */
    this._agentLoop = null;
    /** @private @type {SurfacePipeline|null} */
    this._surfacePipeline = null;
  }

  // ════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ════════════════════════════════════════════════════════════════════

  /**
   * Initialize the unified provider and all subsystems.
   *
   * Called once when this provider becomes active in the
   * {@link AgenticProviderRegistry}.
   *
   * @param {Object} deps — shared dependencies from EventicFacade
   * @param {Object} deps.aiProvider      — EventicAIProvider instance
   * @param {Object} deps.toolExecutor    — ai-man ToolExecutor
   * @param {Object} deps.historyManager  — HistoryManager instance
   * @param {Object} deps.engine          — Eventic engine
   * @param {Object} deps.eventBus        — AiManEventBus instance
   * @param {Object} deps.consciousness   — Consciousness module
   * @param {string} deps.workingDir      — workspace directory
   * @param {Object} deps.facade          — EventicFacade instance
   * @param {Object} [deps.registry]      — AgenticProviderRegistry
   * @param {Object} [deps.userConfig]    — user-supplied config overrides
   */
  async initialize(deps) {
    await super.initialize(deps);

    // ── 1. Resolve configuration ───────────────────────────────────
    this._config = resolveUnifiedConfig(deps.userConfig);

    // ── 2. Create CognitiveLayer ───────────────────────────────────
    this._cognitiveLayer = new CognitiveLayer({ config: this._config });
    this._cognitiveLayer.initialize(deps);

    // ── 3. Create SafetyLayer ──────────────────────────────────────
    this._safetyLayer = new SafetyLayer({
      config: this._config,
      cognitiveLayer: this._cognitiveLayer,
    });

    // ── 4. Create MemorySystem ─────────────────────────────────────
    this._memorySystem = new MemorySystem({ config: this._config });
    await this._memorySystem.initialize(deps);

    // ── 5. Create LearningEngine ───────────────────────────────────
    this._learningEngine = new LearningEngine({
      config: this._config,
      memorySystem: this._memorySystem,
    });
    await this._learningEngine.initialize();

    // ── 6. Create ContextManager ───────────────────────────────────
    this._contextManager = new ContextManager({
      config: this._config,
      toolExecutor: deps.toolExecutor,
      aiProvider: deps.aiProvider,
    });

    // ── 7. Create ToolExecutorBridge ───────────────────────────────
    // StreamController is created per-turn in run() and wired via
    // setStreamController() before each turn.  Pass null here to avoid
    // allocating an orphaned placeholder that would never be disposed.
    this._toolBridge = new ToolExecutorBridge({
      toolExecutor: deps.toolExecutor,
      engine: deps.engine,
      streamController: null,
      config: this._config,
    });

    // ── 7.5. Create SurfacePipeline & wire into ToolBridge ────────
    // The SurfacePipeline intercepts surface mutation tools and routes
    // them through a verified 5-gate pipeline (validate → snapshot →
    // mutate → render-verify → visual-verify) with auto-revert on
    // failure and structured fix guidance.
    try {
      const surfaceManager = deps.engine?.surfaces || deps.toolExecutor?.surfaceManager || null;
      if (surfaceManager) {
        this._surfacePipeline = new SurfacePipeline({
          surfaceManager,
          eventBus: deps.eventBus,
          learningEngine: this._learningEngine,
        });
        this._toolBridge.setSurfacePipeline(this._surfacePipeline);
      }
    } catch (e) {
      // Non-fatal — surfaces work without the pipeline, just unverified
      console.warn('[UnifiedProvider] SurfacePipeline init skipped:', e.message);
    }

    // ── 8. Create AgentLoop ────────────────────────────────────────
    // Same as above — the per-turn StreamController is set before run().
    this._agentLoop = new AgentLoop({
      config: this._config,
      streamController: null,
      toolBridge: this._toolBridge,
      contextManager: this._contextManager,
      cognitiveLayer: this._cognitiveLayer,
      safetyLayer: this._safetyLayer,
      memorySystem: this._memorySystem,
      learningEngine: this._learningEngine,
      aiProvider: deps.aiProvider,
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // Main Entry Point
  // ════════════════════════════════════════════════════════════════════

  /**
   * Process a single user turn.
   *
   * Wraps in {@link _deduplicatedRun} from the base class so that
   * identical non-streaming requests share a single Promise.
   *
   * @param {string} input — user message
   * @param {Object} options
   * @param {AbortSignal}  [options.signal]   — abort signal
   * @param {boolean}      [options.stream]   — enable streaming
   * @param {Function}     [options.onChunk]  — chunk callback
   * @param {Function}     [options.onToken]  — token callback
   * @param {string}       [options.model]    — model override
   * @param {number}       [options.maxIterations] — per-turn iteration cap
   * @param {number}       [options.temperature]   — temperature override
   * @returns {Promise<{ response: string, streamed?: boolean, tokenUsage?: Object, metadata?: Object }>}
   */
  async run(input, options = {}) {
    return this._deduplicatedRun(input, options, async () => {
      // ── Create per-turn StreamController ────────────────────────
      const turnStream = new StreamController({
        onToken: options.onToken,
        onChunk: options.onChunk,
        signal: options.signal,
        config: this._config.streaming,
      });

      // Wire the per-turn stream into subsystems
      this._agentLoop.setStreamController(turnStream);
      this._toolBridge.setStreamController(turnStream);

      // Resolve conversation-scoped history for the agent loop.
      // Prefer per-call options.conversationHistory (from ConversationContext),
      // falling back to the deps historyManager for backward compat.
      const convHistory = options.conversationHistory
        || this._deps?.historyManager?.getHistory()
        || [];
      const loopOptions = { ...options, conversationHistory: convHistory };

      try {
        const result = await this._agentLoop.run(input, loopOptions);

        return {
          response: result.response,
          streamed: !!(options.stream || options.onChunk || options.onToken),
          tokenUsage: result.tokenUsage || null,
          metadata: result.diagnostics,
        };
      } finally {
        // Always dispose the per-turn stream
        turnStream.dispose();
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // Diagnostics
  // ════════════════════════════════════════════════════════════════════

  /**
   * Aggregate diagnostics from all subsystems.
   *
   * @returns {Object} combined diagnostics snapshot
   */
  getDiagnostics() {
    return {
      provider: this.id,
      cognitive: this._cognitiveLayer?.getDiagnostics() || {},
      memory: this._memorySystem?.getDiagnostics?.() || {},
      learning: this._learningEngine?.getStats?.() || {},
      surfacePipeline: this._surfacePipeline ? {
        enabled: true,
        stats: this._surfacePipeline.getStats?.() || {},
      } : { enabled: false },
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // Health Check
  // ════════════════════════════════════════════════════════════════════

  /**
   * Check if all subsystems are healthy and ready.
   *
   * @returns {Promise<{ healthy: boolean, reason?: string }>}
   */
  async healthCheck() {
    const base = await super.healthCheck();
    if (!base.healthy) return base;

    if (!this._config) {
      return { healthy: false, reason: 'UnifiedProvider not initialized — config missing' };
    }
    if (!this._agentLoop) {
      return { healthy: false, reason: 'UnifiedProvider not initialized — agent loop missing' };
    }
    if (!this._toolBridge) {
      return { healthy: false, reason: 'UnifiedProvider not initialized — tool bridge missing' };
    }

    return { healthy: true };
  }

  // ════════════════════════════════════════════════════════════════════
  // Disposal
  // ════════════════════════════════════════════════════════════════════

  /**
   * Clean up all subsystems in reverse creation order.
   * Safe to call multiple times.
   */
  async dispose() {
    // Reverse order of creation
    this._agentLoop = null;
    this._toolBridge = null;
    this._contextManager = null;

    if (this._learningEngine) {
      this._learningEngine = null;
    }

    if (this._memorySystem?.dispose) {
      try { await this._memorySystem.dispose(); } catch { /* best-effort */ }
    }
    this._memorySystem = null;

    this._safetyLayer = null;
    this._cognitiveLayer = null;
    this._config = null;

    await super.dispose();
  }
}
