/**
 * Continuation loop for CognitiveAgent — detects incomplete/intent-announcement
 * responses from lmscript and re-invokes executeAgent with nudge prompts to
 * force the model to take action via tool calls.
 *
 * Extracted from CognitiveAgent.turn() to keep the main method linear.
 *
 * @module src/core/agentic/cognitive/agent-continuation
 */

import { emitCommentary, describeToolCall, buildToolRoundNarrative } from '../../status-reporter.mjs';

/**
 * Handle continuation loop: detect incomplete responses from lmscript and
 * re-invoke executeAgent with nudge prompts to take action.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {object} result - lmscript AgentResult (mutated: usage/toolCalls accumulated)
 * @param {string} responseText - Current response text
 * @param {object} agentFn - The LScriptFunction
 * @param {string} input - Original user input
 * @param {number} lmscriptMaxIter - Max iterations for continuations
 * @param {object} options - Turn options (signal, etc.)
 * @returns {Promise<{responseText: string, result: object}>}
 */
export async function runContinuationLoop(agent, result, responseText, agentFn, input, lmscriptMaxIter, options) {
  let continuations = 0;
  const maxContinuations = options.maxContinuations ?? (agent.config.agent.maxContinuations || 3);
  const maxTotalLLMCalls = agent.config.agent.maxTotalLLMCalls || 20;
  let totalLLMCalls = result.usage?.callCount
    || Math.max(1, (result.toolCalls?.length || 0) + 1);

  while (
    continuations < maxContinuations &&
    totalLLMCalls < maxTotalLLMCalls &&
    !options.signal?.aborted &&
    responseText.trim() &&
    agent._isIncompleteResponse(responseText)
  ) {
    continuations++;
    const intentPreview = responseText.trim().substring(0, 150);
    emitCommentary(`🤖 AI said: "${intentPreview}${responseText.trim().length > 150 ? '…' : ''}" — nudging to take action (continuation ${continuations}/${maxContinuations})`);
    agent._tracker.setActivity(`Continuing work… (continuation ${continuations})`);

    const priorToolSummary = result.toolCalls?.length
      ? `\nTools already executed in this turn:\n${result.toolCalls.map(tc => {
          const res = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result);
          return `- ${tc.name}: ${res.substring(0, 200)}`;
        }).join('\n')}\n\n`
      : '';

    const continuationMaxIter = Math.min(lmscriptMaxIter, 5);
    const remainingBudget = maxTotalLLMCalls - totalLLMCalls;
    const effectiveMaxIter = Math.min(continuationMaxIter, remainingBudget);

    if (effectiveMaxIter <= 0) break;

    let contIterToolNames = [];

    const continuationResult = await agent._runtime.executeAgent(agentFn,
      `You just said: "${responseText.trim().substring(0, 500)}"\n\n` +
      priorToolSummary +
      `You described what you intend to do but did NOT actually do it. ` +
      `You MUST now take action by calling the appropriate tools (e.g. write_file, run_command, etc.) ` +
      `to complete the task. Do NOT just describe what you will do — actually do it now using tool calls.`,
      {
        maxIterations: effectiveMaxIter,
        signal: options.signal,
        onToolCall: (toolCall) => {
          const desc = describeToolCall(toolCall.name, toolCall.args || toolCall.input);
          emitCommentary(`AI called tool: ${desc}`);
          agent._tracker.setActivity(`Executing: ${desc}`, { phase: 'tool-exec' });
          contIterToolNames.push(toolCall.name);
        },
        onIteration: (iteration) => {
          if (contIterToolNames.length > 0) {
            const narrative = buildToolRoundNarrative(contIterToolNames.map(name => ({ name })));
            if (narrative) {
              emitCommentary(`🔧 Continuation ${continuations}, iteration ${iteration}: ${narrative} Continuing…`);
            }
            contIterToolNames = [];
          } else {
            emitCommentary(`🔄 AI analyzing results — continuation ${continuations}, iteration ${iteration}`);
          }
          agent._tracker.setActivity(`AI processing results — continuation ${continuations}, iteration ${iteration}`, { phase: 'llm-call' });
        },
      }
    );

    responseText = continuationResult.data?.response || '';

    totalLLMCalls += continuationResult.usage?.callCount
      || Math.max(1, (continuationResult.toolCalls?.length || 0) + 1);

    if (continuationResult.usage) {
      if (!result.usage) result.usage = { totalTokens: 0 };
      result.usage.totalTokens = (result.usage.totalTokens || 0) + (continuationResult.usage.totalTokens || 0);
    }
    if (continuationResult.toolCalls?.length) {
      result.toolCalls = [...(result.toolCalls || []), ...continuationResult.toolCalls];
    }
  }

  return { responseText, result };
}
