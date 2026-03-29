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
          recordHistory: false,
          model,
          stream: streamEnabled,
          onChunk,
        });
        llmCallCount++;

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
            });

            return {
              response: responseText,
              toolResults: [],
              diagnostics: { precheck: true, intent },
              tokenUsage: null,
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

    // Pre-route files & surfaces
    const engineTools = this._ai?.tools || null;
    const { fileContext, surfaceContext } = await this._contextManager.preRoute(
      input,
      engineTools,
    );

    // Inject pre-routed file context into conversation history
    if (fileContext && fileContext.length > 0 && this._ai?.conversationHistory) {
      const fileBlock = fileContext
        .map((r) => {
          if (r.content) return `[FILE CONTENT: ${r.path}]\n\`\`\`\n${r.content}\n\`\`\``;
          if (r.error) return `[FILE ERROR: ${r.path}]: ${r.error}`;
          return '';
        })
        .filter(Boolean)
        .join('\n\n');

      if (fileBlock) {
        this._ai.conversationHistory.push({
          role: 'system',
          content: `The following files were automatically retrieved based on the user's request.\n\n${fileBlock}`,
          _transient: true,
        });
        this._stream.commentary('📂', `Pre-fetched ${fileContext.length} file(s)`);
      }
    }

    // Inject surface context
    if (surfaceContext && this._ai?.conversationHistory) {
      this._ai.conversationHistory.push({
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
      preRouted: fileContext,
      violations: safetyResult.violations,
      taskContext: this._toolBridge.taskContext,
      isSurfaceUpdate: intent.isSurfaceUpdate,
      toolNames,
      history,
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
          tools,
          signal,
          stream: streamEnabled,
          onChunk,
          model,
        });
        timing.llmCallMs += Date.now() - llmStart;
        llmCallCount++;

        // Extract usage from the response and update turn metrics
        const usage = response?.usage || null;
        if (usage) {
          const promptTok = usage.prompt_tokens || 0;
          const completionTok = usage.completion_tokens || 0;
          totalPromptTokens += promptTok;
          totalCompletionTokens += completionTok;
          this._stream?.addTokens(promptTok + completionTok);
        }
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
          this._ai?.conversationHistory || [],
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
        // message (with tool_calls) and we push tool results here.
        if (this._ai?.conversationHistory) {
          for (const result of results) {
            this._ai.conversationHistory.push(result);
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
      const content = typeof response === 'string' ? response : response?.content;
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
          if (this._ai?.conversationHistory) {
            const hist = this._ai.conversationHistory;
            if (hist.length > 0 && hist[hist.length - 1].role === 'assistant') {
              hist.pop();
            }
            if (hist.length > 0 && hist[hist.length - 1].role === 'user') {
              hist.pop();
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

    const turnTokenUsage = (totalPromptTokens > 0 || totalCompletionTokens > 0)
      ? {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens: totalPromptTokens + totalCompletionTokens,
          totalCost: turnCost,
        }
      : null;

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
      // injected into conversationHistory during PHASE 7.  They must be
      // cleaned up even if the turn throws to prevent stale context from
      // leaking into subsequent turns.
      if (this._ai) {
        purgeTransientMessages({ ai: this._ai });
        // ── Patch orphaned tool_calls ──────────────────────────────
        // When the turn is interrupted mid-tool-execution (user cancel),
        // the assistant message with tool_calls is already in history
        // (pushed by ask()) but the tool results were never added.
        // Inject synthetic error results so subsequent API calls don't
        // fail with "tool_use ids found without tool_result blocks".
        if (this._ai.conversationHistory) {
          patchOrphanedToolCalls(this._ai.conversationHistory);
        }
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
}
