/**
 * ToolExecutorBridge — unified tool execution bridge that merges the
 * Cognitive agent's tool bridge with Eventic's tool handler into a single
 * component for the UnifiedProvider.
 *
 * Responsibilities:
 *  - Expose available tools (engine tools + dynamic task tools)
 *  - Convert tool definitions to lmscript format
 *  - Execute individual tools with status reporting
 *  - Execute tool batches with abort checking
 *  - Evaluate tool results for guidance
 *  - Manage internal task state (add/complete/fail tasks)
 *
 * Ports logic from:
 *  - {@link src/core/agent-loop-tool-handler.mjs} — dynamic task tools, __directMarkdown, truncation
 *  - {@link src/core/agentic/cognitive/agent-helpers.mjs} — lmscript format, executeTool dispatch
 *  - {@link src/core/agent-loop-helpers.mjs} — TASK_TOOLS, hasToolError, evaluateToolResults
 *
 * @module src/core/agentic/unified/tool-executor-bridge
 */

import { describeToolCall } from '../../status-reporter.mjs';
import { TASK_TOOLS, hasToolError, evaluateToolResults } from '../../agent-loop-helpers.mjs';
import { sanitizeDirectMarkdown } from '../../../lib/sanitize-markdown.mjs';
import { isCancellationError } from '../../ai-provider.mjs';

// ════════════════════════════════════════════════════════════════════════
// Surface Pipeline Constants
// ════════════════════════════════════════════════════════════════════════

/**
 * Tools that modify surface content and should route through the
 * SurfacePipeline for verified, gated execution.
 * @type {Set<string>}
 */
const SURFACE_MUTATION_TOOLS = new Set([
  'update_surface_component',
]);

// ════════════════════════════════════════════════════════════════════════
// ToolExecutorBridge Class
// ════════════════════════════════════════════════════════════════════════

/**
 * Unified tool execution bridge combining Cognitive and Eventic patterns.
 *
 * Bridges the ai-man ToolExecutor and Eventic engine tool registry to
 * provide a single interface for tool discovery, execution, and
 * result evaluation.
 */
export class ToolExecutorBridge {
  /**
   * @param {Object} options
   * @param {Object}  options.toolExecutor    — ai-man ToolExecutor instance
   * @param {Object}  options.engine          — Eventic engine (engine.tools, engine.getAvailableTools)
   * @param {import('./stream-controller.mjs').StreamController} options.streamController — streaming controller for status/commentary
   * @param {Object}  options.config          — unified config object
   */
  constructor({ toolExecutor, engine, streamController, config }) {
    /** @private */
    this._toolExecutor = toolExecutor || null;
    /** @private */
    this._engine = engine || null;
    /** @private */
    this._stream = streamController;
    /** @private */
    this._config = config || {};

    // ── Task management state ──────────────────────────────────────
    /** @private @type {Array<{description: string, status: string, result?: string}>} */
    this._tasks = [];
    /** @private @type {Array<{description: string, status: string, result?: string}>} */
    this._completedTasks = [];

    // ── Accumulated direct-markdown blocks ─────────────────────────
    /** @private @type {string[]} */
    this._directMarkdownBlocks = [];

    // ── Counters ──────────────────────────────────────────────────
    /** @private */
    this._toolCallCount = 0;

    // ── Surface pipeline (optional — set via setSurfacePipeline) ──
    /** @private @type {import('../../../surfaces/surface-pipeline.mjs').SurfacePipeline|null} */
    this._surfacePipeline = null;
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
   * Attach the SurfacePipeline so that surface mutation tools
   * automatically route through the verified 5-gate pipeline.
   *
   * @param {import('../../../surfaces/surface-pipeline.mjs').SurfacePipeline} pipeline
   */
  setSurfacePipeline(pipeline) {
    this._surfacePipeline = pipeline;
  }

  // ════════════════════════════════════════════════════════════════════
  // Task context accessor
  // ════════════════════════════════════════════════════════════════════

  /**
   * Return current task management state for prompt building.
   * @returns {{ tasks: Array, completedTasks: Array }}
   */
  get taskContext() {
    return {
      tasks: this._tasks,
      completedTasks: this._completedTasks,
    };
  }

  /**
   * Return accumulated __directMarkdown blocks from tool results.
   * @returns {string[]}
   */
  get directMarkdownBlocks() {
    return this._directMarkdownBlocks;
  }

  /**
   * Reset direct-markdown accumulator between turns.
   */
  clearDirectMarkdownBlocks() {
    this._directMarkdownBlocks = [];
  }

  // ════════════════════════════════════════════════════════════════════
  // Tool Discovery
  // ════════════════════════════════════════════════════════════════════

  /**
   * Get available tool definitions in OpenAI function-calling format.
   *
   * Combines tools from:
   *  1. Eventic engine (`engine.getAvailableTools()`)
   *  2. Dynamic task tools (add_tasks, complete_current_task, fail_current_task)
   *
   * @returns {Array<{type: string, function: {name: string, description: string, parameters: Object}}>}
   */
  getAvailableTools() {
    let tools = [];

    // Pull tools from the Eventic engine if available
    if (this._engine && typeof this._engine.getAvailableTools === 'function') {
      try {
        tools = [...this._engine.getAvailableTools()];
      } catch {
        // Fallback: try ToolExecutor's getAllToolDefinitions
        if (this._toolExecutor && typeof this._toolExecutor.getAllToolDefinitions === 'function') {
          tools = [...this._toolExecutor.getAllToolDefinitions()];
        }
      }
    } else if (this._toolExecutor && typeof this._toolExecutor.getAllToolDefinitions === 'function') {
      tools = [...this._toolExecutor.getAllToolDefinitions()];
    }

    // Add dynamic task tools — ported from eventic-agent-loop-plugin.mjs
    tools = [...tools, ...TASK_TOOLS];

    return tools;
  }

  /**
   * Return a map of raw tool handlers keyed by tool name.
   * Used by pre-routing logic that needs direct tool invocation before the
   * main agent loop has asked the model to plan a tool call.
   *
   * @returns {Map<string, Function>}
   */
  getToolMap() {
    if (this._engine?.tools instanceof Map) {
      return this._engine.tools;
    }

    const toolMap = new Map();
    for (const def of this.getAvailableTools()) {
      const fn = def.function || def;
      const name = fn?.name;
      if (!name || toolMap.has(name)) continue;
      const handler = this._toolExecutor?.getToolFunction?.(name);
      if (handler) {
        toolMap.set(name, handler);
      }
    }
    return toolMap;
  }

  // ════════════════════════════════════════════════════════════════════
  // lmscript Format Conversion
  // ════════════════════════════════════════════════════════════════════

  /**
   * Convert tool definitions to lmscript ToolDefinition format.
   *
   * Each tool becomes an object with:
   *  - `name` — function name
   *  - `description` — human-readable description
   *  - `parameters` — JSON Schema object with properties and required
   *  - `execute` — async function wrapping {@link executeTool}
   *
   * Ported from {@link src/core/agentic/cognitive/agent-helpers.mjs} `getLmscriptTools()`.
   *
   * @param {Array} [tools] — tool definitions; defaults to getAvailableTools()
   * @returns {Array<{name: string, description: string, parameters: Object, execute: Function}>}
   */
  toLmscriptFormat(tools) {
    const defs = tools || this.getAvailableTools();

    return defs.map((def) => {
      const fn = def.function || def;
      const name = fn.name;
      const description = fn.description || '';
      const parameters = fn.parameters || { type: 'object', properties: {}, required: [] };

      return {
        name,
        description,
        parameters,
        execute: async (args) => {
          const result = await this.executeTool(name, args);
          return result.content;
        },
      };
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // Single Tool Execution
  // ════════════════════════════════════════════════════════════════════

  /**
   * Execute a single tool with status reporting.
   *
   * Handles:
   *  - Dynamic task tools internally (add_tasks, complete_current_task, fail_current_task)
   *  - Regular tools via engine.tools.get() or ToolExecutor
   *  - __directMarkdown pattern for visual widgets
   *  - Result truncation for excessively large outputs (>8000 chars)
   *
   * Ported from {@link src/core/agent-loop-tool-handler.mjs} lines 79–234.
   *
   * @param {string} name    — tool function name
   * @param {Object} args    — parsed tool arguments
   * @param {Object} [options]
   * @param {AbortSignal} [options.signal] — abort signal
   * @param {number}      [options.index]  — 0-based index in batch
   * @param {number}      [options.total]  — total tools in batch
   * @returns {Promise<{content: string, success: boolean}>}
   */
  async executeTool(name, args, options = {}) {
    const { signal, index = 0, total = 1 } = options;

    // Emit tool start status
    this._stream.toolStart(name, args || {}, index, total);

    let resultText = '';
    let success = true;

    // ── Parse args if string ────────────────────────────────────────
    let parsedArgs = args;
    if (typeof args === 'string') {
      const trimmed = args.trim();
      if (!trimmed) {
        parsedArgs = {};
      } else {
        try {
          parsedArgs = JSON.parse(trimmed);
        } catch (e) {
          this._stream.toolComplete(name, false);
          return {
            content: `Error: Malformed JSON in tool arguments — ${e.message}. Please retry with valid JSON.`,
            success: false,
          };
        }
      }
    }

    // ── Surface pipeline interceptor ────────────────────────────────
    // When a SurfacePipeline is attached and the tool is a surface
    // mutation tool, route through the verified 5-gate pipeline instead
    // of the normal execution path.
    if (this._surfacePipeline && SURFACE_MUTATION_TOOLS.has(name)) {
      return this._executeSurfaceMutation(name, parsedArgs, options);
    }

    // ── Dynamic task tools ──────────────────────────────────────────
    // Ported from agent-loop-tool-handler.mjs lines 80–128
    if (name === 'add_tasks') {
      const tasksToAdd = Array.isArray(parsedArgs.tasks) ? parsedArgs.tasks : [parsedArgs.tasks];
      this._tasks = [...this._tasks, ...tasksToAdd.map((t) => ({ description: t, status: 'pending' }))];
      resultText = `Added ${tasksToAdd.length} tasks to the plan.`;
    } else if (name === 'complete_current_task') {
      if (this._tasks.length > 0) {
        const completed = this._tasks.shift();
        completed.status = 'completed';
        completed.result = parsedArgs.result || 'Task completed successfully.';
        this._completedTasks.push(completed);
        resultText = 'Task marked as completed. Moved to completed list.';
      } else {
        resultText = 'Error: No current task to complete.';
        success = false;
      }
    } else if (name === 'fail_current_task') {
      if (this._tasks.length > 0) {
        const failed = this._tasks.shift();
        failed.status = 'failed';
        failed.result = parsedArgs.reason || 'Task failed.';
        this._completedTasks.push(failed);
        resultText = 'Task marked as failed. Moved to completed list.';
      } else {
        resultText = 'Error: No current task to fail.';
        success = false;
      }
    } else {
      // ── Regular tool execution ──────────────────────────────────
      let toolFunction = null;

      // Try engine.tools first
      if (this._engine && this._engine.tools && typeof this._engine.tools.get === 'function') {
        toolFunction = this._engine.tools.get(name);
      }

      if (toolFunction) {
        try {
          let rawResult = await toolFunction(parsedArgs, { signal });

          // Handle __directMarkdown pattern
          // Ported from agent-loop-tool-handler.mjs lines 146–157
          if (rawResult && typeof rawResult === 'object' && rawResult.__directMarkdown) {
            const mdBlock = sanitizeDirectMarkdown(rawResult.__directMarkdown);
            rawResult = mdBlock;
            this._directMarkdownBlocks.push(mdBlock);
          }

          resultText = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
        } catch (e) {
          success = false;
          if (isCancellationError(e) || (signal && signal.aborted)) {
            resultText = 'Error: Tool execution cancelled by user.';
          } else {
            resultText = `Error: ${e.message}`;
          }
        }
      } else if (this._toolExecutor && typeof this._toolExecutor.executeTool === 'function') {
        // Fallback: delegate to ai-man's ToolExecutor
        try {
          const toolCall = {
            id: `unified_${Date.now()}_${name}`,
            function: { name, arguments: JSON.stringify(parsedArgs) },
          };
          const result = await this._toolExecutor.executeTool(toolCall);
          resultText = result?.content || '';
          if (hasToolError(resultText)) {
            success = false;
          }
        } catch (e) {
          success = false;
          if (isCancellationError(e) || (signal && signal.aborted)) {
            resultText = 'Error: Tool execution cancelled by user.';
          } else {
            resultText = `Error: ${e.message}`;
          }
        }
      } else {
        resultText = `Error: Unknown tool: ${name}`;
        success = false;
      }
    }

    // ── Truncate excessively large results ─────────────────────────
    // Ported from agent-loop-tool-handler.mjs lines 212–234
    resultText = this._truncateResult(resultText, name);

    // ── Update running task context ────────────────────────────────
    if (this._tasks.length > 0) {
      let currentTask = this._tasks[0];
      if (typeof currentTask === 'string') {
        currentTask = { description: currentTask, status: 'running' };
        this._tasks[0] = currentTask;
      }
      currentTask.status = 'running';
      const isError = hasToolError(resultText);
      currentTask.result = `${isError ? '❌ Error in' : '✅'} ${name}: ${resultText.substring(0, 100)}${resultText.length > 100 ? '...' : ''}`;
    }

    this._toolCallCount++;

    // Emit tool complete status
    this._stream.toolComplete(name, success);

    return { content: resultText, success };
  }

  // ════════════════════════════════════════════════════════════════════
  // Batch Tool Execution
  // ════════════════════════════════════════════════════════════════════

  /**
   * Execute multiple tool calls in sequence with abort checking.
   *
   * @param {Array<{id: string, function: {name: string, arguments: string|Object}}>} toolCalls
   * @param {Object} [options]
   * @param {AbortSignal} [options.signal] — abort signal
   * @returns {Promise<{results: Array<{role: string, tool_call_id: string, name: string, content: string}>, hasErrors: boolean}>}
   */
  async executeToolBatch(toolCalls, options = {}) {
    const { signal, turnId } = options;

    // Propagate turnId to the underlying ToolExecutor so that the VM cache
    // key remains stable across all tool calls within a single iteration.
    if (turnId && this._toolExecutor && typeof this._toolExecutor === 'object') {
      this._toolExecutor.turnId = turnId;
    }
    const results = [];
    let hasErrors = false;

    for (let i = 0; i < toolCalls.length; i++) {
      // Check abort before each tool
      if (signal && signal.aborted) {
        break;
      }

      const toolCall = toolCalls[i];
      const functionName = toolCall.function.name;

      // Parse arguments
      let args = toolCall.function.arguments;
      if (typeof args === 'string') {
        const trimmed = args.trim();
        if (!trimmed) {
          args = {};
        } else {
          try {
            args = JSON.parse(trimmed);
          } catch (e) {
            results.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: functionName,
              content: `Error: Malformed JSON in tool arguments — ${e.message}. Please retry with valid JSON.`,
            });
            hasErrors = true;
            continue;
          }
        }
      }

      const { content, success } = await this.executeTool(functionName, args, {
        signal,
        index: i,
        total: toolCalls.length,
      });

      if (!success) hasErrors = true;

      const resultEntry = {
        role: 'tool',
        tool_call_id: toolCall.id,
        name: functionName,
        content,
      };

      // Tag surface mutation results so the agent loop can detect them
      // without fragile string matching on the content text.
      if (SURFACE_MUTATION_TOOLS.has(functionName)) {
        resultEntry._isSurfaceMutation = true;
        resultEntry._surfaceSuccess = success;
      }

      results.push(resultEntry);
    }

    // Emit round-complete narrative
    this._stream.toolRoundComplete(results);

    return { results, hasErrors };
  }

  // ════════════════════════════════════════════════════════════════════
  // Tool Result Evaluation
  // ════════════════════════════════════════════════════════════════════

  /**
   * Evaluate tool results inline and return guidance string or null.
   *
   * Ported from {@link src/core/agent-loop-helpers.mjs} `evaluateToolResults()`.
   * Creates a lightweight context object matching the expected shape.
   *
   * @param {string[]} toolNames — names of tools that were executed
   * @param {Array<{content: string, name: string}>} results — tool result entries
   * @param {Object} [evalContext] — optional context overrides
   * @param {number} [evalContext.turnNumber]
   * @param {number} [evalContext.maxTurns]
   * @returns {string|null} — guidance string or null if no guidance needed
   */
  evaluateToolResults(toolNames, results, evalContext = {}) {
    // Build a minimal ctx matching the shape expected by evaluateToolResults
    const ctx = {
      toolCallCount: this._toolCallCount,
      turnNumber: evalContext.turnNumber || 1,
      maxTurns: evalContext.maxTurns || 25,
    };
    return evaluateToolResults(ctx, toolNames, results);
  }

  // ════════════════════════════════════════════════════════════════════
  // Surface Pipeline Execution
  // ════════════════════════════════════════════════════════════════════

  /**
   * Execute a surface mutation through the verified 5-gate pipeline.
   *
   * This method:
   *  1. Builds the mutation descriptor from the tool call arguments
   *  2. Delegates to SurfacePipeline.executeMutation()
   *  3. Formats the SurfaceMutationResult into agent-readable text
   *  4. Includes gate pass/fail status, screenshot analysis, fix guidance
   *
   * The pipeline handles: validate → snapshot → mutate → render-verify → visual-verify
   * On failure, the pipeline auto-reverts and returns fix guidance.
   *
   * @private
   * @param {string} toolName — the surface mutation tool name
   * @param {Object} args — parsed tool arguments
   * @param {Object} [options]
   * @returns {Promise<{content: string, success: boolean}>}
   */
  async _executeSurfaceMutation(toolName, args, options = {}) {
    try {
      // Build mutation descriptor from tool arguments
      const mutation = {
        toolName,
        surface_id: args.surface_id || args.surfaceId,
        component_name: args.component_name || args.componentName || args.name,
        jsx_source: args.jsx_source || args.jsxSource || args.source || args.jsx,
        props: args.props,
        order: args.order,
        args, // preserve full args for the underlying tool
      };

      // Execute through the 5-gate pipeline
      const result = await this._surfacePipeline.executeMutation(mutation);

      // Format the result for the agent's context
      const formattedContent = this._formatSurfaceResult(result);
      const success = result.success;

      // Update counters and emit status
      this._toolCallCount++;
      this._stream.toolComplete(toolName, success);

      return { content: formattedContent, success };
    } catch (e) {
      // Pipeline itself threw — treat as infrastructure failure
      this._toolCallCount++;
      this._stream.toolComplete(toolName, false);

      return {
        content: [
          `❌ SURFACE PIPELINE ERROR — Infrastructure failure in ${toolName}:`,
          `Error: ${e.message}`,
          '',
          'The surface pipeline itself encountered an error. This is NOT a surface rendering issue.',
          'The original mutation was NOT applied. No revert is necessary.',
          'Please retry the tool call. If this persists, escalate to the user.',
        ].join('\n'),
        success: false,
      };
    }
  }

  /**
   * Format a SurfaceMutationResult into agent-readable text.
   *
   * Success results include:
   *  - Confirmation with gates passed
   *  - Visual verification summary
   *
   * Failure results include:
   *  - Which gate failed and why
   *  - Auto-revert status
   *  - Fix guidance with specific suggestions
   *  - Explicit instruction NOT to present the failed result to the user
   *
   * @private
   * @param {import('../../../surfaces/surface-mutation-result.mjs').SurfaceMutationResult} result
   * @returns {string}
   */
  _formatSurfaceResult(result) {
    // Use the built-in format() method from SurfaceMutationResult
    return result.format();
  }

  // ════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ════════════════════════════════════════════════════════════════════

  /**
   * Truncate excessively large tool results to prevent context bloat.
   *
   * Ported from {@link src/core/agent-loop-tool-handler.mjs} lines 212–234.
   *
   * Surface-reading tools (`read_surface`, `list_surfaces`) are exempt from
   * the standard 12K text truncation because the agent MUST see the full
   * component source code to fix or modify surfaces.  They still get base64
   * screenshot stripping to avoid truly massive payloads.  An upper safety
   * limit of 256KB is applied to prevent runaway context inflation.
   *
   * @private
   * @param {string} content — raw tool result
   * @param {string} [toolName] — name of the tool that produced this result
   * @returns {string} — truncated content
   */
  _truncateResult(content, toolName) {
    if (typeof content !== 'string' || content.length <= 8000) return content;

    // Surface tools need the full source code — use a much higher limit
    const isSurfaceRead = toolName === 'read_surface' || toolName === 'list_surfaces';
    const hardLimit = isSurfaceRead ? 256 * 1024 : 12000; // 256KB vs 12K

    // Try to detect and strip base64 image data from JSON tool output
    try {
      const parsed = JSON.parse(content);
      if (parsed && parsed.screenshot && typeof parsed.screenshot === 'string' && parsed.screenshot.length > 1000) {
        parsed.screenshot = '[screenshot captured and displayed to user — image data omitted from context to save tokens]';
        return JSON.stringify(parsed);
      }
    } catch {
      // Not JSON — truncate if over the limit
      if (content.length > hardLimit) {
        return content.substring(0, hardLimit) +
          '\n\n[... truncated — full result was ' + content.length + ' chars]';
      }
    }

    return content;
  }
}
