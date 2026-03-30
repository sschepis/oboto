/**
 * Unified system prompt builder — merges Cognitive's and Megacode's prompt
 * builders into a single composable module for the UnifiedProvider.
 *
 * Builds system prompts from ordered sections:
 *  1. Core identity
 *  2. Cognitive context (memory, PRSC state, attention)
 *  3. Tool usage instructions
 *  4. Plugin traits (routed)
 *  5. Pre-routed file context
 *  6. Surface update instructions
 *  7. Task context (completed + pending)
 *  8. Safety violations
 *  9. Planning hint
 *
 * Also provides continuation and multi-turn prompt builders, plus
 * trait routing (keyword + LLM fallback).
 *
 * Ports logic from:
 *  - {@link src/core/agentic/cognitive/agent-prompt.mjs} — buildSystemPrompt, buildPluginTraitsBlock
 *  - {@link src/core/agentic/cognitive/agent-preroute.mjs} — selectRelevantTraits, matchTraitsByKeyword
 *  - {@link src/core/agentic/cognitive/agent-continuation.mjs} — continuation nudge
 *  - {@link src/core/eventic-agent-loop-plugin.mjs} — task context, surface instructions, planning hint
 *
 * @module src/core/agentic/unified/prompt-builder
 */

import { classifyInputComplexity } from '../../agent-loop-helpers.mjs';

// ════════════════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════════════════

/**
 * Default identity text used when no system prompt is provided.
 * @type {string}
 */
const DEFAULT_IDENTITY = 'You are a helpful, capable AI assistant with access to tools for reading files, writing files, running commands, and browsing the web. Use your tools to accomplish tasks step by step.';

/**
 * Standard tool usage instructions injected into every system prompt.
 * @type {string}
 */
const TOOL_USAGE_INSTRUCTIONS = `
[TOOL USAGE GUIDELINES]
- Use tools to accomplish tasks — do not just describe what you would do.
- Call one or more tools per turn when action is needed.
- After tool results, evaluate the outcome and continue or respond.
- If a tool fails, read the error carefully and try a different approach.
- When editing files, read them first to understand the existing code.
- For multi-step tasks, use add_tasks to create a plan, then work through tasks sequentially.
`.trim();

/**
 * Surface update instructions — injected when the request targets an existing surface.
 * Ported from eventic-agent-loop-plugin.mjs lines 253–263.
 * @type {string}
 */
const SURFACE_UPDATE_INSTRUCTIONS = `
[SURFACE UPDATE INSTRUCTIONS]
You are modifying an EXISTING surface. Follow this workflow strictly:
1. The surface context has been pre-fetched in system messages above — READ IT FIRST.
2. DO NOT call list_surfaces or read_surface unless the pre-fetched data is missing.
3. Identify the component(s) that need changes by reviewing the existing source code.
4. Modify the existing source — do NOT rewrite from scratch unless explicitly asked to.
5. Call update_surface_component with the COMPLETE modified jsx_source (full file, not a diff).
6. Preserve ALL existing functionality — only change what was requested.
7. If there are multiple components that need updating, update them one at a time.
8. After calling update_surface_component, provide a brief summary of what you changed.
`.trim();

/**
 * Planning hint appended to complex inputs.
 * Ported from eventic-agent-loop-plugin.mjs line 248–249.
 * @type {string}
 */
const PLANNING_HINT = '\n\n[PLANNING HINT]: This is a complex multi-step request. Start by using the add_tasks tool to create a structured plan before executing. Break the work into clear, sequential tasks.';

// ════════════════════════════════════════════════════════════════════════
// buildSystemPrompt
// ════════════════════════════════════════════════════════════════════════

/**
 * Build a complete system prompt from ordered sections.
 *
 * @param {Object} options
 * @param {string}  options.input             — current user input
 * @param {Object}  options.config            — unified config object
 * @param {string}  [options.systemPrompt]    — base system prompt / identity
 * @param {Object}  [options.cognitiveContext] — cognitive state context
 * @param {string}  [options.cognitiveContext.stateContext] — PRSC state summary
 * @param {Array}   [options.cognitiveContext.memories]     — recalled memories
 * @param {Object}  [options.cognitiveContext.attention]    — attention allocation
 * @param {Array<{name: string, trait: string}>} [options.selectedTraits] — pre-routed plugin traits
 * @param {Array}   [options.preRouted]       — pre-routed file/resource results
 * @param {Array}   [options.violations]      — safety violation objects
 * @param {Object}  [options.taskContext]     — { tasks, completedTasks }
 * @param {string}  [options.model]           — model identifier (for context limits)
 * @param {number}  [options.turnNumber]      — current turn number
 * @param {number}  [options.maxTurns]        — maximum turns
 * @param {Array}   [options.history]         — conversation history messages
 * @param {boolean} [options.isSurfaceUpdate] — whether the input targets a surface
 * @param {Array<string>} [options.toolNames] — available tool names for listing
 * @param {import('../../confidentiality/view-compiler.mjs').ViewCompiler} [options.viewCompiler] — ViewCompiler instance for confidentiality filtering
 * @param {import('../../confidentiality/models.mjs').AgentProfile} [options.agentProfile] — AgentProfile for the calling agent
 * @returns {string} — assembled system prompt
 */
export function buildSystemPrompt(options = {}) {
  const {
    input = '',
    config = {},
    systemPrompt,
    cognitiveContext,
    selectedTraits,
    preRouted,
    violations,
    taskContext,
    isSurfaceUpdate = false,
    toolNames,
    history,
    viewCompiler,
    agentProfile,
  } = options;

  const sections = [];

  // ── 1. Core identity ────────────────────────────────────────────
  sections.push(systemPrompt || DEFAULT_IDENTITY);

  // ── 2. Cognitive context ────────────────────────────────────────
  if (config.cognitive?.enabled !== false && cognitiveContext) {
    if (cognitiveContext.stateContext) {
      sections.push(cognitiveContext.stateContext);
    }
    if (cognitiveContext.memories && cognitiveContext.memories.length > 0) {
      let memBlock = '[Relevant Past Interactions]';
      for (const mem of cognitiveContext.memories) {
        memBlock += `\n- User: "${mem.input}" → Agent: "${mem.output}"`;
      }
      sections.push(memBlock);
    }
    if (cognitiveContext.attention) {
      sections.push(`[Attention Allocation]\n${JSON.stringify(cognitiveContext.attention, null, 2)}`);
    }
  }

  // ── 3. Tool usage instructions ──────────────────────────────────
  if (toolNames && toolNames.length > 0) {
    sections.push(`[Available Tools: ${toolNames.join(', ')}]`);
  }
  sections.push(TOOL_USAGE_INSTRUCTIONS);

  // ── 4. Plugin traits ────────────────────────────────────────────
  const traitsBlock = buildPluginTraitsBlock(selectedTraits, config);
  if (traitsBlock) {
    sections.push(traitsBlock);
  }

  // ── 5. Pre-routed file context ──────────────────────────────────
  if (preRouted && preRouted.length > 0) {
    const preRouteBlock = _buildPreRoutedBlock(preRouted, config);
    if (preRouteBlock) {
      sections.push(preRouteBlock);
    }
  }

  // ── 6. Surface update instructions ──────────────────────────────
  if (isSurfaceUpdate) {
    sections.push(SURFACE_UPDATE_INSTRUCTIONS);
  }

  // ── 7. Task context ─────────────────────────────────────────────
  if (taskContext) {
    const taskBlock = _buildTaskContextBlock(taskContext);
    if (taskBlock) {
      sections.push(taskBlock);
    }
  }

  // ── 8. Safety violations ────────────────────────────────────────
  if (violations && violations.length > 0) {
    let safetyBlock = '[Safety Warnings]';
    for (const v of violations) {
      const name = v.constraint?.name || v.name || 'Unknown';
      const desc = v.constraint?.description || v.description || v.message || '';
      safetyBlock += `\n- ${name}: ${desc}`;
    }
    sections.push(safetyBlock);
  }

  // ── 9. Planning hint ────────────────────────────────────────────
  // Only on first turn for complex inputs
  if (classifyInputComplexity(input) === 'complex') {
    sections.push('[PLANNING HINT]: This is a complex multi-step request. Start by using the add_tasks tool to create a structured plan before executing. Break the work into clear, sequential tasks.');
  }

  // ── Conversation history ────────────────────────────────────────
  if (history && history.length > 0) {
    const historyBlock = _buildHistoryBlock(history, config);
    if (historyBlock) {
      sections.push(historyBlock);
    }
  }

  // ── View compilation (Phase 2: Confidentiality) ─────────────────
  // When a viewCompiler and agentProfile are provided, each section
  // is compiled through the confidentiality pipeline. This redacts,
  // masks, or blocks sensitive content before the LLM sees it.
  if (viewCompiler && agentProfile) {
    const compiledSections = sections.map((section, idx) => {
      // Skip tool usage instructions and planning hints — these are
      // static system content, not user data, so they're never sensitive.
      if (section === TOOL_USAGE_INSTRUCTIONS || section === SURFACE_UPDATE_INSTRUCTIONS) {
        return section;
      }
      const result = viewCompiler.compileString(
        section,
        'system-prompt',
        agentProfile,
      );
      return result.content;
    });
    return compiledSections.join('\n\n');
  }

  return sections.join('\n\n');
}

// ════════════════════════════════════════════════════════════════════════
// buildContinuationPrompt
// ════════════════════════════════════════════════════════════════════════

/**
 * Build a continuation nudge prompt when the AI announced intent without acting.
 *
 * Ported from {@link src/core/agentic/cognitive/agent-continuation.mjs} lines 42–65.
 *
 * @param {Object} options
 * @param {string}  options.responseText       — AI's incomplete response text
 * @param {Array}   [options.priorToolCalls]   — tool calls executed so far
 * @param {number}  [options.continuation]     — current continuation number
 * @param {number}  [options.maxContinuations] — max continuations allowed
 * @returns {string} — continuation prompt
 */
export function buildContinuationPrompt(options = {}) {
  const {
    responseText = '',
    priorToolCalls = [],
    continuation = 1,
    maxContinuations = 5,
  } = options;

  // Build prior tool summary
  let priorToolSummary = '';
  if (priorToolCalls.length > 0) {
    priorToolSummary = '\nTools already executed in this turn:\n' +
      priorToolCalls.map((tc) => {
        const res = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result);
        return `- ${tc.name}: ${(res || '').substring(0, 200)}`;
      }).join('\n') + '\n\n';
  }

  const trimmedResponse = responseText.trim().substring(0, 500);

  return (
    `You just said: "${trimmedResponse}"\n\n` +
    priorToolSummary +
    `You described what you intend to do but did NOT actually do it. ` +
    `You MUST now take action by calling the appropriate tools (e.g. write_file, run_command, etc.) ` +
    `to complete the task. Do NOT just describe what you will do — actually do it now using tool calls.`
  );
}

// ════════════════════════════════════════════════════════════════════════
// buildTurnPrompt
// ════════════════════════════════════════════════════════════════════════

/**
 * Build the user prompt for a specific turn in the multi-turn loop.
 *
 * - Turn 1: returns input with planning hint if complex.
 * - Turn 2+: builds context-aware continuation with task state.
 *
 * Ported from {@link src/core/eventic-agent-loop-plugin.mjs} lines 244–332.
 *
 * @param {Object} options
 * @param {string}  options.input           — original user input
 * @param {number}  options.turnNumber      — current turn (1-based)
 * @param {number}  options.maxTurns        — maximum turns allowed
 * @param {Object}  [options.taskContext]   — { tasks, completedTasks }
 * @param {boolean} [options.isSurfaceUpdate] — whether this targets a surface
 * @param {string}  [options.guidance]      — evaluation guidance from prior tools
 * @param {string}  [options.systemPrompt]  — system prompt (for persona detection)
 * @returns {string} — the user prompt for this turn
 */
export function buildTurnPrompt(options = {}) {
  const {
    input = '',
    turnNumber = 1,
    maxTurns = 25,
    taskContext,
    isSurfaceUpdate = false,
    guidance,
    systemPrompt,
  } = options;

  let prompt;

  if (turnNumber === 1) {
    // ── First turn: raw input + optional hints ────────────────────
    prompt = input;

    if (classifyInputComplexity(input) === 'complex') {
      prompt += PLANNING_HINT;
    }

    if (isSurfaceUpdate) {
      prompt += '\n\n' + SURFACE_UPDATE_INSTRUCTIONS;
    }
  } else {
    // ── Continuation turns: context-aware prompt ──────────────────
    const parts = [];

    parts.push(`[ORIGINAL TASK]: ${input}`);
    parts.push(`[TURN ${turnNumber}/${maxTurns}]`);
    parts.push('');

    // Persona reminder
    if (systemPrompt) {
      const lower = systemPrompt.toLowerCase();
      if (lower.includes('persona') || lower.includes('you are') || lower.includes('your name')) {
        parts.push('[PERSONA]: Stay in character as defined in your system prompt.');
        parts.push('');
      }
    }

    // Completed tasks
    const completedTasks = taskContext?.completedTasks || [];
    if (completedTasks.length > 0) {
      parts.push('[COMPLETED TASKS]:');
      for (const task of completedTasks) {
        const icon = task.status === 'failed' ? '❌' : '✅';
        parts.push(`  ${icon} ${task.description}: ${task.result || 'No result recorded'}`);
      }
      parts.push('');
    }

    // Pending/running tasks
    const tasks = taskContext?.tasks || [];
    if (tasks.length > 0) {
      parts.push('[CURRENT TASKS]:');
      for (const task of tasks) {
        const desc = typeof task === 'string' ? task : task.description;
        const status = typeof task === 'string' ? 'pending' : task.status;
        parts.push(`  ⏳ ${desc} (${status})`);
      }
      parts.push('');

      const currentTask = tasks[0];
      if (currentTask) {
        const desc = typeof currentTask === 'string' ? currentTask : currentTask.description;
        const result = typeof currentTask === 'string' ? null : currentTask.result;
        parts.push(`Please focus on completing the next pending task: "${desc}".`);
        if (result) {
          parts.push(`Recent result for this task: ${result}`);
        }
      }
    } else {
      parts.push('Review the tool results in your conversation history above. If there are no pending tasks, formulate a plan by creating a list of tasks. Otherwise, continue working on the original task.');
    }

    prompt = parts.join('\n');
  }

  // Prepend guidance if present
  if (guidance) {
    prompt = `[GUIDANCE]: ${guidance}\n\n${prompt}`;
  }

  return prompt;
}

// ════════════════════════════════════════════════════════════════════════
// selectRelevantTraits
// ════════════════════════════════════════════════════════════════════════

/**
 * Select which plugin traits are relevant to the current user input.
 * Uses fast keyword matching first; falls back to returning all traits
 * when keyword matching produces too few results.
 *
 * Ported from {@link src/core/agentic/cognitive/agent-preroute.mjs}
 * `selectRelevantTraits()` and `matchTraitsByKeyword()`.
 *
 * @param {string} input     — user message
 * @param {Array<{name: string, trait: string}>} allTraits — all active plugin traits
 * @param {Object} [config]  — unified config (routing section)
 * @returns {Array<{name: string, trait: string}>} — filtered traits
 */
export function selectRelevantTraits(input, allTraits, config = {}) {
  if (!allTraits || allTraits.length === 0) return [];

  const routing = config.routing || {};

  // Allow trait routing to be disabled
  if (routing.traitRoutingEnabled === false) return allTraits;

  // Skip routing for very few plugins — not worth the overhead
  const minPlugins = routing.minPluginsForTraitRouting ?? 5;
  if (allTraits.length <= minPlugins) return allTraits;

  // ── Keyword-based fast routing ──────────────────────────────────
  const keywordMatched = matchTraitsByKeyword(input, allTraits);
  if (keywordMatched.length > 0) {
    // Merge in always-include plugins
    const alwaysInclude = routing.alwaysIncludePlugins || [];
    if (alwaysInclude.length > 0) {
      const matchedNames = new Set(keywordMatched.map((t) => t.name.toLowerCase()));
      const alwaysSet = new Set(alwaysInclude.map((n) => String(n).toLowerCase()));
      const missing = allTraits.filter(
        (t) => alwaysSet.has(t.name.toLowerCase()) && !matchedNames.has(t.name.toLowerCase()),
      );
      keywordMatched.push(...missing);
    }
    return keywordMatched;
  }

  // No keyword matches — return all traits as safe fallback
  // (LLM-based routing omitted here; can be added as an async variant)
  return allTraits;
}

/**
 * Match plugin traits by keyword similarity to user input.
 * Splits user input into words and checks against plugin names and trait text.
 *
 * Ported from {@link src/core/agentic/cognitive/agent-preroute.mjs} `matchTraitsByKeyword()`.
 *
 * @param {string} userInput
 * @param {Array<{name: string, trait: string}>} allTraits
 * @returns {Array<{name: string, trait: string}>}
 */
export function matchTraitsByKeyword(userInput, allTraits) {
  const inputWords = userInput
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (inputWords.length === 0) return [];

  const scored = allTraits.map((t) => {
    const searchText = `${t.name} ${t.trait}`.toLowerCase();
    let score = 0;
    for (const word of inputWords) {
      if (searchText.includes(word)) score++;
    }
    // Boost for plugin name match — name is a strong signal
    if (inputWords.some((w) => t.name.toLowerCase().includes(w))) score += 2;
    return { trait: t, score };
  });

  // Filter to plugins with at least 1 keyword hit
  const matched = scored.filter((s) => s.score > 0).map((s) => s.trait);

  // If too few matched (< 2), return empty to trigger fallback
  if (matched.length < 2 && allTraits.length > 5) return [];

  return matched;
}

// ════════════════════════════════════════════════════════════════════════
// buildPluginTraitsBlock
// ════════════════════════════════════════════════════════════════════════

/**
 * Build the [Plugin Capabilities] block from a selected list of traits.
 *
 * Only includes the selected traits, not all active plugins.
 * Groups by plugin name with truncation per the configured max length.
 *
 * Ported from {@link src/core/agentic/cognitive/agent-prompt.mjs} `buildPluginTraitsBlock()`.
 *
 * @param {Array<{name: string, trait: string}>} [selectedTraits] — pre-filtered traits
 * @param {Object} [config] — unified config
 * @returns {string} — formatted traits block, or empty string
 */
export function buildPluginTraitsBlock(selectedTraits, config = {}) {
  if (!selectedTraits || selectedTraits.length === 0) return '';

  const maxTraitLen = config.routing?.maxTraitLength ?? 150;
  let block = '[Plugin Capabilities]';

  for (const { name, trait } of selectedTraits) {
    const truncated = trait.length > maxTraitLen
      ? trait.substring(0, maxTraitLen) + '…'
      : trait;
    block += `\n- ${name}: ${truncated}`;
  }

  return block;
}

// ════════════════════════════════════════════════════════════════════════
// Private Helpers
// ════════════════════════════════════════════════════════════════════════

/**
 * Build the pre-routed file/resource context block.
 *
 * Ported from {@link src/core/agentic/cognitive/agent-prompt.mjs} lines 83–111.
 *
 * @private
 * @param {Array} preRouted — pre-routed auto-fetch results
 * @param {Object} config   — unified config
 * @returns {string|null}   — formatted block or null
 */
function _buildPreRoutedBlock(preRouted, config = {}) {
  let toolContext = preRouted.map((r) => {
    if (r.tool === 'read_file' && r.content) {
      return `[FILE CONTENT: ${r.path}]\n\`\`\`\n${r.content}\n\`\`\``;
    } else if (r.tool === 'read_file' && r.error) {
      return `[FILE ERROR: ${r.path}]: ${r.error}`;
    } else if (r.tool === 'list_files') {
      const files = Array.isArray(r.files)
        ? r.files.map((f) => (typeof f === 'string' ? f : f.name)).join(', ')
        : JSON.stringify(r.files);
      return `[FILES IN ${r.path}]: ${files}`;
    } else if (r.tool === 'cognitive_state') {
      return `[YOUR COGNITIVE STATE]:\n${JSON.stringify(r.state, null, 2)}`;
    }
    return '';
  }).filter(Boolean).join('\n\n');

  if (!toolContext) return null;

  // Cap pre-routed data to prevent blowing the context window.
  // Allocate 30% of available context tokens for pre-routed data.
  const maxTokens = config.compaction?.maxContextTokens || 128000;
  const reserveTokens = config.compaction?.reserveTokens || 4096;
  const preRouteBudgetFraction = config.routing?.preRouteBudgetFraction ?? 0.3;
  const maxPreRouteChars = Math.floor((maxTokens - reserveTokens) * preRouteBudgetFraction * 4);

  if (toolContext.length > maxPreRouteChars) {
    toolContext = toolContext.substring(0, maxPreRouteChars) + '\n\n[...data truncated to fit context window]';
  }

  return (
    'The following data has been retrieved for you. You MUST analyze this data carefully ' +
    'to answer the user\'s question. Reference specific details from the data in your response.\n\n' +
    toolContext +
    '\n\nIMPORTANT: Base your answer on the actual data above. Do NOT make up information or ' +
    'describe things in general terms — cite specific code, values, thresholds, function names, ' +
    'or state values from the retrieved data.'
  );
}

/**
 * Build the task context block showing completed and pending tasks.
 *
 * Ported from {@link src/core/eventic-agent-loop-plugin.mjs} lines 282–332.
 *
 * @private
 * @param {Object} taskContext
 * @param {Array}  taskContext.tasks          — pending/running tasks
 * @param {Array}  taskContext.completedTasks — completed tasks
 * @returns {string|null} — formatted block or null
 */
function _buildTaskContextBlock(taskContext) {
  const { tasks = [], completedTasks = [] } = taskContext;
  if (tasks.length === 0 && completedTasks.length === 0) return null;

  const parts = [];

  if (completedTasks.length > 0) {
    parts.push('[COMPLETED TASKS]:');
    for (const task of completedTasks) {
      const icon = task.status === 'failed' ? '❌' : '✅';
      parts.push(`  ${icon} ${task.description}: ${task.result || 'No result recorded'}`);
    }
    parts.push('');
  }

  if (tasks.length > 0) {
    parts.push('[CURRENT TASKS]:');
    for (const task of tasks) {
      const desc = typeof task === 'string' ? task : task.description;
      const status = typeof task === 'string' ? 'pending' : task.status;
      parts.push(`  ⏳ ${desc} (${status})`);
    }
    parts.push('');

    const currentTask = tasks[0];
    if (currentTask) {
      const desc = typeof currentTask === 'string' ? currentTask : currentTask.description;
      parts.push(`Focus on completing the next pending task: "${desc}".`);
    }
  }

  return parts.join('\n');
}

/**
 * Build a conversation history block for system prompt injection.
 * Truncates to fit within the configured token budget.
 *
 * @private
 * @param {Array<{role: string, content: string}>} history — message history
 * @param {Object} config — unified config
 * @returns {string|null} — formatted block or null
 */
function _buildHistoryBlock(history, config = {}) {
  if (!history || history.length === 0) return null;

  const maxHistoryChars = (config.compaction?.historyBudgetTokens || 4096) * 4;
  let block = '[Conversation History]';
  let charCount = block.length;

  // Include most recent messages first (reversed), then re-reverse
  const recent = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const content = msg.content || '';
    const line = `\n${msg.role}: ${content}`;
    if (charCount + line.length > maxHistoryChars) break;
    charCount += line.length;
    recent.unshift(line);
  }

  if (recent.length === 0) return null;

  return block + recent.join('');
}
