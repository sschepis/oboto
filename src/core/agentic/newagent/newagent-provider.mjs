/**
 * NewAgentProvider — agentic provider that wraps the autonomous AgentRunner
 * from src/core/agent, exposing it through the standard AgenticProvider
 * interface so it can be activated via the AgenticProviderRegistry.
 *
 * Integrated features from the Unified Provider:
 *  1. Streaming — tokens/commentary emitted via StreamController per turn
 *  2. Tool Bridge — ai-man ToolExecutor available as 'tool <name> <args>'
 *  3. Safety/Doom — iteration ceiling + repeated-command-batch detection
 *  4. Context Compaction — LLM-based summarization when context overflows
 *  5. Context Management — pre-routing files/surfaces, transient purge
 *  6. 3-Layer Memory — holographic, experience, and pattern memory
 *  7. Learning Engine — outcome recording, strategy suggestion, prompt hints
 *  8. Cognitive Layer — PERCEIVE→ENCODE→ORIENT→ATTEND pipeline
 *  9. Composable Prompt Building — 9-section system prompt assembly
 *
 * @module src/core/agentic/newagent/newagent-provider
 */

import { AgenticProvider } from '../base-provider.mjs';
import { StreamController } from '../unified/stream-controller.mjs';
import { ContextManager } from '../unified/context-manager.mjs';
import { MemorySystem } from '../unified/memory-system.mjs';
import { LearningEngine } from '../unified/learning-engine.mjs';
import { CognitiveLayer } from '../unified/cognitive-layer.mjs';
// Note: buildUnifiedSystemPrompt is NOT used here — the AgentRunner uses its
// own CLI-command prompt from config.mjs. Cognitive/memory/learning context
// is injected via additionalSystemContext instead.
import {
  AgentRunner,
  AssociativeStringStore,
  VirtualFileSystem,
  INITIAL_VFS,
  DEFAULT_MODEL,
  DEFAULT_PERSONA,
  MemoryBridge,
} from '../../agent/index.mjs';

// ════════════════════════════════════════════════════════════════════════
// Default Config
// ════════════════════════════════════════════════════════════════════════

/**
 * Default configuration for the NewAgentProvider subsystems.
 * Merged with any config passed via deps at initialization.
 * @private
 */
const DEFAULT_CONFIG = {
  cognitive: {
    enabled: false, // opt-in by default
    physicsTickCount: 3,
  },
  memory: {
    holographicEnabled: false,
    maxExperiences: 1000,
    maxPatterns: 100,
  },
  compaction: {
    maxContextTokens: 100_000,
    compactionThreshold: 0.8,
  },
};

// ════════════════════════════════════════════════════════════════════════
// NewAgentProvider Class
// ════════════════════════════════════════════════════════════════════════

/**
 * Agentic provider backed by the autonomous AgentRunner agent loop.
 *
 * @extends AgenticProvider
 */
export class NewAgentProvider extends AgenticProvider {
  // ════════════════════════════════════════════════════════════════════
  // Identity
  // ════════════════════════════════════════════════════════════════════

  /** @type {string} */
  get id() {
    return 'newagent';
  }

  /** @type {string} */
  get name() {
    return 'New Agent';
  }

  /** @type {string} */
  get description() {
    return (
      'Autonomous agent provider using a CLI-style loop with structured ' +
      'LLM calls (lmscript), dual semantic/lexical memory, virtual filesystem, ' +
      'AST mutation pipeline, batch command execution, streaming, tool bridge, ' +
      'doom detection, context compaction, pre-routing, 3-layer memory, ' +
      'learning engine, cognitive layer, and composable prompt building.'
    );
  }

  constructor() {
    super();

    /** @private @type {VirtualFileSystem|null} */
    this._vfs = null;
    /** @private @type {AssociativeStringStore|null} */
    this._voluntaryMem = null;
    /** @private @type {AssociativeStringStore|null} */
    this._involuntaryMem = null;
    /** @private @type {string} */
    this._persona = DEFAULT_PERSONA;
    /** @private @type {number} */
    this._turnCount = 0;
    /** @private @type {Object} */
    this._config = { ...DEFAULT_CONFIG };

    // ── Cross-turn history persistence (Fix 1) ──────────────────
    /** @private @type {Array<{type: string, content?: string, reflection?: string, reasoning?: string, commands?: string[], output?: string, error?: string}>} */
    this._conversationHistory = [];

    // ── Subsystems (initialized in initialize()) ──────────────────
    /** @private @type {ContextManager|null} */
    this._contextManager = null;
    /** @private @type {MemorySystem|null} */
    this._memorySystem = null;
    /** @private @type {LearningEngine|null} */
    this._learningEngine = null;
    /** @private @type {CognitiveLayer|null} */
    this._cognitiveLayer = null;
    /** @private @type {MemoryBridge|null} */
    this._memoryBridge = null;

    /** @private @type {{contextManager: {ok: boolean, error: string|null}, memorySystem: {ok: boolean, error: string|null}, learningEngine: {ok: boolean, error: string|null}, cognitiveLayer: {ok: boolean, error: string|null}}} */
    this._subsystemStatus = this._createSubsystemStatus();
  }

  // ════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ════════════════════════════════════════════════════════════════════

  /**
   * Initialize the provider and bootstrap all subsystems.
   *
   * @param {Object} deps — shared dependencies from EventicFacade
   */
  async initialize(deps) {
    await super.initialize(deps);

    this._subsystemStatus = this._createSubsystemStatus();

    // Merge user config with defaults
    const userConfig = deps?.config?.ai?.newagent || deps?.config?.ai?.agentic || {};
    this._config = this._mergeConfig(DEFAULT_CONFIG, userConfig);

    // ── Per-turn memory stores (AgentRunner internal) ──────────────
    this._voluntaryMem = new AssociativeStringStore();
    this._involuntaryMem = new AssociativeStringStore();

    // ── Virtual filesystem ────────────────────────────────────────
    this._vfs = new VirtualFileSystem(INITIAL_VFS);

    // ── Feature 5: Context Manager ────────────────────────────────
    this._contextManager = new ContextManager({
      config: this._config.compaction,
      toolExecutor: deps?.toolExecutor ?? null,
      aiProvider: deps?.aiProvider ?? null,
    });
    this._subsystemStatus.contextManager.ok = !!this._contextManager;

    // ── Feature 2: 3-Layer Memory System ──────────────────────────
    this._memorySystem = new MemorySystem({ config: this._config });
    try {
      await this._memorySystem.initialize({
        resoLangService: deps?.resoLangService ?? deps?.facade?.resoLangService ?? null,
        primeCount: this._config?.cognitive?.primeCount,
        objectivityThreshold: this._config?.cognitive?.objectivityThreshold,
      });
      this._subsystemStatus.memorySystem.ok = true;
    } catch (err) {
      this._subsystemStatus.memorySystem.error = err.message;
      console.warn('[NewAgentProvider] MemorySystem init failed:', err.message);
    }

    // ── Feature 3: Learning Engine ────────────────────────────────
    this._learningEngine = new LearningEngine({
      config: this._config,
      memorySystem: this._memorySystem,
    });
    try {
      await this._learningEngine.initialize();
      this._subsystemStatus.learningEngine.ok = true;
    } catch (err) {
      this._subsystemStatus.learningEngine.error = err.message;
      console.warn('[NewAgentProvider] LearningEngine init failed:', err.message);
    }

    // ── Feature 4: Cognitive Layer ────────────────────────────────
    this._cognitiveLayer = new CognitiveLayer({ config: this._config });
    try {
      this._cognitiveLayer.initialize({
        primeCount: this._config?.cognitive?.primeCount,
        objectivityThreshold: this._config?.cognitive?.objectivityThreshold,
      });
      this._subsystemStatus.cognitiveLayer.ok = !this._config?.cognitive?.enabled || this._cognitiveLayer.enabled;
      if (this._config?.cognitive?.enabled && !this._cognitiveLayer.enabled) {
        this._subsystemStatus.cognitiveLayer.error = 'Cognitive layer is enabled in config but failed to activate';
      }
    } catch (err) {
      this._subsystemStatus.cognitiveLayer.error = err.message;
      console.warn('[NewAgentProvider] CognitiveLayer init failed:', err.message);
    }

    // ── Feature 10: Unified Memory Bridge (Fix 6) ──────────────────
    this._memoryBridge = new MemoryBridge({
      voluntaryMem: this._voluntaryMem,
      involuntaryMem: this._involuntaryMem,
      memorySystem: this._memorySystem,
      cognitiveLayer: this._cognitiveLayer,
      learningEngine: this._learningEngine,
    });

    const initFailure = this._getCriticalInitFailureReason();
    if (initFailure) {
      throw new Error(initFailure);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Main Entry Point
  // ════════════════════════════════════════════════════════════════════

  /**
   * Process a single user turn by running the AgentRunner loop.
   *
   * @param {string} input — user message
   * @param {Object} options
   * @param {AbortSignal}  [options.signal]   — abort signal
   * @param {boolean}      [options.stream]   — enable streaming
   * @param {Function}     [options.onChunk]  — chunk callback
   * @param {Function}     [options.onToken]  — token callback
   * @param {string}       [options.model]    — model override
   * @param {number}       [options.maxIterations] — per-turn iteration cap
   * @returns {Promise<{ response: string, streamed?: boolean, tokenUsage?: Object, metadata?: Object }>}
   */
  async run(input, options = {}) {
    return this._deduplicatedRun(input, options, async () => {
      if (!this._deps) {
        throw new Error('NewAgentProvider not initialized. Call initialize() first.');
      }

      const health = await this.healthCheck();
      if (!health.healthy) {
        throw new Error(`NewAgentProvider unhealthy: ${health.reason}`);
      }

      this._turnCount++;
      const turnStart = Date.now();

      // ── Create per-turn StreamController ────────────────────────
      const turnStream = new StreamController({
        onToken: options.onToken,
        onChunk: options.onChunk,
        signal: options.signal,
      });

      try {
        // ────────────────────────────────────────────────────────────
        // Pre-turn processing: gather context from all subsystems
        // ────────────────────────────────────────────────────────────

        // ── Feature 5: Context Management — pre-route ──────────────
        let preRoutedContext = '';
        let isSurfaceUpdate = false;
        try {
          const tools = this._deps?.toolExecutor?.tools ?? this._deps?.engine?.tools;
          if (tools) {
            const { fileContext, surfaceContext } = await this._contextManager.preRoute(input, tools);
            if (fileContext?.length > 0) {
              const fileBlock = fileContext
                .filter(r => r.content && !r.error)
                .map(r => `[PRE-FETCHED: ${r.path}]\n${r.content}`)
                .join('\n\n');
              if (fileBlock) preRoutedContext += fileBlock + '\n\n';
            }
            if (surfaceContext) {
              preRoutedContext += surfaceContext + '\n\n';
              isSurfaceUpdate = true;
            }
          }
        } catch (err) {
          console.warn('[NewAgentProvider] Pre-routing failed:', err.message);
        }

        // ── Feature 4: Cognitive Layer — process input ──────────────
        let cognitiveContext = null;
        let cognitiveViolations = [];
        try {
          cognitiveContext = this._cognitiveLayer.processInput(input);
          cognitiveViolations = this._cognitiveLayer.checkSafety();
        } catch (err) {
          console.warn('[NewAgentProvider] Cognitive processing failed:', err.message);
        }

        // ── Feature 2: Memory System — recall ──────────────────────
        let memoryRecall = null;
        try {
          memoryRecall = await this._memorySystem.recallAll(input);
        } catch (err) {
          console.warn('[NewAgentProvider] Memory recall failed:', err.message);
        }

        // ── Feature 3: Learning Engine — strategy & hints ──────────
        let strategy = null;
        let learningHints = null;
        try {
          strategy = this._learningEngine.suggestStrategy(input);
          learningHints = this._learningEngine.evolvePromptHints(input);
        } catch (err) {
          console.warn('[NewAgentProvider] Learning engine failed:', err.message);
        }

        // ── Build additional context from subsystems ──────────────
        // NOTE: We do NOT override the system prompt with buildUnifiedSystemPrompt.
        // The AgentRunner uses its own CLI-command-based prompt (from config.mjs)
        // which tells the LLM about `ls`, `read`, `write`, `tool`, `finish`, etc.
        // Overriding it with the unified prompt (which describes function-calling
        // tools like read_file, write_file) would confuse the LLM.
        //
        // Instead, we inject cognitive/memory/learning context as additional
        // system context that gets appended to the CLI prompt.

        let additionalContext = '';

        // Cognitive context
        if (cognitiveContext?.stateContext) {
          additionalContext += `\n[Cognitive State]\n${cognitiveContext.stateContext}`;
        }
        if (cognitiveContext?.attention) {
          additionalContext += `\n[Attention Focus] ${JSON.stringify(cognitiveContext.attention)}`;
        }

        // Memory recall
        if (memoryRecall?.holographic?.length > 0) {
          const memBlock = memoryRecall.holographic
            .map(m => `- ${m.input || m.query}: ${m.response || m.result || ''}`)
            .join('\n');
          additionalContext += `\n[Holographic Memory Recall]\n${memBlock}`;
        }
        if (memoryRecall?.experiences?.length > 0) {
          const expBlock = memoryRecall.experiences
            .slice(0, 5)
            .map(e => `- ${e.input}: ${e.response || ''}`)
            .join('\n');
          additionalContext += `\n[Experience Recall]\n${expBlock}`;
        }
        if (memoryRecall?.patterns?.length > 0) {
          const patternHints = memoryRecall.patterns
            .filter(p => p.type === 'success_sequence' && p.successRate >= 0.7)
            .map(p => `Pattern: ${p.toolSequence.join(' → ')} (${(p.successRate * 100).toFixed(0)}% success)`)
            .join('\n');
          if (patternHints) {
            additionalContext += `\n[Pattern Memory]\n${patternHints}`;
          }
        }

        // Safety violations
        if (cognitiveViolations?.length > 0) {
          additionalContext += `\n[Safety Violations]\n${cognitiveViolations.map(v => `- ${v}`).join('\n')}`;
        }

        // Strategy & learning
        if (strategy?.suggestion) {
          additionalContext += `\n[Strategy Suggestion] ${strategy.suggestion} (confidence: ${(strategy.confidence * 100).toFixed(0)}%)`;
          if (strategy.warningFromFailure) {
            additionalContext += `\n[Warning] ${strategy.warningFromFailure}`;
          }
        }
        if (learningHints) {
          additionalContext += '\n' + learningHints;
        }

        // Surface context note
        if (isSurfaceUpdate) {
          additionalContext += '\n[Surface Update] The user is working with a UI surface. Use `tool read_surface {"id":"..."}` and `tool update_surface_component {"surface_id":"...","component_name":"...","jsx_source":"..."}` to interact with surfaces.';
        }

        // List available external tools so the agent knows what's accessible via `tool <name>`
        const toolNames = this._getToolNames();
        if (toolNames.length > 0) {
          additionalContext += `\n[Available External Tools] Use \`tool <name> <json_args>\` to call: ${toolNames.join(', ')}`;
        }

        // ────────────────────────────────────────────────────────────
        // Build and start the AgentRunner
        // ────────────────────────────────────────────────────────────

        const effectiveModel = this._resolveRunnerModel(options.model);

        const runner = new AgentRunner({
          vfs: this._vfs,
          voluntaryMem: this._voluntaryMem,
          involuntaryMem: this._involuntaryMem,
          persona: this._persona,
          memoryBridge: this._memoryBridge,  // Fix 6: unified recall
          options: {
            model: effectiveModel,
            maxIterations: options.maxIterations ?? 50,
            doomThreshold: 3,
            doomWindowSize: 8,
            externalToolExecutor: this._deps.toolExecutor ?? null,
            compactionFn: this._buildCompactionFn(),
            preRoutedContext: preRoutedContext || null,
            additionalSystemContext: additionalContext || null,
            // Do NOT set systemPromptOverride — let AgentRunner use its own
            // CLI-command-based prompt from config.mjs which documents
            // ls, read, write, tool, finish, etc.
          },
        });

        // Wire streaming: AgentRunner._emit → StreamController
        // Use chunk() which maps to onChunk (the callback the chat-handler provides).
        // Also emit commentary for structured logging/status display.
        runner.onStream = (text) => {
          if (text) {
            turnStream.commentary('', text);
            turnStream.chunk(text + '\n');
          }
        };

        // Append user message to persistent conversation history (Fix 1)
        // Use per-conversation history from options if provided, falling
        // back to the provider-local history for backward compatibility.
        const convHistory = options.conversationHistory || this._conversationHistory;
        convHistory.push({ type: 'user', content: input });
        let finalHistory = [...convHistory];
        let finalResponse = '';
        let doomDetected = false;

        const result = await new Promise((resolve, reject) => {
          runner.onHistoryUpdate = (updatedHistory) => {
            finalHistory = updatedHistory;
          };

          runner.onFinished = () => {
            // Extract the final response from the last agent or system message
            const lastAgent = [...finalHistory].reverse().find(m => m.type === 'agent');
            const lastSystem = [...finalHistory].reverse().find(m => m.type === 'system' && m.output);

            finalResponse = lastSystem?.output || lastAgent?.reflection || 'Task completed.';

            // Check if doom was detected
            const doomMsg = finalHistory.find(
              m => m.type === 'system' && m.error && m.error.includes('doom loop'),
            );
            if (doomMsg) doomDetected = true;

            // Save to history manager if available
            if (this._deps?.historyManager) {
              this._deps.historyManager.addMessage('user', input);
              this._deps.historyManager.addMessage('assistant', finalResponse, {
                provider: this.id,
                turn: this._turnCount,
              });
            }

            // Emit event if event bus is available
            this._deps?.eventBus?.emit?.('agentic:turn-complete', {
              provider: this.id,
              turn: this._turnCount,
              input,
              response: finalResponse,
            });

            resolve({
              response: finalResponse,
              streamed: !!(options.stream || options.onChunk || options.onToken),
              metadata: {
                provider: this.id,
                turn: this._turnCount,
                historyLength: finalHistory.length,
                doomDetected,
                model: effectiveModel,
                strategy: strategy?.suggestion || null,
              },
            });
          };

          runner.onError = (err) => {
            reject(err);
          };

          // Handle abort signal
          if (options.signal) {
            options.signal.addEventListener('abort', () => {
              runner.stop();
            }, { once: true });
          }

          // Start the autonomous loop with the full persistent history
          runner.start([...convHistory]).catch(reject);
        });

        // ────────────────────────────────────────────────────────────
        // Post-turn processing
        // ────────────────────────────────────────────────────────────

        const turnDuration = Date.now() - turnStart;

        // ── Feature 4: Cognitive Layer — remember & tick ────────────
        try {
          this._cognitiveLayer.remember(input, finalResponse);
          this._cognitiveLayer.tick();
        } catch (err) {
          console.warn('[NewAgentProvider] Cognitive post-turn failed:', err.message);
        }

        // ── Feature 2: Memory System — store interaction ───────────
        const toolsUsed = this._extractToolsUsed(finalHistory);
        try {
          this._memorySystem.storeInteraction({
            input,
            response: finalResponse,
            toolsUsed,
            success: !doomDetected,
            timestamp: Date.now(),
            duration: turnDuration,
          });
        } catch (err) {
          console.warn('[NewAgentProvider] Memory store failed:', err.message);
        }

        // ── Feature 3: Learning Engine — record outcome ────────────
        try {
          this._learningEngine.recordTurnOutcome({
            input,
            response: finalResponse,
            toolsUsed,
            success: !doomDetected,
            duration: turnDuration,
            iterations: finalHistory.filter(m => m.type === 'agent').length,
            doomDetected,
          });
        } catch (err) {
          console.warn('[NewAgentProvider] Learning record failed:', err.message);
        }

        // Update persistent conversation history from finalHistory (Fix 1)
        this._conversationHistory = finalHistory;

        turnStream.complete();
        return result;
      } finally {
        turnStream.dispose();
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ════════════════════════════════════════════════════════════════════

  /**
   * Build a compaction function using the ContextManager's compact method.
   *
   * @returns {Function|null} async (historyText) => summaryText
   * @private
   */
  _buildCompactionFn() {
    const aiProvider = this._deps?.aiProvider;
    if (!aiProvider?.ask) return null;

    return async (historyText) => {
      // Convert text history to messages array for ContextManager.compact()
      const fakeHistory = [
        { role: 'system', content: historyText },
      ];

      try {
        const compacted = await this._contextManager.compact(fakeHistory, null, 0);
        const summaryMsg = compacted.find(m => m.content?.includes('[Conversation Summary]'));
        return summaryMsg?.content || historyText.substring(0, 2000);
      } catch {
        // Fallback to direct aiProvider call
        const result = await aiProvider.ask([
          { role: 'system', content: 'You are a helpful assistant that summarizes conversation history concisely.' },
          {
            role: 'user',
            content: `Summarize this conversation history:\n\n${historyText}\n\nSummary:`,
          },
        ], { temperature: 0.3 });
        return typeof result === 'string' ? result : result?.content || result?.text || String(result);
      }
    };
  }

  /**
   * Create a fresh subsystem status object.
   *
   * @returns {{contextManager: {ok: boolean, error: string|null}, memorySystem: {ok: boolean, error: string|null}, learningEngine: {ok: boolean, error: string|null}, cognitiveLayer: {ok: boolean, error: string|null}}}
   * @private
   */
  _createSubsystemStatus() {
    return {
      contextManager: { ok: false, error: null },
      memorySystem: { ok: false, error: null },
      learningEngine: { ok: false, error: null },
      cognitiveLayer: { ok: false, error: null },
    };
  }

  /**
   * Return a fatal initialization error if a critical subsystem failed.
   *
   * @returns {string|null}
   * @private
   */
  _getCriticalInitFailureReason() {
    if (!this._subsystemStatus.contextManager.ok) {
      return this._subsystemStatus.contextManager.error || 'ContextManager failed to initialize';
    }
    if (!this._subsystemStatus.memorySystem.ok) {
      return this._subsystemStatus.memorySystem.error || 'MemorySystem failed to initialize';
    }
    if (!this._subsystemStatus.learningEngine.ok) {
      return this._subsystemStatus.learningEngine.error || 'LearningEngine failed to initialize';
    }
    if (this._config?.cognitive?.enabled && !this._subsystemStatus.cognitiveLayer.ok) {
      return this._subsystemStatus.cognitiveLayer.error || 'CognitiveLayer failed to initialize';
    }
    return null;
  }

  /**
   * Resolve the effective runner model.
   *
   * NewAgent is backed by lmscript's Gemini provider, so non-Gemini
   * overrides are rejected in favor of a known-safe Gemini default.
   *
   * @param {string|undefined|null} modelOverride
   * @returns {string}
   * @private
   */
  _resolveRunnerModel(modelOverride) {
    const candidates = [modelOverride, this._deps?.aiProvider?.model];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && /^gemini([-/]|$)/i.test(candidate.trim())) {
        return candidate.trim();
      }
    }
    return DEFAULT_MODEL;
  }

  /**
   * Build enriched cognitive context object for the prompt builder.
   *
   * @param {Object|null} rawCognitiveContext — from CognitiveLayer.processInput()
   * @param {Object|null} memoryRecall — from MemorySystem.recallAll()
   * @returns {Object|null} context for buildSystemPrompt()
   * @private
   */
  _buildCognitiveContextForPrompt(rawCognitiveContext, memoryRecall) {
    if (!rawCognitiveContext && !memoryRecall) return null;

    const ctx = {};

    // From cognitive layer
    if (rawCognitiveContext) {
      ctx.stateContext = rawCognitiveContext.stateContext || null;
      ctx.attention = rawCognitiveContext.attention || null;
    }

    // From memory system — combine holographic + experience recall as memories
    const memories = [];
    if (memoryRecall?.holographic?.length > 0) {
      for (const m of memoryRecall.holographic) {
        memories.push({
          input: m.input || m.query || '',
          output: m.response || m.result || '',
        });
      }
    }
    if (memoryRecall?.experiences?.length > 0) {
      for (const e of memoryRecall.experiences) {
        memories.push({
          input: e.input || '',
          output: e.response || '',
        });
      }
    }
    if (memories.length > 0) {
      ctx.memories = memories;
    }

    // Add pattern insights
    if (memoryRecall?.patterns?.length > 0) {
      const patternHints = memoryRecall.patterns
        .filter(p => p.type === 'success_sequence' && p.successRate >= 0.7)
        .map(p => `Pattern: ${p.toolSequence.join(' → ')} (${(p.successRate * 100).toFixed(0)}% success)`)
        .join('\n');
      if (patternHints) {
        ctx.stateContext = (ctx.stateContext || '') + '\n\n[Pattern Memory]\n' + patternHints;
      }
    }

    return Object.keys(ctx).length > 0 ? ctx : null;
  }

  /**
   * Get available tool names from the deps.
   *
   * @returns {Array<string>} tool name list
   * @private
   */
  _getToolNames() {
    try {
      const tools = this._deps?.toolExecutor?.tools ?? this._deps?.engine?.tools;
      if (tools instanceof Map) return [...tools.keys()];
      if (tools && typeof tools === 'object') return Object.keys(tools);
    } catch {
      // ignore
    }
    return [];
  }

  /**
   * Extract tool names used from the agent history.
   *
   * @param {Array} history — agent conversation history
   * @returns {Array<string>} tool names used
   * @private
   */
  _extractToolsUsed(history) {
    const tools = new Set();
    for (const msg of history) {
      if (msg.type === 'agent' && Array.isArray(msg.commands)) {
        for (const cmd of msg.commands) {
          const name = cmd.split(/\s+/)[0];
          if (name) tools.add(name);
        }
      }
    }
    return [...tools];
  }

  /**
   * Deep merge config objects.
   *
   * @param {Object} defaults
   * @param {Object} overrides
   * @returns {Object} merged config
   * @private
   */
  _mergeConfig(defaults, overrides) {
    const result = { ...defaults };
    for (const key of Object.keys(overrides)) {
      if (
        typeof overrides[key] === 'object' &&
        overrides[key] !== null &&
        !Array.isArray(overrides[key]) &&
        typeof defaults[key] === 'object' &&
        defaults[key] !== null
      ) {
        result[key] = this._mergeConfig(defaults[key], overrides[key]);
      } else {
        result[key] = overrides[key];
      }
    }
    return result;
  }

  // ════════════════════════════════════════════════════════════════════
  // Diagnostics
  // ════════════════════════════════════════════════════════════════════

  /**
   * Return diagnostic information about the provider state.
   *
   * @returns {Object} diagnostics snapshot
   */
  getDiagnostics() {
    return {
      provider: this.id,
      turnCount: this._turnCount,
      config: {
        cognitiveEnabled: !!this._config?.cognitive?.enabled,
        holographicEnabled: !!this._config?.memory?.holographicEnabled,
      },
      subsystems: this._subsystemStatus,
      voluntaryMemorySize: this._voluntaryMem?.items?.size ?? 0,
      involuntaryMemorySize: this._involuntaryMem?.items?.size ?? 0,
      vfsEntries: this._vfs ? Object.keys(this._vfs.fs).length : 0,
      memorySystem: this._memorySystem?.getDiagnostics?.() ?? null,
      learningEngine: this._learningEngine?.getSessionStats?.() ?? null,
      cognitiveLayer: this._cognitiveLayer?.getDiagnostics?.() ?? null,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // Health Check
  // ════════════════════════════════════════════════════════════════════

  /**
   * Check if the provider is healthy and ready.
   *
   * @returns {Promise<{ healthy: boolean, reason?: string }>}
   */
  async healthCheck() {
    const base = await super.healthCheck();
    if (!base.healthy) return base;

    const initFailure = this._getCriticalInitFailureReason();
    if (initFailure) {
      return { healthy: false, reason: initFailure };
    }

    if (!this._vfs) {
      return { healthy: false, reason: 'NewAgentProvider not initialized — VFS missing' };
    }

    if (!this._contextManager) {
      return { healthy: false, reason: 'NewAgentProvider not initialized — ContextManager missing' };
    }

    if (!this._memorySystem) {
      return { healthy: false, reason: 'NewAgentProvider not initialized — MemorySystem missing' };
    }

    if (!this._learningEngine) {
      return { healthy: false, reason: 'NewAgentProvider not initialized — LearningEngine missing' };
    }

    if (this._config?.cognitive?.enabled && !this._cognitiveLayer?.enabled) {
      return { healthy: false, reason: 'NewAgentProvider cognitive layer is enabled but unavailable' };
    }

    return { healthy: true };
  }

  // ════════════════════════════════════════════════════════════════════
  // Disposal
  // ════════════════════════════════════════════════════════════════════

  /**
   * Clear the cross-turn conversation history.
   * Useful for starting a fresh conversation while keeping subsystems alive.
   */
  clearHistory() {
    this._conversationHistory = [];
  }

  /**
   * Clean up all subsystems. Safe to call multiple times.
   */
  async dispose() {
    // Clear conversation history (Fix 1)
    this._conversationHistory = [];

    // Memory stores
    if (this._voluntaryMem) {
      this._voluntaryMem.clear();
      this._voluntaryMem = null;
    }
    if (this._involuntaryMem) {
      this._involuntaryMem.clear();
      this._involuntaryMem = null;
    }

    // VFS
    this._vfs = null;

    // Memory system
    if (this._memorySystem) {
      try {
        this._memorySystem.dispose();
      } catch {
        // best-effort
      }
      this._memorySystem = null;
    }

    // Learning engine (no dispose method, just null out)
    this._learningEngine = null;

    // Cognitive layer (no dispose method, just null out)
    this._cognitiveLayer = null;

    // Context manager (no dispose method, just null out)
    this._contextManager = null;

    // Memory bridge (Fix 6)
    this._memoryBridge = null;

    this._subsystemStatus = this._createSubsystemStatus();

    await super.dispose();
  }
}
