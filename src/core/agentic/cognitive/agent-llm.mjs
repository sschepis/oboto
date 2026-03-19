/**
 * agent-llm.mjs — Extracted LLM-related functions from CognitiveAgent.
 *
 * Each function receives `agent` (the CognitiveAgent instance) as its first
 * parameter so it can access `agent.aiProvider`, `agent._precheckCache`, etc.
 *
 * @module src/core/agentic/cognitive/agent-llm
 */

/**
 * Call the LLM via ai-man's EventicAIProvider.
 *
 * Uses `askWithMessages()` so the shared `aiProvider.conversationHistory`
 * is never mutated — the full messages array is passed directly and
 * no save/restore dance is needed.
 *
 * The ActivityTracker heartbeat is active during the LLM call so the
 * operator sees periodic "Thinking… (Ns)" updates.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {Array} messages
 * @param {Array} tools
 * @param {Object} options
 * @returns {Promise<{content: string, toolCalls: Array|null, rawMessage: Object|null}>}
 */
export async function callLLM(agent, messages, tools, options = {}) {
  try {
    const askOptions = {
      tools: tools.length > 0 ? tools : undefined,
      signal: options.signal
    };
    // Forward per-request model override to avoid shared state mutation
    if (options.model) {
      askOptions.model = options.model;
    }
    // Forward temperature override to the provider
    if (options.temperature !== undefined) {
      askOptions.temperature = options.temperature;
    }
    // Forward streaming options when provided (Phase 1 streaming support).
    // If agent has a StreamManager, route callbacks through it so that
    // suppress/resume and abort are respected automatically.
    if (agent.streamManager?.isActive) {
      askOptions.stream = true;
      askOptions.onToken = (t) => agent.streamManager.token(t);
      askOptions.onChunk = (c) => agent.streamManager.chunk(c);
    } else if (options.onChunk) {
      askOptions.stream = true;
      askOptions.onChunk = options.onChunk;
    }
    const response = await agent.aiProvider.askWithMessages(messages, askOptions);

    // Handle the response format
    if (typeof response === 'string') {
      return { content: response, toolCalls: null, rawMessage: null };
    }

    if (response && response.toolCalls) {
      return {
        content: response.content || '',
        toolCalls: response.toolCalls,
        rawMessage: response.rawMessage || null
      };
    }

    return { content: response?.content || String(response), toolCalls: null, rawMessage: null };
  } catch (e) {
    // Re-throw — callers handle errors (turn() wraps in try/catch).
    // This catch block provides a centralised hook for future error
    // handling (e.g. cache flushing, metrics, retry decoration).
    throw e;
  }
}

/**
 * Check the precheck response cache.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {string} input
 * @returns {string|null} Cached response or null
 */
export function getPrecheckCached(agent, input) {
  const key = input.trim().toLowerCase().substring(0, 200);
  const entry = agent._precheckCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > agent._precheckCacheTTL) {
    agent._precheckCache.delete(key);
    return null;
  }
  return entry.response;
}

/**
 * Store a precheck response in cache.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {string} input
 * @param {string} response
 */
export function setPrecheckCached(agent, input, response) {
  const key = input.trim().toLowerCase().substring(0, 200);
  agent._precheckCache.set(key, { response, timestamp: Date.now() });
  // Evict oldest entries when cache is full
  if (agent._precheckCache.size > agent._precheckCacheMaxSize) {
    const firstKey = agent._precheckCache.keys().next().value;
    agent._precheckCache.delete(firstKey);
  }
}
