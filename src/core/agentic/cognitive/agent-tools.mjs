/**
 * agent-tools.mjs — Tool execution loop extracted from CognitiveAgent.
 *
 * Processes tool calls from LLM responses: validates tool names, executes
 * each tool, truncates results, builds tool-response messages, emits
 * narrative commentary, and calls the LLM again for the next round.
 *
 * @module src/core/agentic/cognitive/agent-tools
 */

import { emitStatus, emitCommentary, describeToolCall, buildToolRoundNarrative } from '../../status-reporter.mjs';

/**
 * Execute pending tool calls in a loop, appending assistant/tool messages
 * to the conversation and calling the LLM after each round.
 *
 * Shared by both the main tool loop and the continuation-triggered tool
 * loop so the Gemini _geminiParts round-trip logic lives in one place.
 *
 * On every iteration, emits a narrative commentary summarising the tools
 * that were just executed and any text the AI provided alongside tool calls.
 * This ensures the user always sees a verbal callout between processing blocks.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent - CognitiveAgent instance
 * @param {Array} messages     - Mutable messages array (modified in place)
 * @param {Object} response    - Current LLM response (may contain toolCalls)
 * @param {Array} toolDefs     - Tool definitions for subsequent LLM calls
 * @param {Array} toolResults  - Accumulator for tool results (modified in place)
 * @param {number} toolRounds  - Current tool round count
 * @param {Object} options     - LLM call options (signal, etc.)
 * @param {number} [llmCallCount=0] - Running total of LLM calls in this turn (for maxTotalLLMCalls)
 * @returns {Promise<{response: Object, toolRounds: number, llmCallCount: number}>}
 */
export async function processToolCalls(agent, messages, response, toolDefs, toolResults, toolRounds, options, llmCallCount = 0) {
  const maxTotalLLMCalls = agent.config.agent.maxTotalLLMCalls || 20;

  // Build a Set of valid tool names for O(1) lookup during execution
  const validToolNames = new Set(
    (agent._cachedToolDefs || agent._getToolDefinitions())
      .map(t => t.function?.name || t.name)
      .filter(Boolean)
  );

  // Strip streaming callback from tool-loop LLM calls — internal reasoning
  // should not be streamed to the user (Phase 1 streaming support).
  const { onChunk: _stripChunk, ...toolLoopOptions } = options;
  // Use config-driven temperature for tool loop, falling back to 0.4 for deterministic tool usage
  toolLoopOptions.temperature = toolLoopOptions.temperature ?? agent.config.agent?.toolLoopTemperature ?? 0.4;
  while (
    response.toolCalls &&
    response.toolCalls.length > 0 &&
    toolRounds < agent.config.agent.maxToolRounds &&
    llmCallCount < maxTotalLLMCalls
  ) {
    toolRounds++;

    // ── Emit AI commentary if the response included text alongside tool calls ──
    // Many models provide a short explanation of what they're about to do.
    // Surface it as a persistent narrative so the user sees a verbal callout.
    if (response.content?.trim()) {
      const commentary = response.content.trim().substring(0, 300);
      emitCommentary(`🤖 ${commentary}`);
    }

    // Build the assistant message for ALL tool calls in this round.
    // For Gemini thinking models, we MUST preserve _geminiParts (which
    // contain thought/thoughtSignature fields) or the API will reject
    // subsequent turns with "missing thought_signature" errors.
    const rawMsg = response.rawMessage;
    const assistantMsg = {
      role: 'assistant',
      content: null,
      tool_calls: response.toolCalls.map(tc => ({
        id: tc.id || `call_${toolRounds}_${tc.function.name}`,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function.arguments)
        },
        // Preserve thoughtSignature for Gemini round-tripping
        _thoughtSignature: tc._thoughtSignature || undefined
      }))
    };

    // Preserve full Gemini parts for faithful round-trip reconstruction
    if (rawMsg && rawMsg._geminiParts) {
      assistantMsg._geminiParts = rawMsg._geminiParts;
    }

    messages.push(assistantMsg);

    // Execute each tool and push results
    const roundToolNames = response.toolCalls.map(tc => tc.function.name);
    emitCommentary(`⚙️ AI requested ${roundToolNames.length} tool(s): ${roundToolNames.join(', ')}`);

    for (let i = 0; i < response.toolCalls.length; i++) {
      const toolCall = response.toolCalls[i];
      const toolName = toolCall.function.name;

      // Fast O(1) validation — reject unknown tool names early
      let parsedArgs = toolCall.function.arguments;
      if (typeof parsedArgs === 'string') {
        try { parsedArgs = JSON.parse(parsedArgs); } catch { parsedArgs = {}; }
      }
      if (!validToolNames.has(toolName)) {
        console.warn(`[CognitiveAgent] Unknown tool called: ${toolName}`);
        toolResults.push({ tool: toolName, args: parsedArgs, result: `Error: Unknown tool "${toolName}"` });
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id || `call_${toolRounds}_${toolName}`,
          name: toolName,
          content: `Error: Unknown tool "${toolName}"`
        });
        continue;
      }

      // Per-tool start status so the user sees progress through multi-tool rounds
      const toolDesc = describeToolCall(toolName, parsedArgs || {});
      if (response.toolCalls.length > 1) {
        emitStatus(`Running tool ${i + 1}/${response.toolCalls.length}: ${toolDesc}`);
      } else {
        emitStatus(`Running tool: ${toolDesc}`);
      }

      const result = await agent._executeTool(toolName, toolCall.function.arguments);
      toolResults.push({ tool: toolName, args: parsedArgs, result });

      // Per-tool completion status
      const toolFailed = result?.success === false || result?.error;
      emitStatus(`Tool ${toolName} ${toolFailed ? 'failed' : 'completed'}`);

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id || `call_${toolRounds}_${toolName}`,
        name: toolName,
        content: agent._truncateToolResult(result)
      });
    }

    // ── Emit post-round narrative summary ──
    // Build a human-readable summary of what was just done so the user
    // sees a clear verbal callout between every tool execution round.
    const roundNarrative = buildToolRoundNarrative(
      roundToolNames.map((name, i) => ({ name, result: toolResults.slice(-roundToolNames.length)[i]?.result }))
    );
    if (roundNarrative) {
      emitCommentary(`🔧 Round ${toolRounds}: ${roundNarrative} Sending results back to AI…`);
    }

    // Call LLM again with tool results (no streaming — internal reasoning)
    agent._tracker.setActivity(`Sending tool results to AI — round ${toolRounds + 1}`, { phase: 'llm-call' });
    response = await agent._callLLM(messages, toolDefs, toolLoopOptions);
    llmCallCount++;
  }

  return { response, toolRounds, llmCallCount };
}
