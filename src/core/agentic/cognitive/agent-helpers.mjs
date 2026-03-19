/**
 * agent-helpers.mjs — Utility and dispatch methods extracted from CognitiveAgent.
 *
 * Contains tool result formatting, fallback response building,
 * lmscript tool construction, legacy result adaptation, pre-routing,
 * and individual tool execution dispatch.
 *
 * Each function takes `agent` (CognitiveAgent instance) as the first parameter.
 *
 * @module src/core/agentic/cognitive/agent-helpers
 */

import { z } from 'zod';
import { emitStatus } from '../../status-reporter.mjs';
import { describeToolCall } from '../../status-reporter.mjs';
import { executeSentientTool, getSentientToolMetadata } from './agent-sentient.mjs';

// ════════════════════════════════════════════════════════════════════
// Tool result formatting
// ════════════════════════════════════════════════════════════════════

/**
 * Convert a tool name to a human-readable label.
 *
 * @param {string} name
 * @returns {string}
 */
export function humanizeToolName(name) {
  const map = {
    'read_file': 'Read file',
    'write_file': 'Write file',
    'write_to_file': 'Write file',
    'list_files': 'List files',
    'search_web': 'Web search',
    'search_files': 'Search files',
    'edit_file': 'Edit file',
    'apply_diff': 'Apply diff',
    'execute_command': 'Run command',
    'browse_open': 'Open browser',
    'read_many_files': 'Read files',
    'write_many_files': 'Write files',
    'firecrawl_scrape': 'Scrape webpage',
    'create_surface': 'Create surface',
    'update_surface_component': 'Update surface',
    'delete_file': 'Delete file',
    'cognitive_state': 'Check cognitive state',
    'recall_memory': 'Search memory',
    'sentient_introspect': 'Deep introspection',
    'sentient_adaptive_process': 'Adaptive processing',
    'sentient_set_goal': 'Set goal',
    'sentient_memory_search': 'SMF memory search',
    'sentient_evolution_snapshot': 'Evolution snapshot',
  };
  return map[name] || name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Summarize a single tool result as plain English.
 * Extracts meaningful content instead of dumping raw JSON.
 *
 * @param {string} toolName
 * @param {unknown} result
 * @returns {string}
 */
export function summarizeToolResult(toolName, result) {
  if (result == null) return 'completed';

  // String results — truncate and clean up
  if (typeof result === 'string') {
    const clean = result.trim();
    if (!clean) return 'completed (no output)';
    return clean.length > 300 ? clean.substring(0, 300) + '…' : clean;
  }

  // Object results — extract meaningful fields
  if (typeof result === 'object') {
    // Error results
    if (result.success === false || result.error) {
      return `failed: ${result.error || 'unknown error'}`;
    }

    // File read results
    if (result.content && typeof result.content === 'string') {
      const preview = result.content.substring(0, 200).trim();
      return `read ${result.content.length} characters${preview ? ': ' + preview + '…' : ''}`;
    }

    // File write results
    if (result.result && typeof result.result === 'string' && result.result.includes('wrote')) {
      return result.result;
    }

    // Search results
    if (Array.isArray(result.results)) {
      return `found ${result.results.length} result(s)`;
    }

    // List file results
    if (Array.isArray(result.files)) {
      return `found ${result.files.length} file(s)`;
    }

    // Summary field
    if (result.summary) {
      return typeof result.summary === 'string' ? result.summary : JSON.stringify(result.summary);
    }

    // Generic result field
    if (result.result && typeof result.result === 'string') {
      const r = result.result.trim();
      return r.length > 300 ? r.substring(0, 300) + '…' : r;
    }

    // Path/status fields
    if (result.path) {
      return `${result.success !== undefined ? (result.success ? 'success' : 'failed') : 'completed'}: ${result.path}`;
    }

    // Fallback: try to produce something readable
    const str = JSON.stringify(result);
    if (str.length <= 200) return str;
    // Extract key names as a summary
    const keys = Object.keys(result);
    return `completed (fields: ${keys.join(', ')})`;
  }

  return String(result);
}

/**
 * Build a human-readable fallback response from tool results.
 * Used as a last resort when LLM synthesis repeatedly returns empty.
 * Formats results as plain English instead of raw JSON.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {Array<{tool: string, result: unknown}>} toolResults
 * @returns {string}
 */
export function buildFallbackResponse(agent, toolResults) {
  if (!toolResults || toolResults.length === 0) {
    return 'The requested operations completed but produced no output.';
  }

  const parts = [`I completed ${toolResults.length} operation(s):\n`];

  for (const t of toolResults) {
    const summary = summarizeToolResult(t.tool, t.result);
    parts.push(`• **${humanizeToolName(t.tool)}** — ${summary}`);
  }

  return parts.join('\n');
}

// ════════════════════════════════════════════════════════════════════
// lmscript tool construction
// ════════════════════════════════════════════════════════════════════

/**
 * Extract tool call results from an lmscript AgentResult.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {import('@sschepis/lmscript').AgentResult} result
 * @returns {Array<{tool: string, result: unknown}>}
 */
export function extractToolResults(agent, result) {
  if (!result.toolCalls || result.toolCalls.length === 0) {
    return [];
  }
  return result.toolCalls.map(tc => ({
    tool: tc.name,
    result: tc.result
  }));
}

/**
 * Build lmscript ToolDefinition[] including both ToolBridge tools
 * and cognitive-specific tools (cognitive_state, recall_memory).
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @returns {Array<{name: string, description: string, parameters: import('zod').ZodType, execute: function}>}
 */
export function getLmscriptTools(agent) {
  // Get tools from ToolBridge (ai-man ToolExecutor → lmscript format)
  const bridgedTools = agent._toolBridge ? agent._toolBridge.toLmscriptTools() : [];

  // Add cognitive-specific tools in lmscript ToolDefinition format
  const cognitiveTools = [
    {
      name: 'cognitive_state',
      description: 'Get your current cognitive state including coherence, entropy, and oscillator synchronization',
      parameters: z.object({}),
      execute: () => {
        emitStatus('Inspecting cognitive state');
        agent._tracker.setActivity('Inspecting cognitive state');
        return { success: true, state: agent.cognitive.getDiagnostics() };
      }
    },
    {
      name: 'recall_memory',
      description: 'Search your holographic memory for relevant past interactions',
      parameters: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().optional().describe('Max results (default 5)')
      }),
      execute: (args) => {
        const query = args.query || '';
        emitStatus(`Searching memory: "${query.substring(0, 40)}"`);
        agent._tracker.setActivity(`Searching memory: "${query.substring(0, 40)}"`);
        const memories = agent.cognitive.recall(query, args.limit || 5);
        return {
          success: true,
          memories: memories.map(m => ({
            input: m.input,
            output: m.output,
            coherence: m.coherence,
            age: Date.now() - m.timestamp
          }))
        };
      }
    }
  ];

  // ── Sentient-specific tools (only when SentientCognitiveCore is active) ──
  if (agent._sentientEnabled) {
    const sentientDefs = getSentientToolMetadata();
    for (const def of sentientDefs) {
      cognitiveTools.push({
        name: def.name,
        description: def.description,
        parameters: def.zodSchema,
        execute: (args) => executeSentientTool(agent, def.name, args),
      });
    }
  }

  return [...bridgedTools, ...cognitiveTools];
}

// ════════════════════════════════════════════════════════════════════
// Tool execution dispatch
// ════════════════════════════════════════════════════════════════════

/**
 * Execute a tool call. Handles cognitive-specific tools internally,
 * delegates everything else to ai-man's ToolExecutor via its full
 * `executeTool()` pipeline (which dispatches to core, plugin, MCP,
 * and custom tools with proper security, timeout, and logging).
 *
 * Emits status for cognitive-specific tools (ToolExecutor already
 * emits status for delegated tools via emitToolStatus).
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {string} name
 * @param {object|string} args
 * @returns {Promise<object>}
 */
export async function executeTool(agent, name, args) {
  // Parse args if string
  let parsedArgs = args;
  if (typeof args === 'string') {
    try { parsedArgs = JSON.parse(args); } catch (_e) { parsedArgs = {}; }
  }

  // Handle cognitive-specific tools (with status emission)
  if (name === 'cognitive_state') {
    emitStatus('Inspecting cognitive state');
    agent._tracker.setActivity('Inspecting cognitive state');
    return { success: true, state: agent.cognitive.getDiagnostics() };
  }

  if (name === 'recall_memory') {
    const query = parsedArgs.query || '';
    emitStatus(`Searching memory: "${query.substring(0, 40)}"`);
    agent._tracker.setActivity(`Searching memory: "${query.substring(0, 40)}"`);
    const memories = agent.cognitive.recall(query, parsedArgs.limit || 5);
    return {
      success: true,
      memories: memories.map(m => ({
        input: m.input,
        output: m.output,
        coherence: m.coherence,
        age: Date.now() - m.timestamp
      }))
    };
  }

  // ── Sentient-specific tools ───────────────────────────────────────
  if (agent._sentientEnabled) {
    const sentientResult = executeSentientTool(agent, name, parsedArgs);
    if (sentientResult) return sentientResult;
  }

  // Delegate to ai-man's ToolExecutor via the full executeTool() pipeline.
  // This ensures plugin tools (browse_open, etc.), MCP tools, custom tools,
  // security checks, timeouts, and status reporting all work correctly.
  // Note: ToolExecutor.executeTool() already calls emitToolStatus() internally.
  if (agent.toolExecutor) {
    // Set tracker activity so heartbeat shows tool execution during long tools
    agent._tracker.setActivity(`Executing tool: ${describeToolCall(name, parsedArgs)}`, { phase: 'tool-exec' });
    try {
      const toolCall = {
        id: `cognitive_${Date.now()}_${name}`,
        function: {
          name,
          arguments: JSON.stringify(parsedArgs)
        }
      };
      const result = await agent.toolExecutor.executeTool(toolCall);
      // executeTool returns { role, tool_call_id, name, content }
      const content = result?.content || '';
      // Try to parse as JSON for structured results.
      // Preserve error indicators (success: false) so callers know it failed.
      try {
        const parsed = JSON.parse(content);
        if (parsed && parsed.success === false) {
          return { success: false, error: parsed.error || content };
        }
        return parsed;
      } catch {
        // Check for plain-text error strings from the executor
        if (content.startsWith('[error]') || content.startsWith('Error:')) {
          return { success: false, error: content };
        }
        return { result: content };
      }
    } catch (e) {
      return { success: false, error: `Tool execution error: ${e.message}` };
    }
  }

  return { success: false, error: `Unknown tool: ${name}` };
}

// ════════════════════════════════════════════════════════════════════
// Pre-routing
// ════════════════════════════════════════════════════════════════════

/**
 * Check whether a string looks like a real file path.
 *
 * @param {string} str
 * @returns {boolean}
 */
export function isLikelyFilePath(str) {
  if (str.includes('/')) return true;
  const ext = str.split('.').pop()?.toLowerCase();
  const knownExts = [
    'js','ts','json','md','txt','py','html','css','yml','yaml',
    'toml','xml','sh','jsx','tsx','mjs','cjs','env','cfg','ini',
    'log','csv',
  ];
  return knownExts.includes(ext);
}

/**
 * Pre-route: detect file/directory/cognitive queries and auto-fetch data.
 * Emits status for each auto-fetched resource so the operator knows
 * what data is being gathered before the LLM call.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {string} input
 * @param {Object} [options]
 * @returns {Promise<Array>}
 */
export async function preRoute(agent, input, options = {}) {
  const lower = input.toLowerCase();
  const results = [];
  const fetchedPaths = new Set();

  // Detect file read requests
  const filePatterns = [
    /read\s+(?:the\s+)?file\s+([^\s,]+)/i,
    /read\s+([a-zA-Z0-9_./-]+\.[a-zA-Z]+)/i,
    /(?:look at|examine|analyze|analyse|check|open|inspect|review)\s+(?:the\s+)?(?:file\s+)?([a-zA-Z0-9_./-]+\.[a-zA-Z]+)/i,
    /(?:contents?\s+of|what's\s+in)\s+([a-zA-Z0-9_./-]+\.[a-zA-Z]+)/i,
  ];

  for (const pattern of filePatterns) {
    const match = input.match(pattern);
    if (match && isLikelyFilePath(match[1]) && !fetchedPaths.has(match[1])) {
      const filePath = match[1];
      fetchedPaths.add(filePath);
      emitStatus(`Reading ${filePath}`);
      const result = await agent._executeTool('read_file', { path: filePath });
      if (result.success !== false) {
        results.push({ tool: 'read_file', path: filePath, content: (result.content || result.result || '').substring(0, 4000) });
      } else {
        results.push({ tool: 'read_file', path: filePath, error: result.error });
      }
    }
  }

  // Fallback: scan for path-like strings
  const pathRegex = /(?:^|\s)((?:[a-zA-Z0-9_.-]+\/)+[a-zA-Z0-9_.-]+\.[a-zA-Z]{1,5})(?:\s|$|[,;?!])/g;
  let pathMatch;
  while ((pathMatch = pathRegex.exec(input)) !== null) {
    const candidate = pathMatch[1];
    if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\//.test(candidate)) continue;
    if (isLikelyFilePath(candidate) && !fetchedPaths.has(candidate)) {
      fetchedPaths.add(candidate);
      emitStatus(`Reading ${candidate}`);
      const result = await agent._executeTool('read_file', { path: candidate });
      if (result.success !== false) {
        results.push({ tool: 'read_file', path: candidate, content: (result.content || result.result || '').substring(0, 4000) });
      } else {
        results.push({ tool: 'read_file', path: candidate, error: result.error });
      }
    }
  }

  // Detect cognitive state requests
  if (/cognitive\s+(?:state|diagnostics|health|metrics)/i.test(lower) ||
      /(?:your|my)\s+(?:coherence|entropy|oscillator)/i.test(lower) ||
      /introspect/i.test(lower) ||
      /(?:check|assess|diagnos)\w*\s+(?:your|my|own)\s+(?:cognitive|mental|health)/i.test(lower)) {
    emitStatus('Checking cognitive state');
    const result = await agent._executeTool('cognitive_state', {});
    if (result.success) {
      results.push({ tool: 'cognitive_state', state: result.state });
    }
  }

  return results;
}

// ════════════════════════════════════════════════════════════════════
// Legacy result adaptation
// ════════════════════════════════════════════════════════════════════

/**
 * Map a legacy turn result ({ response, metadata }) to the new return
 * format ({ response, toolResults, thoughts, … }).
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {{response: string, metadata: Object}} legacyResult
 * @returns {{response: string, toolResults: Array, thoughts: string|null, signature: string|null, diagnostics: Object, tokenUsage: Object|null}}
 */
export function adaptLegacyResult(agent, legacyResult) {
  const metadata = legacyResult.metadata || {};
  return {
    response: legacyResult.response,
    toolResults: (metadata.toolsUsed || []).map(name => ({ tool: name, result: null })),
    thoughts: null,
    signature: null,
    diagnostics: metadata,
    tokenUsage: null
  };
}
