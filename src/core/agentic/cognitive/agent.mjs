/**
 * CognitiveAgent — orchestrator for the tinyaleph cognitive agentic system.
 *
 * Implements the 11-step cognitive agent loop via lmscript's LScriptRuntime:
 *
 *  1. PERCEIVE  — BoundaryLayer processes input
 *  2. ENCODE    — Map text to primes
 *  3. ORIENT    — SMF updates
 *  4. ATTEND    — AgencyLayer allocates attention
 *  5. GUARD     — Safety check
 *  6. RECALL    — Holographic memory retrieval
 *  7. THINK     — LLM generates response (via lmscript executeAgent)
 *  8. EXECUTE   — Tool calls (via lmscript agent loop)
 *  9. VALIDATE  — ObjectivityGate
 * 10. REMEMBER  — Store in holographic memory
 * 11. EVOLVE    — Tick physics
 *
 * The lmscript LScriptRuntime is a required dependency.  The cognitive
 * middleware, tool bridge, and event-bus transport are injected separately
 * via initRuntime().
 *
 * @module src/core/agentic/cognitive/agent
 */

import { z } from 'zod';
import { CognitiveCore } from './cognitive.mjs';
import { resolveCognitiveConfig } from './config.mjs';
import { ActivityTracker } from '../../activity-tracker.mjs';
import { emitStatus, emitCommentary, summarizeInput, describeToolCall, buildToolRoundNarrative } from '../../status-reporter.mjs';
import { isPathWithinRoot } from '../../../lib/path-validation.mjs';
import { isIncompleteResponse, truncateToolResult, summarizeHistory, shouldSkipPrecheck } from './agent-response-utils.mjs';
import { callLLM, getPrecheckCached, setPrecheckCached } from './agent-llm.mjs';
import { buildSystemPrompt, buildPluginTraitsBlock, getToolDefinitions } from './agent-prompt.mjs';
import { runPrecheck } from './agent-precheck.mjs';
import { processToolCalls } from './agent-tools.mjs';
import { selectRelevantTraits, matchTraitsByKeyword } from './agent-preroute.mjs';
import { StreamManager } from '../stream-manager.mjs';
import {
  initSentientCore as _initSentientCore,
  loadSentientState as _loadSentientState,
  saveSentientState as _saveSentientState,
  getSentientToolMetadata as _getSentientToolMetadata,
  executeSentientTool as _executeSentientTool,
} from './agent-sentient.mjs';
import {
  humanizeToolName,
  summarizeToolResult,
  buildFallbackResponse as _buildFallbackResponse,
  extractToolResults as _extractToolResults,
  getLmscriptTools as _getLmscriptTools,
  executeTool as _executeTool,
  isLikelyFilePath,
  preRoute as _preRoute,
} from './agent-helpers.mjs';
import { runContinuationLoop } from './agent-continuation.mjs';
import { isIterationExhaustion, recoverFromExhaustion } from './agent-exhaustion.mjs';

/**
 * Abort reason used by the empty-iteration early-exit AbortController.
 * Extracted as a constant so the abort site and detection site stay in sync.
 */
const EMPTY_ITERATION_ABORT_REASON = 'empty-iteration-limit';

/**
 * Zod schema for the lmscript agent's structured response.
 * executeAgent() forces JSON mode, so the LLM must emit an object
 * matching this schema.  We keep it minimal — a single `response` field.
 */
const AGENT_RESPONSE_SCHEMA = z.object({
  response: z.string().describe('Your complete response to the user'),
});

/**
 * @typedef {Object} CognitiveAgentDeps
 * @property {import('../../eventic-ai-plugin.mjs').EventicAIProvider} aiProvider
 * @property {import('../../../execution/tool-executor.mjs').ToolExecutor} toolExecutor
 * @property {import('../../history-manager.mjs').HistoryManager} historyManager
 * @property {import('events').EventEmitter} [eventBus]
 * @property {Object} [consciousness]
 * @property {string} workingDir
 * @property {Object} [engine]
 * @property {Object} [facade]
 */

class CognitiveAgent {
  /**
   * @param {CognitiveAgentDeps} deps - Injected dependencies from ai-man
   * @param {Object} userConfig - Partial configuration overrides
   */
  constructor(deps, userConfig = {}) {
    this.config = resolveCognitiveConfig(userConfig);

    // Store ai-man dependencies
    this.aiProvider = deps.aiProvider;
    this.toolExecutor = deps.toolExecutor;
    this.historyManager = deps.historyManager;
    this.eventBus = deps.eventBus;
    this.consciousness = deps.consciousness;
    this.workingDir = deps.workingDir;
    this.engine = deps.engine;
    this.facade = deps.facade;

    // Initialize cognitive core — start with the lightweight CognitiveCore.
    // If sentient mode is enabled, the provider's initialize() will call
    // initSentientCore() to upgrade to SentientCognitiveCore after
    // construction. Availability checks are deferred to initSentientCore()
    // to avoid synchronous CJS module loading via createRequire() during
    // construction.
    this._sentientEnabled = false;
    this._sentientPending = !!this.config.sentient?.enabled;
    this.cognitive = new CognitiveCore(this.config.cognitive);

    // Activity tracker for periodic status heartbeat
    this._tracker = new ActivityTracker({ intervalMs: 3000 });

    // Conversation history (internal to this agent)
    this.history = [];
    this.maxHistory = this.config.agent.maxHistory;

    // System prompt — prefer the facade's dynamic prompt (which includes
    // skills, plugins, persona, surfaces, etc.) over the static default.
    // The aiProvider.systemPrompt is set by eventic-facade's updateSystemPrompt()
    // and loadConversation(), so it reflects the full dynamic context.
    this.systemPrompt = this.config.agent.systemPrompt;

    // Stats
    this.turnCount = 0;
    this.totalTokens = 0;

    // lmscript runtime components — populated via initRuntime()
    /** @type {import('@sschepis/lmscript').LScriptRuntime|null} */
    this._runtime = null;
    /** @type {import('./tool-bridge.mjs').ToolBridge|null} */
    this._toolBridge = null;
    /** @type {import('./cognitive-middleware.mjs').CognitiveMiddleware|null} */
    this._cognitiveMiddleware = null;
    /** @type {import('./eventbus-transport.mjs').EventBusTransport|null} */
    this._eventBusTransport = null;

    /** @type {Array<{name: string, trait: string}>|null} Per-turn cache of selected plugin traits */
    this._cachedSelectedTraits = null;

    /** @type {string|null} Cached static base of the system prompt */
    this._cachedSystemPromptBase = null;
    /** @type {string|null} Cache key for the static base */
    this._cachedSystemPromptBaseKey = null;

    /** @type {Map<string, {response: string, timestamp: number}>} Simple precheck cache */
    this._precheckCache = new Map();
    this._precheckCacheMaxSize = 50;
    this._precheckCacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  // ════════════════════════════════════════════════════════════════════
  // lmscript Runtime Initialisation
  // ════════════════════════════════════════════════════════════════════

  /**
   * Inject pre-built lmscript runtime components.
   * Called by CognitiveProvider after construction.
   */
  initRuntime(runtimeConfig = {}) {
    this._runtime = runtimeConfig.runtime || null;
    this._toolBridge = runtimeConfig.toolBridge || null;
    this._cognitiveMiddleware = runtimeConfig.cognitiveMiddleware || null;
    this._eventBusTransport = runtimeConfig.eventBusTransport || null;
  }

  // ════════════════════════════════════════════════════════════════════
  // Path safety
  // ════════════════════════════════════════════════════════════════════

  /** @private @static */
  static async _isPathSafe(targetPath, workingDir) {
    return isPathWithinRoot(targetPath, workingDir);
  }

  // ════════════════════════════════════════════════════════════════════
  // Sentient Core — thin wrappers delegating to agent-sentient.mjs
  // ════════════════════════════════════════════════════════════════════

  /** Initialize the SentientCognitiveCore. Delegates to agent-sentient.mjs. */
  async initSentientCore(options = {}) {
    return _initSentientCore(this, options);
  }

  /** @private */
  async _loadSentientState(sentientCore, sentientConfig, workingDir) {
    return _loadSentientState(this, sentientCore, sentientConfig, workingDir);
  }

  /** Save sentient state to disk. Delegates to agent-sentient.mjs. */
  async saveSentientState() {
    return _saveSentientState(this);
  }

  /** Check if the sentient observer core is active. */
  isSentientEnabled() {
    return this._sentientEnabled;
  }

  /** Check if the sentient observer core is pending initialization. */
  isSentientPending() {
    return this._sentientPending;
  }

  // ════════════════════════════════════════════════════════════════════
  // turn() — single-path lmscript implementation
  // ════════════════════════════════════════════════════════════════════

  /**
   * Process a single user turn via the lmscript executeAgent loop.
   *
   * @param {string} input - User message
   * @param {Object} options
   * @param {AbortSignal} [options.signal]
   * @param {string}      [options.model]
   * @param {number}      [options.maxIterations]
   * @param {number}      [options.temperature]
   * @returns {Promise<{response: string, toolResults: Array, thoughts: string|null, signature: string|null, diagnostics: Object, tokenUsage: Object|null}>}
   */
  async turn(input, options = {}) {
    // Clear per-turn caches
    this._cachedSelectedTraits = null;
    this._cachedToolDefs = null;
    this._cachedLmscriptTools = null;

    // ── StreamManager: create per-turn, auto-dispose on exit ─────────
    // If callers pass onToken/onChunk/signal, the StreamManager wraps them
    // so that callLLM (via agent-llm.mjs) can route through suppress/resume.
    this.streamManager = new StreamManager({
      onToken: options.onToken,
      onChunk: options.onChunk,
      signal: options.signal,
    });

    try {
      // ── Precheck: can the model answer directly? ───────────────────
      const precheckResult = await runPrecheck(this, input, options);
      if (precheckResult.outcome === 'direct') {
        this.turnCount++;
        this.cognitive.processInput(input);
        // ObjectivityGate: validation.R and validation.passed are captured for
        // diagnostics only. The response text is intentionally NOT modified —
        // appending a visible "[Note: ...]" was removed to avoid polluting
        // user-facing output. See diagnostics.objectivityR / objectivityPassed.
        const validation = this.cognitive.validateOutput(precheckResult.response, { input });
        const finalResponse = precheckResult.response;
  
        this.history.push({ role: 'user', content: input });
        this.history.push({ role: 'assistant', content: finalResponse });
        while (this.history.length > this.maxHistory) {
          this.history.shift();
        }
        this.cognitive.remember(input, finalResponse);
        for (let i = 0; i < 3; i++) this.cognitive.tick();
  
        return {
          response: finalResponse,
          toolResults: [],
          thoughts: null,
          signature: null,
          diagnostics: { ...this.cognitive.getDiagnostics(), precheck: true, cached: !!precheckResult.cached, objectivityR: validation.R, objectivityPassed: validation.passed },
          tokenUsage: null
        };
      } else if (precheckResult.outcome === 'cancelled') {
        return {
          response: '🛑 Task cancelled.',
          toolResults: [],
          thoughts: null,
          signature: null,
          diagnostics: {},
          tokenUsage: null
        };
      }
      // outcome === 'proceed' or 'skip' → continue to full pipeline
  
      // Hoist declarations so they are accessible in the catch block
      let violations = [];
      let preRouted = [];
      const collectedToolCalls = [];
      let lmscriptMaxIter = 6;
      let earlyExitController = null;
  
      try {
        this.turnCount++;
  
        // ── Steps 1-4: PERCEIVE / ENCODE / ORIENT / ATTEND ──────────
        emitCommentary(`🚀 Processing request: ${summarizeInput(input)}`);
        this._tracker.setActivity(`Analyzing your request: ${summarizeInput(input)}`);
        this.cognitive.processInput(input);
  
        // ── Step 5: GUARD — Safety check ─────────────────────────────
        violations = this.cognitive.checkSafety();
        if (violations.some(v => v.constraint?.response === 'block')) {
          emitStatus('⚠️ Safety check blocked — unsafe cognitive state detected');
          this._tracker.stop();
          return {
            response: 'I need to pause — my cognitive state indicates unsafe conditions. Please try rephrasing.',
            toolResults: [],
            thoughts: null,
            signature: null,
            diagnostics: { blocked: true, violations, ...this.cognitive.getDiagnostics() },
            tokenUsage: null
          };
        }
  
        // ── Step 6: RECALL — Pre-route + trait routing (concurrent) ──
        [preRouted, this._cachedSelectedTraits] = await Promise.all([
          this._preRoute(input, options),
          this._selectRelevantTraits(input),
        ]);
  
        // ── Build system prompt with cognitive context ────────────────
        emitStatus('Building context — selecting relevant plugins and memories');
        const systemPrompt = this._buildSystemPrompt(input, options, preRouted, violations);
  
        // ── Convert tools to lmscript format ─────────────────────────
        const lmscriptTools = this._getLmscriptTools();
  
        // ── Build the LScriptFunction for this turn ──────────────────
        const model = options.model || this.config.agent?.model || this.aiProvider?.model;
        if (!model) {
          throw new Error('CognitiveAgent: no model specified — set agent.model in config or pass options.model');
        }
        const agentFn = {
          name: 'cognitive-turn',
          model,
          system: systemPrompt,
          prompt: (userInput) => userInput,
          schema: AGENT_RESPONSE_SCHEMA,
          tools: lmscriptTools.length > 0 ? lmscriptTools : undefined,
          temperature: options.temperature ?? 0.7,
          maxRetries: 1,
        };
  
        // ── Step 7-8: THINK / EXECUTE via lmscript agent loop ────────
        lmscriptMaxIter = options.maxIterations
          || this.config.agent?.maxLmscriptIterations
          || 6;
  
        emitCommentary('🧠 Sending request to AI model — waiting for response…');
        this._tracker.setActivity('Sending request to AI model — waiting for response…', { phase: 'llm-call' });
  
        let lastIterationToolNames = [];
  
        // ── Empty-iteration early exit ──────────────────────────────────
        let consecutiveEmptyIterations = 0;
        const maxEmptyIterations = options.maxEmptyIterations
          || this.config.agent?.maxEmptyIterations
          || 2;
        earlyExitController = new AbortController();
        if (options.signal) {
          options.signal.addEventListener('abort', () => earlyExitController.abort(options.signal.reason), { once: true });
        }
  
        const result = await this._runtime.executeAgent(agentFn, input, {
          maxIterations: lmscriptMaxIter,
          signal: earlyExitController.signal,
          onToolCall: (toolCall) => {
            const desc = describeToolCall(toolCall.name, toolCall.args || toolCall.input);
            emitStatus(`AI called tool: ${desc}`);
            this._tracker.setActivity(`Executing: ${desc}`, { phase: 'tool-exec' });
            collectedToolCalls.push(toolCall);
            lastIterationToolNames.push(toolCall.name);
          },
          onIteration: (iteration) => {
            if (lastIterationToolNames.length > 0) {
              const narrative = buildToolRoundNarrative(
                lastIterationToolNames.map((name, i) => ({
                  name,
                  result: collectedToolCalls.slice(-lastIterationToolNames.length)[i]?.result
                }))
              );
              if (narrative) {
                emitCommentary(`🔧 Iteration ${iteration}: ${narrative} Sending results back to AI…`);
              }
              lastIterationToolNames = [];
              consecutiveEmptyIterations = 0;
            } else {
              consecutiveEmptyIterations++;
              emitCommentary(`🔄 AI analyzing results — iteration ${iteration} (empty: ${consecutiveEmptyIterations}/${maxEmptyIterations})`);
  
              if (consecutiveEmptyIterations >= maxEmptyIterations) {
                console.warn(
                  `[CognitiveAgent] ${consecutiveEmptyIterations} consecutive empty iterations — aborting to synthesize response`
                );
                emitCommentary(`⏱️ AI spinning without tool calls for ${consecutiveEmptyIterations} iterations — synthesizing response…`);
                earlyExitController.abort(EMPTY_ITERATION_ABORT_REASON);
              }
            }
            this._tracker.setActivity(`AI processing tool results — iteration ${iteration}`, { phase: 'llm-call' });
          },
        });
  
        let responseText = result.data?.response || '';
  
        // ── Continuation: detect intent-announcement responses ────────
        ({ responseText } = await runContinuationLoop(
          this, result, responseText, agentFn, input, lmscriptMaxIter, options
        ));
  
        // ── Step 9: VALIDATE through ObjectivityGate ─────────────────
        // ObjectivityGate: R-score and pass/fail are recorded in diagnostics.
        // The response is intentionally NOT modified — visible "[Note: ...]"
        // annotations were removed to keep user-facing output clean.
        emitStatus('Validating response quality');
        const validation = this.cognitive.validateOutput(responseText, { input });

        const finalResponse = responseText;
  
        // ── Update internal history ──────────────────────────────────
        this.history.push({ role: 'user', content: input });
        this.history.push({ role: 'assistant', content: finalResponse });
        while (this.history.length > this.maxHistory) {
          this.history.shift();
        }
  
        // ── Step 10: REMEMBER interaction ─────────────────────────────
        emitStatus('Storing interaction in memory');
        this.cognitive.remember(input, finalResponse);
  
        // ── Step 11: EVOLVE physics ──────────────────────────────────
        for (let i = 0; i < 3; i++) {
          this.cognitive.tick();
        }
  
        // ── Track token usage ────────────────────────────────────────
        if (result.usage) {
          this.totalTokens += result.usage.totalTokens || 0;
        }
  
        emitCommentary('✅ Response ready.');
        this._tracker.stop();
  
        return {
          response: finalResponse,
          toolResults: this._extractToolResults(result),
          thoughts: null,
          signature: null,
          diagnostics: { ...this.cognitive.getDiagnostics(), objectivityR: validation.R, objectivityPassed: validation.passed },
          tokenUsage: result.usage || null
        };
      } catch (err) {
        // ── Iteration-exhaustion recovery (extracted) ───────────────────
        if (isIterationExhaustion(err, earlyExitController) && collectedToolCalls.length > 0) {
          return recoverFromExhaustion(this, input, collectedToolCalls, lmscriptMaxIter, options);
        }
  
        // ── All other errors: propagate ────────────────────────────────
        throw err;
      }
    } finally {
      // Always dispose the per-turn StreamManager, even on error paths
      this.streamManager?.dispose();
      this.streamManager = null;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Thin wrappers delegating to extracted sub-modules
  // ════════════════════════════════════════════════════════════════════

  /** @private */
  _buildSystemPrompt(input, options = {}, preRouted = [], violations = []) {
    return buildSystemPrompt(this, input, options, preRouted, violations);
  }

  /** @private */
  _buildPluginTraitsBlock(selectedTraits) {
    return buildPluginTraitsBlock(this, selectedTraits);
  }

  /** @private */
  _summarizeHistory(maxChars, keepRecent = 4) {
    return summarizeHistory(this, maxChars, keepRecent);
  }

  /** @private */
  _truncateToolResult(result, maxChars) {
    return truncateToolResult(this, result, maxChars);
  }

  /** @private */
  async _selectRelevantTraits(userInput) {
    return selectRelevantTraits(this, userInput);
  }

  /** @private */
  _matchTraitsByKeyword(userInput, allTraits) {
    return matchTraitsByKeyword(this, userInput, allTraits);
  }

  /** @private */
  async _processToolCalls(messages, response, toolDefs, toolResults, toolRounds, options, llmCallCount = 0) {
    return processToolCalls(this, messages, response, toolDefs, toolResults, toolRounds, options, llmCallCount);
  }

  /** @private */
  _buildFallbackResponse(toolResults) {
    return _buildFallbackResponse(this, toolResults);
  }

  /** @private */
  _isIncompleteResponse(content) {
    return isIncompleteResponse(this, content);
  }

  /** @private — pure function, no agent state needed */
  _humanizeToolName(name) {
    return humanizeToolName(name);
  }

  /** @private — pure function, no agent state needed */
  _summarizeToolResult(toolName, result) {
    return summarizeToolResult(toolName, result);
  }

  /** @private */
  _extractToolResults(result) {
    return _extractToolResults(this, result);
  }

  /** @private */
  _getLmscriptTools() {
    return _getLmscriptTools(this);
  }

  /** @private */
  _getSentientToolMetadata() {
    return _getSentientToolMetadata();
  }

  /** @private */
  _executeSentientTool(name, args = {}) {
    return _executeSentientTool(this, name, args);
  }

  /** @private */
  async _executeTool(name, args) {
    return _executeTool(this, name, args);
  }

  /** @private @static */
  static _isLikelyFilePath(str) {
    return isLikelyFilePath(str);
  }

  /** @private */
  async _preRoute(input, options = {}) {
    return _preRoute(this, input, options);
  }

  /** @private */
  _getToolDefinitions() {
    return getToolDefinitions(this);
  }

  /** @private */
  async _callLLM(messages, tools, options = {}) {
    return callLLM(this, messages, tools, options);
  }

  /**
   * Public LLM call interface for external consumers (e.g. task planner).
   * Delegates to the internal _callLLM implementation.
   *
   * ⚠️ WARNING: This method bypasses cognitive safety checks, memory recall,
   * perception, and validation phases. It should only be used for internal
   * orchestration (e.g., task planner utility calls) — never for user-facing
   * agent turns. Use turn() for full cognitive processing.
   */
  async callLLM(messages, tools, options = {}) {
    return this._callLLM(messages, tools, options);
  }

  /** @private */
  _shouldSkipPrecheck(input) {
    return shouldSkipPrecheck(this, input);
  }

  /** @private */
  _getPrecheckCached(input) {
    return getPrecheckCached(this, input);
  }

  /** @private */
  _setPrecheckCached(input, response) {
    return setPrecheckCached(this, input, response);
  }

  // ════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ════════════════════════════════════════════════════════════════════

  /**
   * Stop the activity heartbeat tracker.
   */
  stopTracking() {
    this._tracker.stop();
  }

  /**
   * Get agent statistics.
   */
  getStats() {
    return {
      turnCount: this.turnCount,
      totalTokens: this.totalTokens,
      historyLength: this.history.length,
      cognitive: this.cognitive.getDiagnostics(),
      runtimeActive: !!this._runtime
    };
  }

  /**
   * Reset all agent state.
   */
  reset() {
    this._tracker.stop();
    this.history = [];
    this.turnCount = 0;
    this.totalTokens = 0;
    this._cachedSelectedTraits = null;
    this._cachedSystemPromptBase = null;
    this._cachedSystemPromptBaseKey = null;
    this._precheckCache.clear();
    this.cognitive.reset();
  }

  /**
   * Dispose of the agent and release all resources.
   */
  dispose() {
    this.reset();
    this._runtime = null;
    this._toolBridge = null;
    this._cognitiveMiddleware = null;
    this._eventBusTransport = null;
  }
}

export { CognitiveAgent };
export default CognitiveAgent;
