/**
 * Iteration-exhaustion recovery for CognitiveAgent — synthesizes a response
 * from collected tool results when lmscript exhausts its iteration budget
 * or aborts due to empty iterations.
 *
 * Extracted from the catch block of CognitiveAgent.turn() to keep
 * error handling focused.
 *
 * @module src/core/agentic/cognitive/agent-exhaustion
 */

import { emitCommentary } from '../../status-reporter.mjs';

/**
 * Abort reason used by the empty-iteration early-exit AbortController.
 * Must match the constant in agent.mjs.
 */
const EMPTY_ITERATION_ABORT_REASON = 'empty-iteration-limit';

/**
 * Determine whether an error represents an iteration-exhaustion condition.
 *
 * @param {Error} err - The caught error
 * @param {AbortController|null} earlyExitController - The early-exit controller
 * @returns {boolean}
 */
export function isIterationExhaustion(err, earlyExitController) {
  const isEarlyExitAbort = earlyExitController?.signal?.aborted
    && earlyExitController.signal.reason === EMPTY_ITERATION_ABORT_REASON;
  return isEarlyExitAbort
    || (err.message?.includes('[lmscript]')
        && (err.message.includes('Failed to parse LLM response as JSON')
            || err.message.includes('produced invalid output')));
}

/**
 * Recover from lmscript iteration exhaustion by synthesizing a response
 * from collected tool results via a separate LLM call.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {string} input - Original user input
 * @param {Array} collectedToolCalls - Tool calls collected during the loop
 * @param {number} lmscriptMaxIter - The iteration limit that was hit
 * @param {object} options - Turn options
 * @returns {Promise<{response: string, toolResults: Array, diagnostics: object}>}
 */
export async function recoverFromExhaustion(agent, input, collectedToolCalls, lmscriptMaxIter, options) {
  console.warn(
    `[CognitiveAgent] lmscript exhausted ${lmscriptMaxIter} iterations with ${collectedToolCalls.length} tool calls — synthesizing response`
  );
  agent._tracker.setActivity(`AI iteration limit reached — synthesizing response from ${collectedToolCalls.length} tool results`);
  emitCommentary(`⏱️ AI reached iteration limit after ${collectedToolCalls.length} tool calls — synthesizing a summary response…`);

  const toolResults = collectedToolCalls.map(tc => ({
    tool: tc.name,
    args: tc.args || tc.input || null,
    result: tc.result
  }));

  let partialContext = '';
  if (collectedToolCalls.length > 0) {
    const lastCall = collectedToolCalls[collectedToolCalls.length - 1];
    if (lastCall.result && typeof lastCall.result === 'string') {
      partialContext = `\nLast tool result: ${lastCall.result.substring(0, 500)}`;
    }
  }

  let synthesized = '';
  try {
    const basePrompt = (agent.aiProvider?.systemPrompt) || agent.systemPrompt;
    const toolSummary = toolResults.map(t => {
      const resultStr = typeof t.result === 'string'
        ? t.result
        : JSON.stringify(t.result);
      return `- ${t.tool}: ${resultStr.substring(0, 500)}`;
    }).join('\n');

    const synthResult = await agent._callLLM([
      { role: 'system', content: basePrompt },
      { role: 'user', content: input },
      {
        role: 'system',
        content: `The tool loop completed (${collectedToolCalls.length} tool calls executed). Here is a summary of all tool results:\n\n${toolSummary}${partialContext}\n\nNow write a clear, plain-English response for the user. Do NOT call any more tools.`
      }
    ], [], { ...options, temperature: options.temperature ?? 0.5 });
    synthesized = synthResult.content || '';
  } catch (synthErr) {
    console.warn('[CognitiveAgent] Synthesis LLM call failed:', synthErr.message);
  }

  if (!synthesized.trim()) {
    synthesized = agent._buildFallbackResponse(toolResults);
  }

  const validation = agent.cognitive.validateOutput(synthesized, { input });
  const finalResponse = synthesized;

  agent.history.push({ role: 'user', content: input });
  agent.history.push({ role: 'assistant', content: finalResponse });
  while (agent.history.length > agent.maxHistory) {
    agent.history.shift();
  }
  agent.cognitive.remember(input, finalResponse);
  for (let i = 0; i < 3; i++) agent.cognitive.tick();

  emitCommentary('✅ Response ready (synthesized from tool results).');
  agent._tracker.stop();

  return {
    response: finalResponse,
    toolResults,
    thoughts: null,
    signature: null,
    diagnostics: {
      ...agent.cognitive.getDiagnostics(),
      synthesizedFromExhaustion: true,
      objectivityR: validation.R,
      objectivityPassed: validation.passed
    },
    tokenUsage: null
  };
}
