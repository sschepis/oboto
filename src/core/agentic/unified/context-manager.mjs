/**
 * ContextManager — context management with compaction and pre-routing
 * for the UnifiedProvider.
 *
 * Responsibilities:
 *  1. **Pre-routing** — auto-fetch files and surfaces mentioned in user input
 *     before the first LLM call, saving tool-call round trips.
 *  2. **Compaction** — detect when the conversation history exceeds the
 *     context window and summarise old messages to stay within budget.
 *  3. **Turn context assembly** — merge user input, history, pre-routed
 *     context, and cognitive context into a single messages array.
 *  4. **Transient message purging** — remove `_transient: true` messages
 *     that are only valid for a single turn.
 *
 * Sources:
 *  - File pre-routing:    {@link src/core/agent-loop-preroute.mjs} preRouteFiles
 *  - Surface pre-routing: {@link src/core/agent-loop-preroute.mjs} preRouteSurfaces, detectSurfaceUpdateIntent
 *  - Compaction pattern:  {@link src/core/agentic/megacode/compaction-agent.mjs} CompactionAgent
 *  - Transient purge:     {@link src/core/agent-loop-helpers.mjs} purgeTransientMessages concept
 *
 * @module src/core/agentic/unified/context-manager
 */

import { preRouteFiles, preRouteSurfaces, detectSurfaceUpdateIntent } from '../../agent-loop-preroute.mjs';

// ════════════════════════════════════════════════════════════════════════
// Compaction Prompt (ported from megacode CompactionAgent)
// ════════════════════════════════════════════════════════════════════════

/**
 * Prompt template for LLM-based conversation compaction.
 * Asks the model to produce a structured summary following megacode's
 * compaction pattern.
 * @private
 */
const COMPACTION_PROMPT = `Provide a detailed summary for continuing our conversation.
Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next.

When constructing the summary, stick to this template:
---
## Goal
[What goals is the user trying to accomplish?]

## Instructions
- [What important instructions did the user give]
- [If there is a plan or spec, include information about it]

## Discoveries
[What notable things were learned during this conversation]

## Accomplished
[What work has been completed, in progress, or left?]

## Remaining
[What still needs to be done]

## Relevant files / directories
[List of relevant files that have been read, edited, or created]
---`;

// ════════════════════════════════════════════════════════════════════════
// ContextManager Class
// ════════════════════════════════════════════════════════════════════════

/**
 * Manages context window lifecycle: pre-routing, compaction, assembly.
 */
export class ContextManager {
  /**
   * @param {Object} deps
   * @param {Object} deps.config      — compaction section from unified config
   * @param {Object} [deps.toolExecutor] — ai-man ToolExecutor (provides tools Map)
   * @param {Object} [deps.aiProvider]   — ai-man EventicAIProvider (for compaction LLM calls)
   */
  constructor({ config, toolExecutor, aiProvider } = {}) {
    /** @private */
    this._config = config || {};
    /** @private */
    this._toolExecutor = toolExecutor || null;
    /** @private */
    this._aiProvider = aiProvider || null;
  }

  // ════════════════════════════════════════════════════════════════════
  // Pre-Routing
  // ════════════════════════════════════════════════════════════════════

  /**
   * Pre-fetch files and surfaces mentioned in the user input.
   *
   * Saves 1-3 tool-call round trips by injecting content into the
   * conversation before the first LLM call.
   *
   * When a `sensitivityTagger` is provided (Phase 2 confidentiality),
   * pre-routed file content is annotated with sensitivity metadata.
   *
   * @param {string} input — the user's message
   * @param {Map}    tools — engine tool map (tool name → handler function)
   * @param {import('../../confidentiality/sensitivity-tagger.mjs').SensitivityTagger} [sensitivityTagger] — optional tagger for classification
   * @returns {Promise<{ fileContext: Array, surfaceContext: string|null }>}
   */
  async preRoute(input, tools, sensitivityTagger) {
    // ── File pre-routing ─────────────────────────────────────────
    let fileContext = [];
    try {
      fileContext = await preRouteFiles(input, tools);
    } catch (_e) {
      // Non-critical — the agent can still call tools manually
    }

    // ── Sensitivity classification of pre-routed files (Phase 2) ──
    if (sensitivityTagger && fileContext && fileContext.length > 0) {
      for (const file of fileContext) {
        try {
          file.sensitivity = sensitivityTagger.classify(
            file.content || '',
            'file-content',
            { path: file.path },
          );
        } catch (_e) {
          // Non-critical — file proceeds without classification
        }
      }
    }

    // ── Surface pre-routing ──────────────────────────────────────
    let surfaceContext = null;
    try {
      const surfaceIntent = detectSurfaceUpdateIntent(input);
      if (surfaceIntent.isSurfaceUpdate) {
        surfaceContext = await preRouteSurfaces(input, tools, surfaceIntent);
      }
    } catch (_e) {
      // Non-critical
    }

    return { fileContext, surfaceContext };
  }

  // ════════════════════════════════════════════════════════════════════
  // Compaction
  // ════════════════════════════════════════════════════════════════════

  /**
   * Check whether the conversation history exceeds the compaction
   * threshold and needs to be summarised.
   *
   * Uses a rough token estimate (4 chars ≈ 1 token) to avoid
   * pulling in a full tokeniser dependency.
   *
   * @param {Array}  history — conversation messages
   * @param {Object} [config] — compaction section override
   * @returns {{ needed: boolean, estimatedTokens: number, threshold: number }}
   */
  shouldCompact(history, config) {
    const cfg = config || this._config;
    const maxTokens = cfg.maxContextTokens ?? 100_000;
    const ratio = cfg.compactionThreshold ?? 0.8;
    const threshold = Math.floor(maxTokens * ratio);

    const estimatedTokens = this._estimateTokens(history);

    return {
      needed: estimatedTokens >= threshold,
      estimatedTokens,
      threshold,
    };
  }

  /**
   * Compact the conversation history by summarising old messages and
   * keeping recent ones verbatim.
   *
   * Strategy (ported from megacode CompactionAgent):
   *  1. Keep the last `keepCount` messages verbatim (recent context).
   *  2. Summarise everything before that into a single system message.
   *  3. If an `aiProvider` is available, use an LLM to produce the
   *     summary; otherwise, fall back to a heuristic extraction.
   *
   * @param {Array}  history   — full conversation messages
   * @param {Object} [config]  — compaction section override
   * @param {number} [keepCount=6] — number of recent messages to keep verbatim
   * @returns {Promise<Array>} — compacted messages array
   */
  async compact(history, config, keepCount = 6) {
    if (!history || history.length <= keepCount) return history;

    const olderMessages = history.slice(0, -keepCount);
    const recentMessages = history.slice(-keepCount);

    let summary;

    if (this._aiProvider) {
      try {
        const compactionMessages = [
          ...olderMessages,
          { role: 'user', content: COMPACTION_PROMPT },
        ];

        const response = await this._aiProvider.askWithMessages(compactionMessages, {
          temperature: 0.3,
          recordHistory: false,
        });

        summary = typeof response === 'string'
          ? response
          : (response?.content || response?.response || String(response));
      } catch (_e) {
        // Fallback to heuristic if LLM call fails
        summary = this._buildFallbackSummary(olderMessages);
      }
    } else {
      summary = this._buildFallbackSummary(olderMessages);
    }

    // Return a compacted history: summary system message + recent verbatim messages
    return [
      { role: 'system', content: `[Conversation Summary]\n${summary}` },
      ...recentMessages,
    ];
  }

  // ════════════════════════════════════════════════════════════════════
  // Turn Context Assembly
  // ════════════════════════════════════════════════════════════════════

  /**
   * Build the complete messages array for an LLM call.
   *
   * Assembles:
   *  1. System prompt (from history or provider)
   *  2. Conversation history (compacted if necessary)
   *  3. Pre-routed file/surface context
   *  4. Cognitive context (memory recall, experience hints)
   *  5. The current user input
   *
   * @param {string} input           — user's message
   * @param {Array}  history         — conversation messages (may include system)
   * @param {Object} preRouted       — output from {@link preRoute}
   * @param {Array}  [preRouted.fileContext]    — pre-fetched file results
   * @param {string} [preRouted.surfaceContext] — pre-fetched surface context
   * @param {string} [cognitiveContext] — memory recall / experience hints text
   * @returns {Array} — messages array ready for LLM call
   */
  buildTurnContext(input, history, preRouted, cognitiveContext) {
    const messages = [];

    // ── 1. Copy history (preserving existing system messages) ───
    if (history && history.length > 0) {
      for (const msg of history) {
        messages.push({ ...msg });
      }
    }

    // ── 2. Inject pre-routed file context ──────────────────────
    if (preRouted?.fileContext?.length > 0) {
      const fileBlock = preRouted.fileContext
        .filter(r => r.content && !r.error)
        .map(r => `[PRE-FETCHED: ${r.path}]\n${r.content}`)
        .join('\n\n');

      if (fileBlock) {
        messages.push({
          role: 'system',
          content: fileBlock,
          _transient: true,
        });
      }
    }

    // ── 3. Inject pre-routed surface context ───────────────────
    if (preRouted?.surfaceContext) {
      messages.push({
        role: 'system',
        content: preRouted.surfaceContext,
        _transient: true,
      });
    }

    // ── 4. Inject cognitive context ────────────────────────────
    if (cognitiveContext) {
      messages.push({
        role: 'system',
        content: cognitiveContext,
        _transient: true,
      });
    }

    // ── 5. Append the current user message ─────────────────────
    messages.push({ role: 'user', content: input });

    return messages;
  }

  // ════════════════════════════════════════════════════════════════════
  // Transient Message Purging
  // ════════════════════════════════════════════════════════════════════

  /**
   * Remove messages marked with `_transient: true` from the history.
   *
   * Transient messages are injected for a single turn only (e.g. pre-routed
   * file content, surface context, cognitive hints) and must be purged
   * before persisting the history to avoid context bloat on subsequent turns.
   *
   * @param {Array} history — conversation messages (mutated in place)
   * @returns {Array} — the same array with transient messages removed
   */
  purgeTransientMessages(history) {
    if (!history || !Array.isArray(history)) return history || [];

    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i]._transient) {
        history.splice(i, 1);
      }
    }

    return history;
  }

  // ════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ════════════════════════════════════════════════════════════════════

  /**
   * Estimate token count for a messages array.
   * Uses a rough heuristic: 1 token ≈ 4 characters.
   *
   * @param {Array} messages
   * @returns {number}
   * @private
   */
  _estimateTokens(messages) {
    if (!messages || messages.length === 0) return 0;

    let charCount = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        charCount += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        // Multi-part content (e.g. images + text)
        for (const part of msg.content) {
          if (typeof part === 'string') charCount += part.length;
          else if (part?.text) charCount += part.text.length;
        }
      }
      // Tool call arguments
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.function?.arguments) {
            charCount += tc.function.arguments.length;
          }
        }
      }
    }

    return Math.ceil(charCount / 4);
  }

  /**
   * Build a heuristic fallback summary when LLM compaction is unavailable.
   * Extracts key information from messages without an LLM call.
   *
   * @param {Array} messages
   * @returns {string}
   * @private
   */
  _buildFallbackSummary(messages) {
    const parts = ['[Compaction fallback — LLM summarization unavailable]\n'];

    // Extract the first user message as the goal
    const firstUser = messages.find(m => m.role === 'user');
    if (firstUser) {
      const content = typeof firstUser.content === 'string'
        ? firstUser.content
        : JSON.stringify(firstUser.content);
      parts.push(`## Goal\n${content.substring(0, 500)}\n`);
    }

    // Extract the last assistant message as recent progress
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    if (lastAssistant) {
      const content = typeof lastAssistant.content === 'string'
        ? lastAssistant.content
        : JSON.stringify(lastAssistant.content);
      parts.push(`## Last Progress\n${content.substring(0, 500)}\n`);
    }

    // Count tool calls
    const toolMessages = messages.filter(m => m.role === 'tool');
    if (toolMessages.length > 0) {
      parts.push(`## Tool Usage\n${toolMessages.length} tool calls were made during the conversation.\n`);
    }

    return parts.join('\n');
  }
}
