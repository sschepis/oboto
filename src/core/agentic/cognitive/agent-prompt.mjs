/**
 * Prompt-building and tool-definition helpers extracted from CognitiveAgent.
 *
 * Each function takes `agent` (the CognitiveAgent instance) as its first
 * parameter.  The class retains thin wrapper methods that delegate here.
 *
 * @module src/core/agentic/cognitive/agent-prompt
 */

import { emitStatus } from '../../status-reporter.mjs';
import { summarizeHistory } from './agent-response-utils.mjs';

// ════════════════════════════════════════════════════════════════════
// buildSystemPrompt
// ════════════════════════════════════════════════════════════════════

/**
 * Build the full system prompt for an lmscript executeAgent call.
 *
 * Since executeAgent() only injects `[system, user(prompt)]` messages,
 * we pack conversation history, cognitive state, memories, safety
 * warnings, and pre-routed data into the system prompt.
 *
 * Uses a two-tier cache: the static base (basePrompt + tool names +
 * plugin traits) is cached and only rebuilt when the composite key
 * changes.  Dynamic portions (state, memories, violations, pre-route
 * data, history) are appended fresh each call.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {string} input            - Current user input (for recall)
 * @param {Object} options          - Turn options
 * @param {Array}  preRouted        - Pre-routed auto-fetch results
 * @param {Array}  violations       - Safety violations (may be empty)
 * @returns {string}
 */
export function buildSystemPrompt(agent, input, options = {}, preRouted = [], violations = []) {
  // ── Tier 1: Static base (cached) ────────────────────────────────
  // The base prompt, tool names list, and plugin traits block rarely
  // change between turns.  Cache them and only rebuild when the
  // composite key changes (persona switch, plugin load/unload, or
  // trait routing produces a different selection).
  const basePrompt = (agent.aiProvider?.systemPrompt) || agent.systemPrompt;
  const toolDefs = getToolDefinitions(agent);
  const toolNames = toolDefs.map(t => t.function.name).join(', ');
  const traitsJSON = JSON.stringify(agent._cachedSelectedTraits || []);
  const cacheKey = basePrompt.length + '|' + toolNames + '|' + traitsJSON;

  if (cacheKey !== agent._cachedSystemPromptBaseKey) {
    let staticBase = basePrompt;
    staticBase += `\n[Available Tools: ${toolNames}]\n`;
    // Append plugin capability traits — concise descriptions of what
    // each active plugin's tools do and when to use them, so the LLM
    // can select tools without extra discovery calls.
    // Uses pre-selected traits from the routing LLM call if available.
    staticBase += buildPluginTraitsBlock(agent, agent._cachedSelectedTraits);
    agent._cachedSystemPromptBase = staticBase;
    agent._cachedSystemPromptBaseKey = cacheKey;
  }

  // ── Tier 2: Dynamic portions (appended each call) ───────────────
  const stateContext = agent.cognitive.getStateContext();
  let systemMessage = agent._cachedSystemPromptBase + '\n\n' + stateContext;

  // ── Step 6: Recall relevant memories ────────────────────────────
  emitStatus('Recalling relevant memories');
  const memories = agent.cognitive.recall(input, 3);
  if (memories.length > 0) {
    systemMessage += '\n[Relevant Past Interactions]\n';
    for (const mem of memories) {
      systemMessage += `- User: "${mem.input}" → Agent: "${mem.output}"\n`;
    }
  }

  // Safety warnings (non-blocking violations)
  if (violations.length > 0) {
    systemMessage += '\n[Safety Warnings]\n';
    for (const v of violations) {
      systemMessage += `- ${v.constraint?.name}: ${v.constraint?.description}\n`;
    }
  }

  // Pre-routed data
  if (preRouted.length > 0) {
    let toolContext = preRouted.map(r => {
      if (r.tool === 'read_file' && r.content) {
        return `[FILE CONTENT: ${r.path}]\n\`\`\`\n${r.content}\n\`\`\``;
      } else if (r.tool === 'read_file' && r.error) {
        return `[FILE ERROR: ${r.path}]: ${r.error}`;
      } else if (r.tool === 'list_files') {
        return `[FILES IN ${r.path}]: ${Array.isArray(r.files) ? r.files.map(f => typeof f === 'string' ? f : f.name).join(', ') : JSON.stringify(r.files)}`;
      } else if (r.tool === 'cognitive_state') {
        return `[YOUR COGNITIVE STATE]:\n${JSON.stringify(r.state, null, 2)}`;
      }
      return '';
    }).filter(Boolean).join('\n\n');

    if (toolContext) {
      // Cap pre-routed data to prevent blowing the context window.
      // Allocate 30% of available context tokens for pre-routed data,
      // leaving room for the system prompt base, tool definitions, plugin
      // traits, history, user message, and response.
      // Uses a ~4-chars-per-token estimate to convert token budget to chars.
      const availableTokens = (agent.config.lmscript?.context?.maxTokens || 128000)
          - (agent.config.lmscript?.context?.reserveTokens || 4096);
      const preRouteBudgetFraction = agent.config.lmscript?.context?.preRouteBudgetFraction ?? 0.3;
      const maxPreRouteChars = Math.floor(availableTokens * preRouteBudgetFraction * 4);
      if (toolContext.length > maxPreRouteChars) {
        toolContext = toolContext.substring(0, maxPreRouteChars) + '\n\n[...data truncated to fit context window]';
      }
      systemMessage += `\nThe following data has been retrieved for you. You MUST analyze this data carefully to answer the user's question. Reference specific details from the data in your response.\n\n${toolContext}\n\nIMPORTANT: Base your answer on the actual data above. Do NOT make up information or describe things in general terms — cite specific code, values, thresholds, function names, or state values from the retrieved data.\n`;
    }
  }

  // Conversation history (since executeAgent builds only [system, user],
  // we embed history in the system prompt for multi-turn continuity).
  // Uses summarizeHistory() to compress older messages and keep recent
  // ones verbatim, staying within a configurable token budget.
  if (agent.history.length > 0) {
    const maxHistoryChars = (agent.config.lmscript?.context?.historyBudgetTokens || agent.config.lmscript?.context?.reserveTokens || 4096) * 4;
    const historyBlock = summarizeHistory(agent, maxHistoryChars);
    if (historyBlock) {
      systemMessage += '\n[Conversation History]\n' + historyBlock;
    }
  }

  return systemMessage;
}

// ════════════════════════════════════════════════════════════════════
// buildPluginTraitsBlock
// ════════════════════════════════════════════════════════════════════

/**
 * Build the [Plugin Capabilities] block from a pre-selected list of traits.
 * If selectedTraits is provided (from _selectRelevantTraits), only those
 * are included; otherwise falls back to all active plugin traits.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {Array<{name: string, trait: string}>} [selectedTraits] - Pre-filtered traits
 * @returns {string}
 */
export function buildPluginTraitsBlock(agent, selectedTraits) {
  if (!agent.facade?.pluginManager) return '';
  const traits = selectedTraits || agent.facade.pluginManager.getPluginTraits();
  if (!traits || traits.length === 0) return '';

  const maxTraitLen = agent.config.agent?.maxTraitLength ?? 150;
  let block = '\n[Plugin Capabilities]\n';
  for (const { name, trait } of traits) {
    const truncated = trait.length > maxTraitLen
      ? trait.substring(0, maxTraitLen) + '…'
      : trait;
    block += `- ${name}: ${truncated}\n`;
  }
  return block;
}

// ════════════════════════════════════════════════════════════════════
// getToolDefinitions
// ════════════════════════════════════════════════════════════════════

/**
 * Get tool definitions in OpenAI function-calling format from ai-man's ToolExecutor.
 * Also adds cognitive-specific tools and sentient tools when available.
 * Results are cached per-turn on `agent._cachedToolDefs`.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @returns {Array}
 */
export function getToolDefinitions(agent) {
  // Return per-turn cached result if available (avoid rebuilding for
  // both buildSystemPrompt and _turnLegacy within the same turn).
  if (agent._cachedToolDefs) return agent._cachedToolDefs;

  // Get ai-man's full tool definitions
  const aiManTools = agent.toolExecutor ? agent.toolExecutor.getAllToolDefinitions() : [];

  // Add cognitive-specific tools
  const cognitiveTools = [
    {
      type: 'function',
      function: {
        name: 'cognitive_state',
        description: 'Get your current cognitive state including coherence, entropy, and oscillator synchronization',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'recall_memory',
        description: 'Search your holographic memory for relevant past interactions',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results (default 5)' }
          },
          required: ['query']
        }
      }
    }
  ];

  // ── Sentient-specific tool definitions (only when sentient core is active) ──
  if (agent._sentientEnabled) {
    for (const def of agent._getSentientToolMetadata()) {
      cognitiveTools.push({
        type: 'function',
        function: {
          name: def.name,
          description: def.description,
          parameters: def.openAiSchema,
        },
      });
    }
  }

  let allTools = [...aiManTools, ...cognitiveTools];

  // Cap tool count to reduce token waste.  Cognitive/sentient tools are
  // always included (appended last), so we trim aiManTools from the end
  // when the total exceeds the configured maximum.
  const maxTools = agent.config.agent?.maxToolDefinitions ?? 40;
  if (allTools.length > maxTools) {
    const coreToolCount = cognitiveTools.length;
    const maxAiManTools = Math.max(0, maxTools - coreToolCount);
    allTools = [...aiManTools.slice(0, maxAiManTools), ...cognitiveTools];
  }

  agent._cachedToolDefs = allTools;
  return allTools;
}
