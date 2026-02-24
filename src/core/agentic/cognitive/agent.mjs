/**
 * CognitiveAgent — orchestrator for the tinyaleph cognitive agentic system.
 *
 * Implements the 11-step cognitive agent loop:
 *  1. PERCEIVE  — BoundaryLayer processes input
 *  2. ENCODE    — Map text to primes
 *  3. ORIENT    — SMF updates
 *  4. ATTEND    — AgencyLayer allocates attention
 *  5. GUARD     — Safety check
 *  6. RECALL    — Holographic memory retrieval
 *  7. THINK     — LLM generates response
 *  8. EXECUTE   — Tool calls (up to maxToolRounds)
 *  9. VALIDATE  — ObjectivityGate
 * 10. REMEMBER  — Store in holographic memory
 * 11. EVOLVE    — Tick physics
 *
 * Adapted from tinyaleph apps/agentic/lib/agent.js for ai-man.
 * Key difference: uses ai-man's EventicAIProvider for LLM calls and
 * ai-man's ToolExecutor for tool execution, so all configured backends
 * and tools are available.
 *
 * @module src/core/agentic/cognitive/agent
 */

import { CognitiveCore } from './cognitive.mjs';
import { resolveCognitiveConfig } from './config.mjs';

/**
 * @typedef {Object} CognitiveAgentDeps
 * @property {import('../../eventic-ai-plugin.mjs').EventicAIProvider} aiProvider
 * @property {import('../../../execution/tool-executor.mjs').ToolExecutor} toolExecutor
 * @property {import('../../history-manager.mjs').HistoryManager} historyManager
 * @property {string} workingDir
 */

class CognitiveAgent {
  /**
   * @param {CognitiveAgentDeps} deps - Injected dependencies from ai-man
   * @param {Object} userConfig - Partial configuration overrides
   */
  constructor(deps, userConfig = {}) {
    this.config = resolveCognitiveConfig(userConfig);

    // Store ai-man dependencies
    this.aiProvider = deps.aiProvider;
    this.toolExecutor = deps.toolExecutor;
    this.historyManager = deps.historyManager;
    this.workingDir = deps.workingDir;

    // Initialize cognitive core
    this.cognitive = new CognitiveCore(this.config.cognitive);

    // Conversation history (internal to this agent)
    this.history = [];
    this.maxHistory = this.config.agent.maxHistory;

    // System prompt
    this.systemPrompt = this.config.agent.systemPrompt;

    // Stats
    this.turnCount = 0;
    this.totalTokens = 0;
  }

  /**
   * Process a single user turn through the full 11-step cognitive agent loop.
   *
   * @param {string} input - User message
   * @param {Object} options
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<{response: string, metadata: Object}>}
   */
  async turn(input, options = {}) {
    this.turnCount++;

    // ── Steps 1-4: Process input through cognitive core ────────────────
    const inputAnalysis = this.cognitive.processInput(input);

    // ── Step 5: Safety check ──────────────────────────────────────────
    const violations = this.cognitive.checkSafety();
    if (violations.some(v => v.constraint?.response === 'block')) {
      return {
        response: 'I need to pause — my cognitive state indicates unsafe conditions. Please try rephrasing.',
        metadata: { blocked: true, violations }
      };
    }

    // ── Step 6: Recall relevant memories ──────────────────────────────
    const memories = this.cognitive.recall(input, 3);

    // Build system prompt with cognitive state
    const stateContext = this.cognitive.getStateContext();
    let systemMessage = this.systemPrompt + '\n\n' + stateContext;

    // Append available tool names so the model knows what's at its disposal
    const toolDefs = this._getToolDefinitions();
    const toolNames = toolDefs.map(t => t.function.name).join(', ');
    systemMessage += `\n[Available Tools: ${toolNames}]\n`;

    if (memories.length > 0) {
      systemMessage += '\n[Relevant Past Interactions]\n';
      for (const mem of memories) {
        systemMessage += `- User: "${mem.input}" → Agent: "${mem.output}"\n`;
      }
    }

    if (violations.length > 0) {
      systemMessage += '\n[Safety Warnings]\n';
      for (const v of violations) {
        systemMessage += `- ${v.constraint?.name}: ${v.constraint?.description}\n`;
      }
    }

    // Add user message to internal history
    this.history.push({ role: 'user', content: input });

    // Trim history if needed
    while (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // ── Steps 7-8: LLM call with tool loop ────────────────────────────
    const messages = [
      { role: 'system', content: systemMessage },
      ...this.history
    ];

    // Pre-route: automatically fetch data the user is asking about
    const toolsUsed = [];
    const preRouted = await this._preRoute(input);
    if (preRouted.length > 0) {
      const toolContext = preRouted.map(r => {
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

      messages.push({
        role: 'system',
        content: `The following data has been retrieved for you. You MUST analyze this data carefully to answer the user's question. Reference specific details from the data in your response.\n\n${toolContext}\n\nIMPORTANT: Base your answer on the actual data above. Do NOT make up information or describe things in general terms — cite specific code, values, thresholds, function names, or state values from the retrieved data.`
      });

      toolsUsed.push(...preRouted.map(r => r.tool));
    }

    let response;
    let toolResults = [];
    let toolRounds = 0;

    try {
      // Initial LLM call via ai-man's EventicAIProvider
      response = await this._callLLM(messages, toolDefs, options);

      // Tool call loop
      while (
        response.toolCalls &&
        response.toolCalls.length > 0 &&
        toolRounds < this.config.agent.maxToolRounds
      ) {
        toolRounds++;

        for (const toolCall of response.toolCalls) {
          const result = await this._executeTool(
            toolCall.function.name,
            toolCall.function.arguments
          );
          toolResults.push({ tool: toolCall.function.name, result });

          // Add tool result to messages
          messages.push({
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: toolCall.id || `call_${toolRounds}_${toolCall.function.name}`,
              type: 'function',
              function: {
                name: toolCall.function.name,
                arguments: typeof toolCall.function.arguments === 'string'
                  ? toolCall.function.arguments
                  : JSON.stringify(toolCall.function.arguments)
              }
            }]
          });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id || `call_${toolRounds}_${toolCall.function.name}`,
            content: JSON.stringify(result)
          });
        }

        // Call LLM again with tool results
        response = await this._callLLM(messages, toolDefs, options);
      }
    } catch (e) {
      response = {
        content: `I encountered an error communicating with the LLM: ${e.message}. My cognitive state: coherence=${inputAnalysis.coherence.toFixed(3)}, entropy=${inputAnalysis.entropy.toFixed(3)}`,
        toolCalls: null
      };
    }

    const responseText = response.content || '';

    // ── Step 9: Validate through ObjectivityGate ──────────────────────
    const validation = this.cognitive.validateOutput(responseText, { input });

    let finalResponse = responseText;
    if (!validation.passed) {
      finalResponse +=
        '\n\n[Note: This response scored below the objectivity threshold. R=' +
        validation.R.toFixed(2) +
        ']';
    }

    // Add assistant response to internal history
    this.history.push({ role: 'assistant', content: finalResponse });

    // ── Step 10: Remember interaction ─────────────────────────────────
    this.cognitive.remember(input, finalResponse);

    // ── Step 11: Evolve physics ───────────────────────────────────────
    for (let i = 0; i < 3; i++) {
      this.cognitive.tick();
    }

    return {
      response: finalResponse,
      metadata: {
        provider: 'cognitive',
        turnCount: this.turnCount,
        coherence: inputAnalysis.coherence,
        entropy: inputAnalysis.entropy,
        toolsUsed: [...toolsUsed, ...toolResults.map(t => t.tool)],
        toolRounds,
        objectivityR: validation.R,
        objectivityPassed: validation.passed,
        memoryCount: this.cognitive.memories.length,
        processingLoad: inputAnalysis.processingLoad
      }
    };
  }

  /**
   * Get tool definitions in OpenAI function-calling format from ai-man's ToolExecutor.
   * Also adds cognitive-specific tools.
   * @returns {Array}
   * @private
   */
  _getToolDefinitions() {
    // Get ai-man's full tool definitions
    const aiManTools = this.toolExecutor ? this.toolExecutor.getAllToolDefinitions() : [];

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

    return [...aiManTools, ...cognitiveTools];
  }

  /**
   * Call the LLM via ai-man's EventicAIProvider.
   *
   * Uses `askWithMessages()` so the shared `aiProvider.conversationHistory`
   * is never mutated — the full messages array is passed directly and
   * no save/restore dance is needed.
   *
   * @param {Array} messages
   * @param {Array} tools
   * @param {Object} options
   * @returns {Promise<{content: string, toolCalls: Array|null}>}
   * @private
   */
  async _callLLM(messages, tools, options = {}) {
    try {
      const response = await this.aiProvider.askWithMessages(messages, {
        tools: tools.length > 0 ? tools : undefined,
        signal: options.signal
      });

      // Handle the response format
      if (typeof response === 'string') {
        return { content: response, toolCalls: null };
      }

      if (response && response.toolCalls) {
        return {
          content: response.content || '',
          toolCalls: response.toolCalls
        };
      }

      return { content: response?.content || String(response), toolCalls: null };
    } catch (e) {
      // Re-throw — callers handle errors (turn() wraps in try/catch)
      throw e;
    }
  }

  /**
   * Execute a tool call. Handles cognitive-specific tools internally,
   * delegates everything else to ai-man's ToolExecutor.
   *
   * @param {string} name
   * @param {object|string} args
   * @returns {Promise<object>}
   * @private
   */
  async _executeTool(name, args) {
    // Parse args if string
    let parsedArgs = args;
    if (typeof args === 'string') {
      try { parsedArgs = JSON.parse(args); } catch (_e) { parsedArgs = {}; }
    }

    // Handle cognitive-specific tools
    if (name === 'cognitive_state') {
      return { success: true, state: this.cognitive.getDiagnostics() };
    }

    if (name === 'recall_memory') {
      const memories = this.cognitive.recall(parsedArgs.query || '', parsedArgs.limit || 5);
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

    // Delegate to ai-man's ToolExecutor
    if (this.toolExecutor) {
      try {
        const toolFn = this.toolExecutor.getToolFunction(name);
        if (toolFn) {
          const result = await toolFn(parsedArgs);
          return typeof result === 'string' ? { result } : result;
        }
      } catch (e) {
        return { success: false, error: `Tool execution error: ${e.message}` };
      }
    }

    return { success: false, error: `Unknown tool: ${name}` };
  }

  /**
   * Check whether a string looks like a real file path.
   * @param {string} str
   * @returns {boolean}
   * @private
   */
  static _isLikelyFilePath(str) {
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
   * @param {string} input
   * @returns {Promise<Array>}
   * @private
   */
  async _preRoute(input) {
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
      if (match && CognitiveAgent._isLikelyFilePath(match[1]) && !fetchedPaths.has(match[1])) {
        const filePath = match[1];
        fetchedPaths.add(filePath);
        const result = await this._executeTool('read_file', { path: filePath });
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
      if (CognitiveAgent._isLikelyFilePath(candidate) && !fetchedPaths.has(candidate)) {
        fetchedPaths.add(candidate);
        const result = await this._executeTool('read_file', { path: candidate });
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
      const result = await this._executeTool('cognitive_state', {});
      if (result.success) {
        results.push({ tool: 'cognitive_state', state: result.state });
      }
    }

    return results;
  }

  /**
   * Get agent statistics.
   * @returns {Object}
   */
  getStats() {
    return {
      turnCount: this.turnCount,
      totalTokens: this.totalTokens,
      historyLength: this.history.length,
      cognitive: this.cognitive.getDiagnostics()
    };
  }

  /**
   * Reset all agent state.
   */
  reset() {
    this.history = [];
    this.turnCount = 0;
    this.totalTokens = 0;
    this.cognitive.reset();
  }
}

export { CognitiveAgent };
export default CognitiveAgent;
