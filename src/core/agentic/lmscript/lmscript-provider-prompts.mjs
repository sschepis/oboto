/**
 * Prompt construction helpers for LMScriptProvider.
 *
 * Extracted from lmscript-provider.mjs to keep the main file focused on
 * orchestration (run / agentLoop / LLM calls) while prompt-building logic
 * lives here.
 *
 * All functions are pure (no side-effects, no shared state) — they receive
 * every piece of context they need as parameters.
 *
 * @module src/core/agentic/lmscript/lmscript-provider-prompts
 */

// ── Action schema ────────────────────────────────────────────────────
/**
 * The JSON schema description that the LLM must follow when generating
 * actions.  Used in both the system prompt and simplified retry prompts.
 */
export const ACTION_SCHEMA_DESCRIPTION = `{
  "internal_monologue": "Your reasoning about the current situation",
  "memories_to_store": ["Important facts to commit to associative memory"],
  "cli_command": "COMMAND <name> <params> [| COMMAND <name> <params>]"
}`;

// ── System prompt ────────────────────────────────────────────────────

/**
 * Build the static (cacheable) portion of the system prompt.
 *
 * Contains persona, available commands, action schema, special commands,
 * piping, and response format — everything that doesn't change between
 * iterations within a session.
 *
 * @param {string} persona — active persona prompt text
 * @param {string[]} availableCommands — command names from CLIExecutor
 * @returns {string}
 */
export function buildSystemPromptBase(persona, availableCommands) {
    const commandList = availableCommands.map(c => `- COMMAND ${c}`).join('\n');

    return `${persona}

You are an autonomous CLI-driven agent. You process inputs and execute commands to accomplish tasks.

## Action Interface
You have a SINGLE action interface: CLI commands. You output a JSON object with your reasoning, memories, and a command.

## Available Commands
${commandList}

## Special Commands
- COMMAND RECALL <query> — Search your long-term holographic memory for relevant context
- COMMAND REMEMBER <text> — Explicitly write important information to long-term memory
- COMMAND GLOBAL_RECALL <query> — Search cross-workspace global memory
- COMMAND GLOBAL_REMEMBER <text> — Promote a memory to the cross-workspace global store
- COMMAND CREATE <name> function(context, params) { ... } — Create a new reusable tool
- COMMAND TOOL <name> <json_args> — Execute any ai-man tool by name
- COMMAND ECHO <text> — Output text (useful for final responses)
- COMMAND NOOP — Do nothing (when you want to respond without a command)

## Piping
You can chain commands: COMMAND HTTP_GET https://example.com | COMMAND ECHO

## Response Format
You MUST respond with a JSON object:
${ACTION_SCHEMA_DESCRIPTION}

## When to Respond
When you have enough information to answer the user, set cli_command to:
COMMAND ECHO <your final response to the user>

When you need more information, use RECALL, TOOL, or other commands to gather it.`;
}

/**
 * Assemble the full system prompt from a cached static base plus
 * per-iteration dynamic suffixes (cognitive state, iteration counter).
 *
 * @param {string} cachedBase — output of {@link buildSystemPromptBase}
 * @param {string} cognitiveStateContext — from memory.getCognitiveStateContext()
 * @param {number} iterationCount — current session iteration counter
 * @returns {string}
 */
export function assembleSystemPrompt(cachedBase, cognitiveStateContext, iterationCount) {
    return cachedBase +
        `\n\n${cognitiveStateContext}` +
        `\n\n## Important Rules
1. Always output valid JSON matching the schema above
2. Your internal_monologue should contain your reasoning process
3. Store important observations and facts in memories_to_store
4. Use RECALL before answering questions that might benefit from past context
5. Use TOOL to leverage ai-man's full tool ecosystem when needed
6. Iteration ${iterationCount} of this session`;
}

// ── User prompt ──────────────────────────────────────────────────────

/**
 * Build the user prompt with observation, command result, associative
 * context, command history, and recent conversation history for
 * multi-turn coherence.
 *
 * @param {string} observation
 * @param {string} commandResult
 * @param {Array<{source: string, score: number, text: string}>} associativeContext
 * @param {string[]} commandHistory — full command history array (last 3 used)
 * @param {string|null} conversationHistory — pre-formatted history string
 * @returns {string}
 */
export function buildUserPrompt(observation, commandResult, associativeContext, commandHistory, conversationHistory) {
    const parts = [];

    // Inject conversation history for multi-turn coherence
    if (conversationHistory) {
        parts.push(`[Conversation History]:\n${conversationHistory}`);
    }

    // Inject associative memory context (passive/subconscious)
    if (associativeContext.length > 0) {
        const memories = associativeContext.map(r =>
            `(${r.source}, relevance=${r.score.toFixed(2)}) ${r.text}`
        ).join('\n');
        parts.push(`[Subconscious Associative Memories]:\n${memories}`);
    }

    // Last command result
    if (commandResult) {
        parts.push(`[Last Command Result]:\n${commandResult}`);
    }

    // Command history (last 3)
    if (commandHistory.length > 0) {
        const recentCmds = commandHistory.slice(-3);
        parts.push(`[Recent Commands]: ${recentCmds.join(' → ')}`);
    }

    // Current observation
    parts.push(`[Current Input/Observation]:\n${observation}`);
    parts.push('Determine your next action. Respond with the JSON schema.');

    return parts.join('\n\n');
}

// ── Conversation history ─────────────────────────────────────────────

/**
 * Get recent conversation history formatted for prompt injection.
 * Mirrors how cognitive-provider provides conversation context to its agent.
 *
 * @param {Object} deps — provider dependencies ({ facade, historyManager })
 * @param {number} maxHistoryMessages — max messages to include
 * @returns {string|null}
 */
export function getRecentHistory(deps, maxHistoryMessages) {
    const facade = deps?.facade;
    const hm = facade ? facade.historyManager : deps?.historyManager;
    if (!hm) return null;

    try {
        const messages = hm.getMessages ? hm.getMessages() : (hm.messages || []);
        if (!messages || messages.length === 0) return null;

        // Take the last N messages (excluding the most recent user message
        // which is already in the observation)
        const relevant = messages.slice(-(maxHistoryMessages + 1), -1);
        if (relevant.length === 0) return null;

        return relevant.map(m => `${m.role}: ${typeof m.content === 'string' ? m.content.substring(0, 300) : '[non-text]'}`).join('\n');
    } catch (_e) {
        return null;
    }
}
