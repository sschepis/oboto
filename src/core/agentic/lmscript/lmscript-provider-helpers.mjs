/**
 * Pure helper / utility functions for LMScriptProvider.
 *
 * Extracted from lmscript-provider.mjs to keep the main file focused on
 * orchestration.  Every function here is stateless (no `this`, no shared
 * mutable state).
 *
 * @module src/core/agentic/lmscript/lmscript-provider-helpers
 */

import { CancellationError } from '../../../lib/cancellation-error.mjs';

// ── Pre-compiled regex ───────────────────────────────────────────────
/**
 * Regex for parsing ECHO / NOOP response actions.
 * Avoids re-compiling on every iteration.
 */
export const RE_ECHO_CMD = /^COMMAND\s+ECHO\s+([\s\S]*)/i;
export const RE_NOOP_CMD = /^COMMAND\s+NOOP/i;
export const RE_RESPONSE_CMD = /^COMMAND\s+(?:ECHO|NOOP)(?:\s|$)/i;

// ── Response extraction ──────────────────────────────────────────────

/**
 * Combined check: if the action represents a terminal response (ECHO or NOOP),
 * extract and return the response text.  Returns null if the action is not
 * terminal.
 *
 * This replaces the previous two-pass pattern (_isResponseAction +
 * _extractResponse) to avoid parsing the command string twice.
 *
 * @param {Object} action — parsed LLM action object
 * @returns {string|null} — response text if terminal, null otherwise
 */
export function extractResponseIfTerminal(action) {
    const cmd = action.cli_command;

    // No command at all — terminal, return monologue
    if (!cmd) {
        return action.internal_monologue || 'No response generated.';
    }

    const trimmed = cmd.trim();

    // Fast check: does it look like ECHO or NOOP?
    if (!RE_RESPONSE_CMD.test(trimmed)) {
        return null; // Not a terminal action
    }

    // Extract text after COMMAND ECHO
    const echoMatch = trimmed.match(RE_ECHO_CMD);
    if (echoMatch) {
        return echoMatch[1].trim() || action.internal_monologue || 'No response.';
    }

    // NOOP — return the monologue
    if (RE_NOOP_CMD.test(trimmed)) {
        return action.internal_monologue || 'No response generated.';
    }

    // Bare COMMAND ECHO with no content
    return action.internal_monologue || 'No response generated.';
}

// ── Incomplete-response detection ────────────────────────────────────

/**
 * Check if a response appears incomplete (for continuation logic).
 * Only triggers for substantive content with strong truncation indicators.
 *
 * @param {string} response
 * @returns {boolean}
 */
export function isIncompleteResponse(response) {
    if (!response || response.length < 50) return false;

    const trimmed = response.trimEnd();

    // Check for unclosed code blocks first (strongest signal)
    const codeBlockCount = (response.match(/```/g) || []).length;
    if (codeBlockCount % 2 !== 0) return true;

    // Check for obvious truncation indicators
    // Note: ':' is excluded — it's common at the end of valid prose
    // (e.g. "Here's what I found:" is a complete sentence)
    if (trimmed.endsWith('...') || trimmed.endsWith('…')) return true;

    // Trailing list markers suggest an interrupted enumeration
    if (/[\n\r][-*]\s*$/.test(trimmed)) return true;

    return false;
}

// ── Precheck heuristic ───────────────────────────────────────────────

/**
 * Determine if a request obviously requires tools, making the precheck
 * LLM call a waste.  Uses keyword heuristics — no LLM call needed.
 *
 * @param {string} input
 * @returns {boolean} true if precheck should be skipped
 */
export function shouldSkipPrecheck(input) {
    const lower = input.toLowerCase();
    if (/\b(?:src|lib|docs|config)\/\S+/.test(input)) return true;
    if (/\b(?:write|create|edit|delete|run|execute|install|read|open)\s+/i.test(lower) && lower.length > 20) return true;
    if (input.length > 500) return true;
    return false;
}

// ── LLM response parsing ────────────────────────────────────────────

/**
 * Parse a raw LLM response (string or object) into a normalized action
 * object with { internal_monologue, memories_to_store, cli_command }.
 *
 * @param {string|Object} rawContent — the content field from the LLM response
 * @returns {{ internal_monologue: string, memories_to_store: string[], cli_command: string }}
 */
export function parseLLMAction(rawContent) {
    if (typeof rawContent === 'string') {
        try {
            const parsed = JSON.parse(rawContent);
            return {
                internal_monologue: parsed.internal_monologue || '',
                memories_to_store: Array.isArray(parsed.memories_to_store) ? parsed.memories_to_store : [],
                cli_command: parsed.cli_command || ''
            };
        } catch (_e) {
            // LLM returned non-JSON — treat as direct response
            return {
                internal_monologue: rawContent,
                memories_to_store: [],
                cli_command: `COMMAND ECHO ${rawContent}`
            };
        }
    }

    // Already an object
    return {
        internal_monologue: rawContent?.internal_monologue || '',
        memories_to_store: Array.isArray(rawContent?.memories_to_store) ? rawContent.memories_to_store : [],
        cli_command: rawContent?.cli_command || ''
    };
}

// ── Abort check ──────────────────────────────────────────────────────

/**
 * Check if signal is aborted and throw CancellationError if so.
 *
 * @param {AbortSignal} [signal]
 * @throws {CancellationError}
 */
export function checkAbort(signal) {
    if (signal?.aborted) {
        throw new CancellationError('LMScript agent processing was cancelled.');
    }
}

// ── Command history ──────────────────────────────────────────────────

/**
 * Push a command to the history ring buffer.
 * Caps at 100 entries, dropping the oldest 50 when full.
 *
 * @param {string[]} history — mutable command history array
 * @param {string} cmd — command string to append
 */
export function pushCommandHistory(history, cmd) {
    history.push(cmd);
    if (history.length > 100) {
        // Splice in-place instead of creating a new array with slice
        history.splice(0, history.length - 50);
    }
}
