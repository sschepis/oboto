/**
 * AgentLoop — core ReAct agent loop for the UnifiedProvider.
 *
 * This is the HEART of the unified provider.  It orchestrates the
 * think-act cycle:  classify intent → safety check → cognitive process →
 * optional precheck → build context → iterate (LLM call → tool exec) →
 * validate → remember → learn.
 *
 * Uses `aiProvider.ask()` (the EventicAIProvider pattern) for LLM calls
 * rather than lmscript's executeAgent, giving us native streaming and
 * tool-call support compatible with the ai-man infrastructure.
 *
 * @module src/core/agentic/unified/agent-loop
 */

import { classifyIntent } from './intent-router.mjs';
import {
  buildSystemPrompt,
  buildContinuationPrompt,
  buildTurnPrompt,
  selectRelevantTraits,
} from './prompt-builder.mjs';
import { summarizeInput } from './stream-controller.mjs';
import { isIncompleteResponse } from '../response-patterns.mjs';
import {
  evaluateTextResponse,
  PROCEED_SENTINEL,
  PRECHECK_PROMPT,
  purgeTransientMessages,
  patchOrphanedToolCalls,
} from '../../agent-loop-helpers.mjs';
import { isCancellationError } from '../../ai-provider.mjs';
import { getModelInfo } from '../../model-registry.mjs';
import { createSourceArtifact } from '../../confidentiality/models.mjs';

// ════════════════════════════════════════════════════════════════════════
// AgentLoop Class
// ════════════════════════════════════════════════════════════════════════

/**
 * Core ReAct agent loop that drives the unified provider's think-act cycle.
 *
 * The loop follows a clean, linear flow:
 *   1. Entry & intent classification
 *   2. Safety check
 *   3. Cognitive processing
 *   4. Learning consultation
 *   5. Optional precheck fast-path
 *   6. Context building
 *   7. Think-act iteration loop
 *   8. Output validation
 *   9. Memory & learning recording
 *  10. Return result
 */
export class AgentLoop {
  /**
   * @param {Object} deps — subsystem instances wired by UnifiedProvider
   * @param {Object}  deps.config           — resolved unified config
   * @param {import('./stream-controller.mjs').StreamController} deps.streamController
   * @param {import('./tool-executor-bridge.mjs').ToolExecutorBridge} deps.toolBridge
   * @param {import('./context-manager.mjs').ContextManager} deps.contextManager
   * @param {import('./cognitive-layer.mjs').CognitiveLayer} deps.cognitiveLayer
   * @param {import('./safety-layer.mjs').SafetyLayer} deps.safetyLayer
   * @param {import('./memory-system.mjs').MemorySystem} deps.memorySystem
   * @param {import('./learning-engine.mjs').LearningEngine} deps.learningEngine
   * @param {Object}  deps.aiProvider       — EventicAIProvider instance
   * @param {import('../../support-llm.mjs').SupportLLM} [deps.supportLlm] — invisible local LLM
   */
  constructor({
    config,
    streamController,
    toolBridge,
    contextManager,
    cognitiveLayer,
    safetyLayer,
    memorySystem,
    learningEngine,
    aiProvider,
    supportLlm,
  }) {
    /** @private */ this._config = config;
    /** @private */ this._stream = streamController;
    /** @private */ this._toolBridge = toolBridge;
    /** @private */ this._contextManager = contextManager;
    /** @private */ this._cognitive = cognitiveLayer;
    /** @private */ this._safety = safetyLayer;
    /** @private */ this._memory = memorySystem;
    /** @private */ this._learning = learningEngine;
    /** @private */ this._ai = aiProvider;
    /** @private */ this._supportLlm = supportLlm || null;
  }

  // ════════════════════════════════════════════════════════════════════
  // Public API
  // ════════════════════════════════════════════════════════════════════

  /**
   * Replace the stream controller for a new turn.
   * @param {import('./stream-controller.mjs').StreamController} stream
   */
  setStreamController(stream) {
    this._stream = stream;
  }

  /**
   * Set the full confidentiality context in one call.
   *
   * Consolidates view compilation, clearance checks, sensitivity tagging,
   * lineage tracking, and local LLM pre-flight into a single setter so
   * callers don't need to coordinate multiple individual calls.
   *
   * When the lineage tracker is set, the agent loop records lineage at
   * three points:
   *   A. Input recording   — user input as 'original'
   *   B. Tool result recording — each tool result as 'tool-result'
   *   C. LLM output recording — final response as 'llm-derived'
   *
   * @param {Object} ctx
   * @param {import('../../confidentiality/view-compiler.mjs').ViewCompiler|null} [ctx.viewCompiler]
   * @param {import('../../confidentiality/models.mjs').AgentProfile|null} [ctx.agentProfile]
   * @param {import('../../confidentiality/sensitivity-tagger.mjs').SensitivityTagger|null} [ctx.sensitivityTagger]
   * @param {import('../../confidentiality/lineage-tracker.mjs').LineageTracker|null} [ctx.lineageTracker]
   * @param {import('../../support-llm.mjs').SupportLLM|null} [ctx.supportLlm]
   */
  setConfidentialityContext({ viewCompiler, agentProfile, sensitivityTagger, lineageTracker, supportLlm } = {}) {
    this._viewCompiler = viewCompiler || null;
    this._agentProfile = agentProfile || null;
    this._sensitivityTagger = sensitivityTagger || null;
    this._lineageTracker = lineageTracker || null;
    this._supportLlm = supportLlm || null;
  }

  /**
   * Process a single user turn through the full ReAct loop.
   *
   * @param {string} input — user message text
   * @param {Object} options
   * @param {AbortSignal}  [options.signal]        — abort signal
   * @param {string}       [options.model]         — model override
   * @param {boolean}      [options.stream]        — enable streaming
   * @param {Function}     [options.onChunk]       — chunk callback
   * @param {Function}     [options.onToken]       — token callback
   * @param {number}       [options.maxIterations] — per-turn iteration cap override
   * @param {number}       [options.temperature]   — temperature override
   * @returns {Promise<{ response: string, toolResults: Array, diagnostics: Object, tokenUsage: Object|null }>}
   */
  async run(input, options = {}) {
    const startTime = Date.now();
    const {
      signal,
      model,
      stream: streamEnabled,
      onChunk,
      onToken,
      maxIterations: maxIterOverride,
      temperature,
    } = options;

    const loopCfg = this._config.loop || {};
    const maxIterations = maxIterOverride || loopCfg.maxIterations || 25;
    const maxContinuations = loopCfg.maxContinuations || 5;
    const maxTotalLLMCalls = loopCfg.maxTotalLLMCalls || 50;
    const maxEmptyIterations = loopCfg.maxEmptyIterations || 4;

    // Cost guard — optional per-turn spend ceiling
    const costGuardCfg = this._config.costGuard || {};
    const costGuardEnabled = costGuardCfg.enabled === true && costGuardCfg.maxCostPerTurn > 0;
    const maxCostPerTurn = costGuardCfg.maxCostPerTurn || 0.50;

    // ── Per-turn counters ──────────────────────────────────────────
    let turnNumber = 0;
    let toolCallCount = 0;
    let llmCallCount = 0;
    let emptyIterations = 0;
    let incompleteRetryCount = 0;
    let retryCount = 0;
    let allToolResults = [];
    let precheckUsed = false;
    let doomDetected = false;
    const toolsUsedNames = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    const accumulateUsage = (usage) => {
      if (!usage) return;
      totalPromptTokens += usage.prompt_tokens || usage.promptTokens || 0;
      totalCompletionTokens += usage.completion_tokens || usage.completionTokens || 0;
      const total = usage.total_tokens || usage.totalTokens
        || (usage.prompt_tokens || usage.promptTokens || 0) + (usage.completion_tokens || usage.completionTokens || 0);
      if (total > 0) {
        this._stream?.addTokens(total);
      }
    };

    // ── Surface pipeline escalation tracking ────────────────────────
    const MAX_SURFACE_RETRIES = 3;
    let surfaceFailureCount = 0;

    // ── Clear per-turn state ───────────────────────────────────────
    this._toolBridge.clearDirectMarkdownBlocks();
    this._safety.reset();

    // ════════════════════════════════════════════════════════════════
    // PHASE 1: ENTRY
    // ════════════════════════════════════════════════════════════════

    this._stream.phaseStart('request', `Processing: ${summarizeInput(input)}`);

    // ── Lineage Hook A: Record input artifact ─────────────────────
    // Wrap the user input as a SourceArtifact and record its lineage
    // as derivationType: 'original'.  The inputArtifactId is threaded
    // through the turn so tool results and LLM output can reference it.
    let _inputArtifactId = null;
    /** @type {string[]} Accumulates artifact IDs fed into the prompt for lineage tracking */
    const _promptArtifactIds = [];
    if (this._lineageTracker && this._sensitivityTagger) {
      try {
        const inputSensitivity = this._sensitivityTagger.classify(input, 'user-input');
        const inputArtifact = createSourceArtifact({
          content: input,
          type: 'user-input',
          sensitivity: inputSensitivity,
          lineage: { derivationType: 'original', parentIds: [] },
        });
        this._lineageTracker.record(inputArtifact);
        _inputArtifactId = inputArtifact.id;
        _promptArtifactIds.push(inputArtifact.id);
      } catch (err) {
        // Non-critical — proceed without lineage recording
        this._stream?.commentary('⚠️', 'Lineage recording skipped: ' + err.message);
      }
    }

    // ════════════════════════════════════════════════════════════════
    // PHASE 2: INTENT CLASSIFICATION
    // ════════════════════════════════════════════════════════════════

    // Use per-conversation history passed from the caller (ConversationContext),
    // falling back to the AI provider's singleton for backward compatibility.
    const history = options.conversationHistory || this._ai?.conversationHistory || [];
    const intent = classifyIntent(input, history);

    // ════════════════════════════════════════════════════════════════
    // PHASE 3: SAFETY CHECK
    // ════════════════════════════════════════════════════════════════

    const safetyResult = this._safety.checkSafety(input);
    if (safetyResult.shouldBlock) {
      this._stream.phaseStart('error', 'Safety check blocked request');
      const blockMsg =
        '⚠️ Request blocked by safety constraints: ' +
        safetyResult.violations.map((v) => v.constraint?.name || v.name || 'Unknown').join(', ');
      this._stream.complete();
      return {
        response: blockMsg,
        toolResults: [],
        diagnostics: { blocked: true, violations: safetyResult.violations },
        tokenUsage: null,
      };
    }

    // ════════════════════════════════════════════════════════════════
    // PHASE 4: COGNITIVE PROCESSING
    // ════════════════════════════════════════════════════════════════

    const cognitiveContext = this._cognitive.processInput(input);

    // ════════════════════════════════════════════════════════════════
    // PHASE 5: LEARNING CONSULTATION
    // ════════════════════════════════════════════════════════════════

    const learningSuggestion = this._learning.suggestStrategy(input, intent.type);

    // ════════════════════════════════════════════════════════════════
    // PHASE 6: PRECHECK (direct-answer fast-path)
    // ════════════════════════════════════════════════════════════════

    const precheckEnabled = this._config.precheck?.enabled !== false;
    const shouldPrecheck =
      precheckEnabled &&
      !this._learning.shouldSkipPrecheck(input, history) &&
      !intent.isSurfaceUpdate &&
      !intent.isFollowUp &&
      (intent.type === 'direct' || intent.type === 'question');

    if (shouldPrecheck) {
      if (this._isAborted(signal)) {
        return this._cancelledResult();
      }

      this._stream.phaseStart('precheck', `Checking if direct answer is possible: ${summarizeInput(input)}`);
      precheckUsed = true;

      try {
        let precheckInput = PRECHECK_PROMPT + `\n\nInput: ${input}`;

        // Persona hint from system prompt
        if (this._ai?.systemPrompt) {
          const personaHint = this._ai.systemPrompt.substring(0, 200);
          if (/persona|you are|your name/i.test(personaHint)) {
            precheckInput = 'Remember your persona identity as described in your system prompt. ' + precheckInput;
          }
        }

        const preCheckResponse = await this._ai.ask(precheckInput, {
          system: 'Determine whether the request can be answered directly without tools. Preserve persona only if the user input explicitly depends on it.',
          recordHistory: false,
          includeMetadata: true,
          model,
          stream: streamEnabled,
          onChunk,
        });
        llmCallCount++;
        accumulateUsage(preCheckResponse?.usage);

        const responseText = (
          typeof preCheckResponse === 'string'
            ? preCheckResponse
            : preCheckResponse?.content || ''
        ).trim();

        if (responseText && !responseText.includes(PROCEED_SENTINEL)) {
          const { action } = evaluateTextResponse(responseText, input, 0);
          if (action !== 'retry') {
            this._stream.commentary('✅', 'Answered directly — no tools needed.');
            this._stream.complete();

            // Record learning outcome
            this._learning.recordTurnOutcome({
              input,
              response: responseText,
              toolsUsed: [],
              success: true,
              duration: Date.now() - startTime,
              iterations: 0,
              precheckUsed: true,
              tokenUsage: this._buildTurnTokenUsage(totalPromptTokens, totalCompletionTokens, model),
            });

            return {
              response: responseText,
              toolResults: [],
              diagnostics: { precheck: true, intent },
              tokenUsage: this._buildTurnTokenUsage(totalPromptTokens, totalCompletionTokens, model),
            };
          }
          this._stream.commentary('🔄', "Direct answer didn't meet quality bar — entering agent loop.");
        } else {
          this._stream.commentary('🧠', 'This requires tools and deeper reasoning — entering agent loop.');
        }
      } catch (err) {
        if (isCancellationError(err) || this._isAborted(signal)) {
          return this._cancelledResult();
        }
        // Precheck failed — fall through to full loop
        this._stream.commentary('⚠️', `Precheck skipped: ${err.message}`);
      }
    }

    // ════════════════════════════════════════════════════════════════
    // PHASE 6.5: VIEW COMPILATION (Confidentiality)
    // ════════════════════════════════════════════════════════════════
    // When the confidentiality subsystem is active, compile history
    // entries through the ViewCompiler before they're used in context
    // building. This ensures the LLM never sees content above the
    // agent's clearance level.

    let compiledHistory = history;
    if (this._viewCompiler && this._agentProfile) {
      try {
        compiledHistory = this._viewCompiler.compileHistory(
          history,
          this._agentProfile,
        );
      } catch (err) {
        // Non-critical — fall through with uncompiled history
        this._stream?.commentary('⚠️', `View compilation skipped: ${err.message}`);
      }
    }

    // ════════════════════════════════════════════════════════════════
    // PHASE 7: CONTEXT BUILDING
    // ════════════════════════════════════════════════════════════════

    if (this._isAborted(signal)) {
      return this._cancelledResult();
    }

    this._stream.phaseStart('planning', 'Building context and preparing tools…');

    // Get available tools
    const tools = this._toolBridge.getAvailableTools();
    const toolNames = tools.map((t) => (t.function || t).name);

    // Wrap everything from here through the return in try/finally so that
    // transient system messages injected into conversationHistory are always
    // purged — even if the turn throws before reaching the normal cleanup path.
    try {

    // Pre-route files & surfaces (pass sensitivityTagger for Phase 2 annotation)
    const engineTools = this._toolBridge.getToolMap();
    const { fileContext, surfaceContext } = await this._contextManager.preRoute(
      input,
      engineTools,
      this._sensitivityTagger || undefined,
    );

    // ── Compile pre-routed file content through ViewCompiler ───────
    let compiledFileContext = fileContext;
    if (fileContext && fileContext.length > 0 && this._viewCompiler && this._agentProfile) {
      try {
        compiledFileContext = this._viewCompiler.compileFileResults(
          fileContext,
          this._agentProfile,
        );
      } catch (err) {
        // Non-critical — fall through with uncompiled files
        this._stream?.commentary('⚠️', `File view compilation skipped: ${err.message}`);
      }
    }

    // Inject pre-routed file context into conversation history
    // Use the resolved `history` (per-conversation or singleton) so context
    // is visible in the same array that ask() reads from.
    if (compiledFileContext && compiledFileContext.length > 0 && history) {
      const fileBlock = compiledFileContext
        .map((r) => {
          if (r.content) return `[FILE CONTENT: ${r.path}]\n\`\`\`\n${r.content}\n\`\`\``;
          if (r.error) return `[FILE ERROR: ${r.path}]: ${r.error}`;
          return '';
        })
        .filter(Boolean)
        .join('\n\n');

      if (fileBlock) {
        history.push({
          role: 'system',
          content: `The following files were automatically retrieved based on the user's request.\n\n${fileBlock}`,
          _transient: true,
        });
        this._stream.commentary('📂', `Pre-fetched ${fileContext.length} file(s)`);
      }
    }

    // Inject surface context
    if (surfaceContext && history) {
      history.push({
        role: 'system',
        content: surfaceContext,
        _transient: true,
      });
      this._stream.commentary('🎨', 'Surface update detected — pre-fetched surface data');
    }

    // Select relevant plugin traits (if available)
    // selectRelevantTraits expects an array of {name, trait} objects —
    // we pull them from the engine's plugin registry if available.
    let selectedTraits = null;
    if (this._config.routing?.traitRoutingEnabled) {
      try {
        const allTraits = this._ai?.pluginTraits || [];
        selectedTraits = selectRelevantTraits(input, allTraits, this._config);
      } catch {
        // Non-critical — proceed without trait routing
      }
    }

    // Build system prompt with all context
    const systemPrompt = buildSystemPrompt({
      input,
      config: this._config,
      systemPrompt: this._ai?.systemPrompt,
      cognitiveContext,
      selectedTraits,
      violations: safetyResult.violations,
      taskContext: this._toolBridge.taskContext,
      isSurfaceUpdate: intent.isSurfaceUpdate,
      toolNames,
      viewCompiler: this._viewCompiler || undefined,
      agentProfile: this._agentProfile || undefined,
    });

    // ════════════════════════════════════════════════════════════════
    // PHASE 8: THINK-ACT LOOP
    // ════════════════════════════════════════════════════════════════

    this._stream.phaseStart('thinking', `Turn 1/${maxIterations}: Analyzing request — ${summarizeInput(input)}`);

    // Build the first user prompt
    let currentPrompt = buildTurnPrompt({
      input,
      turnNumber: 1,
      maxTurns: maxIterations,
      taskContext: this._toolBridge.taskContext,
      isSurfaceUpdate: intent.isSurfaceUpdate,
      originalInput: input,
      learningSuggestion: learningSuggestion?.suggestion,
    });

    let finalResponse = '';

    // ── Phase-level timing diagnostics ─────────────────────────────
    const timing = { llmCallMs: 0, toolExecutionMs: 0, otherMs: 0 };

    // ── Main iteration loop ────────────────────────────────────────
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      // ── Abort check ──────────────────────────────────────────────
      if (this._isAborted(signal)) {
        return this._cancelledResult();
      }

      // ── LLM call budget check ────────────────────────────────────
      if (llmCallCount >= maxTotalLLMCalls) {
        this._stream.commentary('🚨', `LLM call limit reached (${maxTotalLLMCalls}). Synthesizing response.`);
        finalResponse = this._synthesizeFallbackResponse(allToolResults);
        break;
      }

      // ── Cost guard check ──────────────────────────────────────────
      if (costGuardEnabled) {
        const estimatedCost = (this._stream.metrics?.cost ?? 0);
        if (estimatedCost >= maxCostPerTurn) {
          this._stream.commentary('💰', `Cost ceiling reached ($${estimatedCost.toFixed(4)} ≥ $${maxCostPerTurn.toFixed(2)}). Synthesizing response.`);
          finalResponse = this._synthesizeFallbackResponse(allToolResults);
          break;
        }
      }

      turnNumber = iteration;

      // ── Emit iteration status ────────────────────────────────────
      if (iteration > 1) {
        this._stream.iterationUpdate(
          iteration,
          allToolResults.length > 0,
          emptyIterations,
          maxEmptyIterations,
        );
      }

      // ── LLM call ─────────────────────────────────────────────────
      let response;
      try {
        this._stream.setActivity('Sending request to AI model', 'llm-call');
        const llmStart = Date.now();
        response = await this._ai.ask(currentPrompt, {
          system: systemPrompt,
          tools,
          signal,
          stream: streamEnabled,
          onChunk,
          model,
          includeMetadata: true,
          conversationHistory: history,
        });
        timing.llmCallMs += Date.now() - llmStart;
        llmCallCount++;
        accumulateUsage(response?.usage);
      } catch (err) {
        if (isCancellationError(err) || this._isAborted(signal)) {
          return this._cancelledResult();
        }
        this._stream.phaseStart('error', `AI call failed: ${err.message}`);

        // Retry up to 3 times on AI errors
        if (retryCount < 3) {
          retryCount++;
          this._stream.commentary('🔄', `Retrying AI call (attempt ${retryCount})…`);
          continue;
        }

        finalResponse = `Error: AI provider failed after ${retryCount} attempts — ${err.message}`;
        break;
      }

      // ── Branch: tool calls ───────────────────────────────────────
      const toolCalls = response?.toolCalls;
      if (toolCalls && toolCalls.length > 0) {
        // Forward AI text that accompanies tool calls
        const aiText = typeof response === 'string' ? '' : (response.content || '');
        if (aiText.trim()) {
          this._stream.aiTextReceived(aiText);
        }

        this._stream.phaseStart('tools', `Executing ${toolCalls.length} tool(s)…`);

        // Execute tool batch
        const toolStart = Date.now();
        const turnId = `turn-${iteration}`;
        const { results, hasErrors } = await this._toolBridge.executeToolBatch(
          toolCalls,
          { signal, turnId },
        );
        timing.toolExecutionMs += Date.now() - toolStart;

        toolCallCount += toolCalls.length;
        allToolResults.push(...results);

        // Collect tool names for learning
        for (const tc of toolCalls) {
          toolsUsedNames.push(tc.function.name);
        }

        // Reset empty iteration counter — we had tool activity
        emptyIterations = 0;

        // ── Doom check ─────────────────────────────────────────────
        // Transform tool results to the shape checkDoom expects:
        // { toolName, args, result }
        const doomInputs = toolCalls.map((tc, idx) => ({
          toolName: tc.function.name,
          args: typeof tc.function.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function.arguments),
          result: results[idx]?.content || '',
        }));
        const doomResult = this._safety.checkDoom(
          history,
          doomInputs,
          iteration,
          maxIterations,
        );
        if (doomResult.doomed) {
          doomDetected = true;
          this._stream.phaseStart('doom', `Doom loop detected: ${doomResult.reason}`);
          finalResponse = this._synthesizeFallbackResponse(allToolResults);
          break;
        }

        // ── Push tool results into conversation history ─────────────
        // Same pattern as eventic-agent-loop-plugin.mjs:
        // The AI provider's ask() automatically pushes the assistant
        // message (with tool_calls) into `history` and we push tool
        // results into the same array so tool_use/tool_result pairs
        // stay together.  Previously pushed to the singleton
        // this._ai.conversationHistory which diverged from `history`
        // when per-conversation history was active, causing orphaned
        // tool_use blocks and Anthropic API 400 errors.
        if (history) {
          for (const result of results) {
            history.push(result);
          }
        }

        // ── Lineage Hook B: Record tool-result artifacts ────────────
        // Each tool result is wrapped as a SourceArtifact with
        // derivationType: 'tool-result' and parent = input artifact.
        if (this._lineageTracker && this._sensitivityTagger) {
          try {
            for (const result of results) {
              const content = result?.content || '';
              const toolSensitivity = this._sensitivityTagger.classify(content, 'tool-result');
              const toolArtifact = createSourceArtifact({
                content,
                type: 'tool-result',
                turnId: `turn-${iteration}`,
                sensitivity: toolSensitivity,
                lineage: {
                  derivationType: 'tool-result',
                  parentIds: _inputArtifactId ? [_inputArtifactId] : [],
                  turnId: `turn-${iteration}`,
                },
              });
              this._lineageTracker.record(toolArtifact);
              _promptArtifactIds.push(toolArtifact.id);
            }
          } catch (err) {
            // Non-critical — proceed without lineage recording
            this._stream?.commentary('⚠️', 'Lineage recording skipped: ' + err.message);
          }
        }

        // ── Evaluate tool results for guidance ─────────────────────
        const toolResultNames = results.map((r) => r.name);
        const guidance = this._toolBridge.evaluateToolResults(
          toolResultNames,
          results,
          { turnNumber: iteration, maxTurns: maxIterations },
        );

        // ── Surface failure escalation ─────────────────────────────
        // Detect consecutive surface pipeline failures and escalate
        // to the user after MAX_SURFACE_RETRIES rather than letting
        // the agent loop endlessly with broken surfaces.
        const surfaceFailures = results.filter(
          (r) => r._isSurfaceMutation && !r._surfaceSuccess,
        );
        if (surfaceFailures.length > 0) {
          surfaceFailureCount += surfaceFailures.length;
          if (surfaceFailureCount >= MAX_SURFACE_RETRIES) {
            this._stream.commentary(
              '🚨',
              `Surface pipeline failed ${surfaceFailureCount} times — escalating to user`,
            );
            finalResponse = this._buildSurfaceEscalation(surfaceFailures, surfaceFailureCount);
            break;
          }
          this._stream.commentary(
            '⚠️',
            `Surface mutation failed (${surfaceFailureCount}/${MAX_SURFACE_RETRIES} before escalation)`,
          );
        } else if (intent.isSurfaceUpdate) {
          // Reset on successful surface tool execution
          const surfaceSuccesses = results.filter(
            (r) => r._isSurfaceMutation && r._surfaceSuccess,
          );
          if (surfaceSuccesses.length > 0) {
            surfaceFailureCount = 0;
          }
        }

        // Build next prompt
        currentPrompt = buildTurnPrompt({
          input,
          turnNumber: iteration + 1,
          maxTurns: maxIterations,
          taskContext: this._toolBridge.taskContext,
          isSurfaceUpdate: intent.isSurfaceUpdate,
          originalInput: input,
          guidance,
        });

        continue;
      }

      // ── Branch: text response ────────────────────────────────────
      let content = typeof response === 'string' ? response : response?.content;
      if (content) {
        // ── Incomplete response detection ──────────────────────────
        if (isIncompleteResponse(content) && incompleteRetryCount < 3) {
          incompleteRetryCount++;
          this._stream.commentary(
            '🤖',
            `AI announced intent without acting — nudging to take action (retry ${incompleteRetryCount})`,
          );

          // Remove poisoned assistant + user messages from history
          // (same pattern as eventic-agent-loop-plugin.mjs lines 410-421)
          // Pop from the resolved `history` (not the singleton) so
          // the poisoned messages are removed from the array that
          // ask() will read on the next iteration.
          if (history && history.length > 0) {
            if (history[history.length - 1].role === 'assistant') {
              history.pop();
            }
            if (history.length > 0 && history[history.length - 1].role === 'user') {
              history.pop();
            }
          }

          // Nudge with continuation prompt
          currentPrompt = buildContinuationPrompt({
            responseText: content,
            priorToolCalls: allToolResults,
            continuation: incompleteRetryCount,
            maxContinuations,
          });
          continue;
        }

        // ── Quality evaluation ─────────────────────────────────────
        const { action, guidance: retryGuidance } = evaluateTextResponse(
          content,
          input,
          retryCount,
        );

        if (action === 'retry' && retryCount < 2) {
          retryCount++;
          this._stream.commentary('🔄', `Quality check: ${retryGuidance}`);

          currentPrompt = `[GUIDANCE]: [QUALITY CHECK FAILED]: ${retryGuidance}\nPlease try again with the above guidance.\n\n${input}`;
          continue;
        }

        // ── Pre-flight lint via SupportLLM ──────────────────────────
        // If the SupportLLM is available, run a fast local lint check
        // on any code blocks in the response. If fixable errors are
        // found, silently replace the code with the fixed version.
        // This is invisible to the user — they just receive cleaner output.
        if (this._supportLlm?.isAvailable()) {
          content = await this._preflightLint(content);
        }

        // ── Accept the response ────────────────────────────────────
        finalResponse = content;
        break;
      }

      // ── Empty response (no tool calls, no content) ───────────────
      if (this._isAborted(signal)) {
        return this._cancelledResult();
      }
      emptyIterations++;
      this._stream.commentary(
        '🔄',
        `Empty response from AI — empty iteration ${emptyIterations}/${maxEmptyIterations}`,
      );

      if (emptyIterations >= maxEmptyIterations) {
        this._stream.commentary('🚨', 'Too many empty iterations. Synthesizing response.');
        finalResponse = this._synthesizeFallbackResponse(allToolResults);
        break;
      }

      // Retry with a nudge
      currentPrompt = `You provided an empty response. Please respond to the user's request or use tools to accomplish it.\n\nOriginal request: ${input}`;
    }

    // ── If loop exhausted without breaking ─────────────────────────
    if (!finalResponse) {
      finalResponse = this._synthesizeFallbackResponse(allToolResults);
    }

    // ════════════════════════════════════════════════════════════════
    // PHASE 9: VALIDATE OUTPUT
    // ════════════════════════════════════════════════════════════════

    const validation = this._cognitive.validateOutput(finalResponse, {
      input,
      intent,
      cognitiveContext,
    });
    if (validation && !validation.passed) {
      this._stream.commentary(
        '⚠️',
        `ObjectivityGate: R=${validation.R?.toFixed(2)} — ${validation.reason || 'suboptimal response'}`,
      );
    }

    // ── Lineage Hook C: Record LLM output artifact ──────────────────
    // The LLM response is wrapped as a SourceArtifact with
    // derivationType: 'llm-derived' and parents = all artifacts that
    // were in the compiled prompt view (input + tool results).
    // The inherited sensitivity is the ceiling of all parents.
    if (this._lineageTracker && this._sensitivityTagger && finalResponse) {
      try {
        const outputSensitivity = this._sensitivityTagger.classify(finalResponse, 'agent-output');
        const outputArtifact = createSourceArtifact({
          content: finalResponse,
          type: 'agent-output',
          sensitivity: outputSensitivity,
          lineage: {
            derivationType: 'llm-derived',
            parentIds: [..._promptArtifactIds],
          },
        });
        this._lineageTracker.record(outputArtifact);
      } catch (err) {
        // Non-critical — proceed without lineage recording
        this._stream?.commentary('⚠️', 'Lineage recording skipped: ' + err.message);
      }
    }

    // ════════════════════════════════════════════════════════════════
    // PHASE 10: REMEMBER
    // ════════════════════════════════════════════════════════════════

    this._stream.phaseStart('memory', 'Storing interaction in memory…');
    this._memory.storeInteraction({
      input,
      response: finalResponse,
      toolsUsed: toolsUsedNames,
      success: !doomDetected && !!finalResponse,
      timestamp: Date.now(),
      duration: Date.now() - startTime,
    });

    // ════════════════════════════════════════════════════════════════
    // PHASE 11: COGNITIVE EVOLVE
    // ════════════════════════════════════════════════════════════════

    this._cognitive.tick(this._config.cognitive?.physicsTickCount || 3);

    // ════════════════════════════════════════════════════════════════
    // PHASE 12: COST COMPUTATION & LEARNING RECORD
    // ════════════════════════════════════════════════════════════════

    // Compute per-turn cost from token counts and model pricing
    let turnCost = 0;
    if (totalPromptTokens > 0 || totalCompletionTokens > 0) {
      const modelInfo = model ? getModelInfo(model) : null;
      const inputRate = modelInfo?.inputCostPerMillion ?? 3.0;    // default to sonnet pricing
      const outputRate = modelInfo?.outputCostPerMillion ?? 15.0;
      turnCost =
        (totalPromptTokens / 1_000_000) * inputRate +
        (totalCompletionTokens / 1_000_000) * outputRate;
    }

    const turnTokenUsage = this._buildTurnTokenUsage(
      totalPromptTokens,
      totalCompletionTokens,
      model,
      turnCost,
    );

    this._learning.recordTurnOutcome({
      input,
      response: finalResponse,
      toolsUsed: toolsUsedNames,
      success: !doomDetected && !!finalResponse,
      duration: Date.now() - startTime,
      iterations: turnNumber,
      continuations: incompleteRetryCount,
      doomDetected,
      precheckUsed,
      tokenUsage: turnTokenUsage,
    });

    // ════════════════════════════════════════════════════════════════
    // PHASE 13: COST REPORT
    // ════════════════════════════════════════════════════════════════

    const metrics = this._stream.metrics;
    this._stream.costUpdate(
      turnCost,
      this._learning.totalCost || 0,
      0,  // tokens already accumulated in _turnMetrics during LLM calls
    );

    // ── Append __directMarkdown blocks ─────────────────────────────
    const directMarkdownBlocks = this._toolBridge.directMarkdownBlocks;
    if (directMarkdownBlocks.length > 0) {
      finalResponse = finalResponse + '\n\n' + directMarkdownBlocks.join('\n\n');
    }

    // ── Complete ───────────────────────────────────────────────────
    this._stream.complete();

    const totalDuration = Date.now() - startTime;
    timing.otherMs = totalDuration - timing.llmCallMs - timing.toolExecutionMs;

    return {
      response: finalResponse,
      toolResults: allToolResults,
      diagnostics: {
        intent,
        iterations: turnNumber,
        llmCalls: llmCallCount,
        toolCalls: toolCallCount,
        emptyIterations,
        incompleteRetries: incompleteRetryCount,
        qualityRetries: retryCount,
        doomDetected,
        precheckUsed,
        validation,
        learningSuggestion,
        duration: totalDuration,
        timing,
      },
      tokenUsage: turnTokenUsage,
    };

    } finally {
      // ── Always purge transient messages ─────────────────────────
      // Transient system messages (pre-routed files, surface context) are
      // injected into `history` during PHASE 7.  They must be cleaned up
      // even if the turn throws to prevent stale context leaking into
      // subsequent turns.
      //
      // Purge from the resolved `history` array (which is what ask()
      // reads).  Also purge from the singleton as a safety net in case
      // legacy code still injects there.
      if (history && history.length > 0) {
        // In-place filter — `history` is a const binding so we can't reassign
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i]._transient) history.splice(i, 1);
        }
      }
      if (this._ai) {
        purgeTransientMessages({ ai: this._ai });
      }

      // ── Patch orphaned tool_calls ──────────────────────────────
      // When the turn is interrupted mid-tool-execution (user cancel),
      // the assistant message with tool_calls is already in history
      // (pushed by ask()) but the tool results were never added.
      // Inject synthetic error results so subsequent API calls don't
      // fail with "tool_use ids found without tool_result blocks".
      //
      // Patch both the resolved `history` and the singleton to cover
      // all code paths.
      if (history && history.length > 0) {
        patchOrphanedToolCalls(history);
      }
      if (this._ai?.conversationHistory && this._ai.conversationHistory !== history) {
        patchOrphanedToolCalls(this._ai.conversationHistory);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ════════════════════════════════════════════════════════════════════

  /**
   * Synthesize a fallback response when the loop exhausts iterations
   * or doom is detected.
   *
   * @private
   * @param {Array<Object>} toolResults — accumulated tool results
   * @returns {string}
   */
  _synthesizeFallbackResponse(toolResults) {
    this._stream.commentary('🔧', 'Synthesizing response from accumulated results…');

    if (!toolResults || toolResults.length === 0) {
      return 'I was unable to complete the request within the allowed iterations. Please try rephrasing your request or breaking it into smaller steps.';
    }

    const parts = ['Here is a summary of work completed:\n'];
    let successCount = 0;
    let errorCount = 0;

    for (const result of toolResults) {
      const name = result.name || 'unknown';
      const content = (result.content || '').substring(0, 200);
      const isError = content.toLowerCase().startsWith('error');
      if (isError) {
        errorCount++;
        parts.push(`- ❌ **${name}**: ${content}`);
      } else {
        successCount++;
        parts.push(`- ✅ **${name}**: ${content}${content.length >= 200 ? '…' : ''}`);
      }
    }

    parts.push('');
    parts.push(
      `Completed ${successCount} tool call(s)` +
      (errorCount > 0 ? `, with ${errorCount} error(s).` : '.') +
      ' The iteration limit was reached before the task could be fully completed.',
    );

    return parts.join('\n');
  }

  /**
   * Check if the abort signal has been triggered.
   *
   * @private
   * @param {AbortSignal|null|undefined} signal
   * @returns {boolean}
   */
  _isAborted(signal) {
    return signal?.aborted === true;
  }

  /**
   * Build a standard cancelled-result object.
   *
   * @private
   * @returns {{ response: string, toolResults: Array, diagnostics: Object, tokenUsage: null }}
   */
  _cancelledResult() {
    this._stream.phaseStart('cancel', 'Task cancelled.');
    this._stream.complete();
    return {
      response: '🛑 Task cancelled.',
      toolResults: [],
      diagnostics: { cancelled: true },
      tokenUsage: null,
    };
  }

  /**
   * Build normalized per-turn token/cost usage.
   *
   * @private
   * @param {number} promptTokens
   * @param {number} completionTokens
   * @param {string} [model]
   * @param {number|null} [precomputedCost]
   * @returns {{ promptTokens: number, completionTokens: number, totalTokens: number, totalCost: number } | null}
   */
  _buildTurnTokenUsage(promptTokens, completionTokens, model, precomputedCost = null) {
    if (!(promptTokens > 0 || completionTokens > 0)) {
      return null;
    }

    let totalCost = precomputedCost;
    if (totalCost == null) {
      const modelInfo = model ? getModelInfo(model) : null;
      const inputRate = modelInfo?.inputCostPerMillion ?? 3.0;
      const outputRate = modelInfo?.outputCostPerMillion ?? 15.0;
      totalCost =
        (promptTokens / 1_000_000) * inputRate +
        (completionTokens / 1_000_000) * outputRate;
    }

    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      totalCost,
    };
  }

  /**
   * Build a user-facing escalation message when the surface pipeline
   * has failed too many consecutive times.
   *
   * Rather than letting the agent loop endlessly with broken surface
   * mutations, this stops the loop and clearly explains to the user
   * what went wrong and what information might help.
   *
   * @private
   * @param {Array<Object>} failedResults — the surface failure tool results
   * @param {number} failureCount — total consecutive failures
   * @returns {string}
   */
  _buildSurfaceEscalation(failedResults, failureCount) {
    const parts = [
      `⚠️ **Surface Update Failed** — ${failureCount} consecutive attempt(s) failed.\n`,
      'The surface pipeline automatically verified each attempt and found rendering errors. ',
      'Each failed attempt was automatically reverted to preserve the last working state.\n',
    ];

    // Extract the last failure's details
    const lastFailure = failedResults[failedResults.length - 1];
    if (lastFailure?.content) {
      // Extract the failed gate and error from the pipeline result
      const lines = lastFailure.content.split('\n');
      const errorLines = lines.filter(
        (l) => l.includes('Error:') || l.includes('FAILED') || l.includes('Fix guidance'),
      );
      if (errorLines.length > 0) {
        parts.push('**Last error details:**\n');
        parts.push('```');
        parts.push(errorLines.slice(0, 5).join('\n'));
        parts.push('```\n');
      }
    }

    parts.push('**To resolve this, you can:**');
    parts.push('1. Provide the exact JSX source code you want for the component');
    parts.push('2. Describe what the component should look like in more detail');
    parts.push('3. Share a screenshot or example of the desired result');
    parts.push('4. Simplify the component (remove complex features and add them incrementally)');

    return parts.join('\n');
  }

  // ════════════════════════════════════════════════════════════════════
  // SupportLLM Integration — Pre-Flight Lint
  // ════════════════════════════════════════════════════════════════════

  /**
   * Extract fenced code blocks from a markdown response.
   *
   * @private
   * @param {string} text — the full response text
   * @returns {Array<{ lang: string, code: string, start: number, end: number }>}
   */
  _extractCodeBlocks(text) {
    const blocks = [];
    const regex = /```(\w+)?\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      blocks.push({
        lang: match[1] || 'unknown',
        code: match[2],
        start: match.index,
        end: match.index + match[0].length,
        fullMatch: match[0],
      });
    }
    return blocks;
  }

  /**
   * Run pre-flight lint checks on code blocks in the AI response.
   *
   * For each fenced code block, the SupportLLM performs a fast local
   * syntax/lint check. If errors are found and the model can fix them,
   * the fixed code silently replaces the original — the user receives
   * cleaner output without ever seeing the intermediate error.
   *
   * If the SupportLLM is unavailable, returns null, or times out,
   * the original content is returned unmodified.
   *
   * @private
   * @param {string} content — the AI response text (may contain code blocks)
   * @returns {Promise<string>} — content with lint-fixed code blocks (or original)
   */
  async _preflightLint(content) {
    if (!this._supportLlm?.isAvailable()) return content;

    const blocks = this._extractCodeBlocks(content);
    if (blocks.length === 0) return content;

    // Only lint blocks that are substantial enough to benefit from a check
    const lintableBlocks = blocks.filter(
      (b) => b.code.trim().length > 50 && b.lang !== 'unknown',
    );
    if (lintableBlocks.length === 0) return content;

    let result = content;
    let offset = 0; // Track position shifts from replacements

    for (const block of lintableBlocks) {
      try {
        const lintResult = await this._supportLlm.lint(block.code, block.lang);

        if (!lintResult || lintResult.valid !== false || !lintResult.fixed) {
          continue; // No errors or no fix available — keep original
        }

        // Replace the code block with the fixed version
        const fixedBlock = `\`\`\`${block.lang}\n${lintResult.fixed}\`\`\``;
        const adjustedStart = block.start + offset;
        const adjustedEnd = block.end + offset;

        result =
          result.substring(0, adjustedStart) +
          fixedBlock +
          result.substring(adjustedEnd);

        // Update offset for subsequent replacements
        offset += fixedBlock.length - block.fullMatch.length;

        this._stream?.commentary(
          '🔧',
          `Pre-flight lint: auto-fixed ${lintResult.errors?.length || 0} issue(s) in ${block.lang} code block`,
        );
      } catch {
        // Lint failed for this block — keep original, continue with next
      }
    }

    return result;
  }
}
