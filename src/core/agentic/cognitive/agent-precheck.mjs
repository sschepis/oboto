/**
 * Precheck helpers extracted from CognitiveAgent.
 *
 * The precheck is a lightweight LLM call that determines whether the
 * user's input can be answered directly (no tools needed) or requires
 * the full cognitive pipeline.  This module exports the constants,
 * evaluation heuristic, and the orchestrating runPrecheck() function.
 *
 * Each function takes `agent` (the CognitiveAgent instance) as its
 * first parameter where agent state is needed.
 *
 * @module src/core/agentic/cognitive/agent-precheck
 */

import { emitCommentary } from '../../status-reporter.mjs';
import { summarizeInput } from '../../status-reporter.mjs';
import { isCancellationError } from '../../ai-provider/utils.mjs';
import { shouldSkipPrecheck } from './agent-response-utils.mjs';
import { callLLM, getPrecheckCached, setPrecheckCached } from './agent-llm.mjs';

// ════════════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════════════

/**
 * Direct-answer precheck: the model answers immediately or signals it
 * needs tools.  Mirrors the eventic loop's precheck pattern but adapted
 * for the cognitive agent.  The model either answers directly or returns
 * the sentinel to enter the full cognitive pipeline.
 */
export const PROCEED_SENTINEL = '___AGENT_PROCEED___';

export const PRECHECK_PROMPT = `Answer the following directly if you can. If the request is too vague, ask one clarifying question. If it requires tools, file access, or multi-step reasoning, respond with exactly: ${PROCEED_SENTINEL}`;

// ════════════════════════════════════════════════════════════════════
// evaluateTextResponse
// ════════════════════════════════════════════════════════════════════

/**
 * Evaluate a text response inline — returns { action, guidance }.
 * Used by the precheck to validate direct answers before accepting them.
 * Mirrors the eventic loop's evaluateTextResponse heuristic.
 *
 * @param {string} content - LLM response text
 * @param {string} input - Original user input
 * @param {number} retryCount - Current retry count
 * @returns {{action: string, guidance: string}}
 */
export function evaluateTextResponse(content, input, retryCount) {
  // Short input + non-trivial response → accept
  if (input.trim().length < 50 && content.length > 20) {
    return { action: 'accept', guidance: '' };
  }
  // Extremely terse response to a long/complex input → retry
  if (input.length > 200 && content.length < 30 && retryCount < 2) {
    return {
      action: 'retry',
      guidance: 'Response is too brief for the complexity of the question. Provide more detail.'
    };
  }
  // Bare refusal without explanation → retry
  const lower = content.toLowerCase();
  if ((lower.includes("i can't") || lower.includes("i cannot")) &&
      !lower.includes('because') && !lower.includes('however') &&
      retryCount < 2) {
    return {
      action: 'retry',
      guidance: 'You said you cannot do something. Explain why, or attempt an alternative approach.'
    };
  }
  return { action: 'accept', guidance: '' };
}

// ════════════════════════════════════════════════════════════════════
// runPrecheck
// ════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} PrecheckResult
 * @property {'direct'|'proceed'|'cancelled'|'skip'} outcome
 *   - 'direct'    → The model answered directly; `response` contains the answer.
 *   - 'proceed'   → The model signalled it needs tools; enter the full pipeline.
 *   - 'cancelled' → The request was cancelled (AbortSignal).
 *   - 'skip'      → Precheck was skipped (disabled or obvious tool request).
 * @property {string|null} response - The direct answer text (only when outcome === 'direct')
 * @property {boolean} cached - Whether the response came from cache (only meaningful when outcome === 'direct')
 */

/**
 * Run the direct-answer precheck.
 *
 * 1. Checks whether precheck is enabled via config.
 * 2. Fast-paths requests that obviously need tools (shouldSkipPrecheck).
 * 3. Checks the precheck cache for a previous answer.
 * 4. Makes a lightweight LLM call with PRECHECK_PROMPT.
 * 5. Evaluates the quality of the direct answer.
 *
 * The caller (turn()) is responsible for cognitive post-processing
 * (processInput, validateOutput, remember, tick, history) when a
 * direct answer is returned.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {string} input - User message
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<PrecheckResult>}
 */
export async function runPrecheck(agent, input, options = {}) {
  // ── Disabled? ──
  if (agent.config.agent?.precheckEnabled === false) {
    return { outcome: 'skip', response: null };
  }

  // ── Fast-path: skip for obvious tool requests ──
  if (shouldSkipPrecheck(agent, input)) {
    emitCommentary('🧠 Request requires tools — entering the agent loop directly.');
    return { outcome: 'skip', response: null };
  }

  // ── Check precheck cache ──
  const cachedResponse = getPrecheckCached(agent, input);
  if (cachedResponse) {
    emitCommentary('✅ Answered from cache — no LLM call needed.');
    return { outcome: 'direct', response: cachedResponse, cached: true };
  }

  // ── LLM precheck call ──
  try {
    emitCommentary(`🔍 Analyzing request: ${summarizeInput(input)} — checking if I can answer directly…`);

    const preCheckResult = await callLLM(agent, [
      { role: 'system', content: PRECHECK_PROMPT },
      { role: 'user', content: input },
    ], [], { signal: options.signal });

    const responseText = (preCheckResult.content || '').trim();

    if (responseText && !responseText.includes(PROCEED_SENTINEL)) {
      // Validate the direct answer quality before accepting
      const { action } = evaluateTextResponse(responseText, input, 0);
      if (action !== 'retry') {
        // Cache the successful precheck response for future reuse
        setPrecheckCached(agent, input, responseText);
        emitCommentary('✅ Answered directly — no tools needed.');
        return { outcome: 'direct', response: responseText, cached: false };
      }
      // Quality check failed — fall through to full pipeline
      emitCommentary('🔄 Direct answer didn\'t meet quality bar — entering the agent loop for a deeper response.');
    } else {
      emitCommentary('🧠 This requires tools and deeper reasoning — entering the agent loop.');
    }

    return { outcome: 'proceed', response: null };
  } catch (e) {
    if (isCancellationError(e) || options.signal?.aborted) {
      return { outcome: 'cancelled', response: null };
    }
    // Precheck failed — proceed to full pipeline silently
    return { outcome: 'proceed', response: null };
  }
}
