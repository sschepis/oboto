/**
 * agent-response-utils.mjs — Extracted response utility functions from CognitiveAgent.
 *
 * Each function receives `agent` (the CognitiveAgent instance) as its first
 * parameter so it can access `agent.config`, `agent.history`, etc.
 *
 * @module src/core/agentic/cognitive/agent-response-utils
 */

import { isIncompleteResponse as _isIncompleteResponse } from '../response-patterns.mjs';

/**
 * Detect whether an LLM response is an "intent announcement" rather than
 * a completed response.  The LLM sometimes says "Let me write the file"
 * or "Now I'll create the synthesis paper" and stops — announcing what it
 * will do without actually doing it (no tool calls, no content produced).
 *
 * This method returns true when the response looks like it's announcing
 * future work rather than presenting a final answer.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {string} content - The LLM response text
 * @returns {boolean} true if the response appears incomplete
 */
export function isIncompleteResponse(agent, content) {
  // Configurable threshold (default 500) — some use cases may need
  // a higher limit to avoid missing genuine intent announcements.
  const maxLen = agent.config.agent?.incompleteResponseMaxLen ?? 500;
  return _isIncompleteResponse(content, maxLen);
}

/**
 * Truncate a tool result to a maximum character count.
 * Preserves structure by truncating string content within the result.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {unknown} result
 * @param {number} [maxChars]
 * @returns {string}
 */
export function truncateToolResult(agent, result, maxChars) {
  const limit = maxChars || agent.config.agent?.maxToolResultChars || 4000;
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  if (str.length <= limit) return str;
  return str.substring(0, limit) + '\n[...truncated, ' + (str.length - limit) + ' chars omitted]';
}

/**
 * Summarize conversation history to stay within a token budget.
 * Keeps the most recent `keepRecent` messages verbatim and summarizes
 * older messages into a compact block.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {number} maxChars — approximate max characters for the history block
 * @param {number} [keepRecent=4] — number of recent messages to keep verbatim
 * @returns {string} formatted history block
 */
export function summarizeHistory(agent, maxChars, keepRecent = 4) {
  if (agent.history.length === 0) return '';

  const recent = agent.history.slice(-keepRecent);
  const older = agent.history.slice(0, -keepRecent);

  let block = '';

  // Summarize older messages compactly
  if (older.length > 0) {
    block += '[Earlier conversation summary]\n';
    for (const msg of older) {
      const role = msg.role === 'assistant' ? 'A' : 'U';
      const content = (msg.content || '').substring(0, 80).replace(/\n/g, ' ');
      block += `${role}: ${content}${msg.content?.length > 80 ? '…' : ''}\n`;
      if (block.length > maxChars * 0.4) {
        block += `(${older.length - older.indexOf(msg) - 1} more messages omitted)\n`;
        break;
      }
    }
    block += '\n';
  }

  // Keep recent messages verbatim
  for (const msg of recent) {
    const role = msg.role === 'assistant' ? 'Agent' : 'User';
    const line = `${role}: ${msg.content}\n`;
    if (block.length + line.length > maxChars) {
      // Truncate this message if it would blow the budget
      const remaining = maxChars - block.length;
      if (remaining > 50) {
        block += `${role}: ${msg.content.substring(0, remaining - 20)}…\n`;
      }
      break;
    }
    block += line;
  }

  return block;
}

/**
 * Determine if a request obviously requires tools, making the precheck
 * LLM call a waste.  Uses keyword heuristics — no LLM call needed.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {string} input
 * @returns {boolean} true if precheck should be skipped
 */
export function shouldSkipPrecheck(agent, input) {
  const lower = input.toLowerCase();

  // Requests containing file paths almost always need tools
  if (/\b(?:src|lib|docs|config|package)\/\S+/.test(input)) return true;

  // Explicit tool-requiring verbs
  if (/\b(?:write|create|edit|modify|delete|remove|rename|move|copy)\s+(?:a\s+)?(?:file|function|class|component|module|test|script)/i.test(input)) return true;

  // Command execution
  if (/\b(?:run|execute|install|deploy|build|compile|test)\s+/i.test(lower) && lower.length > 20) return true;

  // Read/analyze file requests
  if (/\b(?:read|open|show|display|cat|view)\s+(?:the\s+)?(?:file|contents)/i.test(input)) return true;

  // Very long inputs (>500 chars) are likely complex tasks
  if (input.length > 500) return true;

  return false;
}
