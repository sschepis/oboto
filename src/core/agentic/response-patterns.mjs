/**
 * Shared intent-detection patterns for LLM response analysis.
 *
 * Used by both the eventic agent loop plugin and the cognitive agent's
 * response-utils module to detect "intent announcements" — responses
 * where the LLM says "Let me write X" without actually calling tools.
 *
 * @module src/core/agentic/response-patterns
 */

/**
 * Action verbs that indicate tool-calling intent when preceded by phrases
 * like "I'll...", "Let me...", "I will...", etc.  Using a whitelist of
 * action verbs (rather than `\w+` with negative lookaheads) avoids
 * false positives on conversational closings like "I'll keep that in
 * mind", "I will be happy to help", "Let me start by thanking you".
 */
export const ACTION_VERBS = 'write|create|generate|build|produce|compose|draft|synthesize|construct|implement|make|read|search|execute|run|install|update|modify|edit|delete|remove|fetch|download|upload|deploy|configure|set\\s+up|open|analyze|parse|compile|test|fix|refactor|restructure|reorganize|extract|prepare|proceed|continue';

/**
 * Patterns that indicate the LLM is announcing what it will do next
 * rather than presenting a final answer.  Hoisted to module scope to
 * avoid re-creating compiled regexes on every call.
 *
 * Each pattern matches a specific intent-announcement frame followed by
 * a whitelisted ACTION_VERB, so only genuine "I'm about to use a tool"
 * announcements trigger continuations.
 */
export const INTENT_PATTERNS = [
    // "Let me [action verb]..."
    new RegExp(`\\blet me\\s+(?:now\\s+)?(?:${ACTION_VERBS})\\b`, 'i'),
    // "I'll [action verb]..." / "I will [action verb]..."
    new RegExp(`\\bI[''\u2019]?ll\\s+(?:now\\s+)?(?:${ACTION_VERBS})\\b`, 'i'),
    new RegExp(`\\bI\\s+will\\s+(?:now\\s+)?(?:${ACTION_VERBS})\\b`, 'i'),
    // "Now I need/want/have to [action verb]..."
    new RegExp(`\\bnow\\s+I\\s+(?:need|want|have)\\s+to\\s+(?:${ACTION_VERBS})\\b`, 'i'),
    // "Next, I'll [action verb]..." / "Next step is to [action verb]..."
    new RegExp(`\\bnext[,:]?\\s+I[''\u2019]?ll\\s+(?:${ACTION_VERBS})\\b`, 'i'),
    new RegExp(`\\bnext\\s+step\\s+is\\s+to\\s+(?:${ACTION_VERBS})\\b`, 'i'),
    // "Here's what I'll do..." / "Here is my plan..."
    /\bhere[''']?s?\s+(?:what\s+I[''']?ll|my\s+plan)/i,
];

/**
 * Detect whether an LLM response is an "intent announcement" rather than
 * a completed response.  The LLM sometimes says "Let me write the file"
 * or "Now I'll create the synthesis paper" and stops — announcing what it
 * will do without actually doing it (no tool calls, no content produced).
 *
 * This function returns true when the response looks like it's announcing
 * future work rather than presenting a final answer.
 *
 * @param {string} content - The LLM response text
 * @param {number} [maxLen=500] - Maximum content length to check (longer responses are never flagged)
 * @returns {boolean} true if the response appears incomplete
 */
export function isIncompleteResponse(content, maxLen = 500) {
    if (!content || typeof content !== 'string') return false;

    const trimmed = content.trim();
    if (trimmed.length > maxLen) return false;

    // Catch extremely truncated intent fragments — the model started
    // generating an intent announcement but context exhaustion or
    // max_tokens cut it off before the action verb appeared.
    // Examples: "I'll", "Let me", "I will", "I'll now", "Next, I'll"
    if (trimmed.length < 30 && /^(?:I[''\u2019]?ll|let me|I\s+will|now\s+I)\b/i.test(trimmed)) {
        return true;
    }

    // Check only the very last line for intent patterns.
    // Checking multiple tail lines caused false positives on normal
    // multi-paragraph responses that mentioned future actions.
    const lines = trimmed.split('\n').filter(l => l.trim());
    const tailText = lines.slice(-1).join(' ');

    for (const pattern of INTENT_PATTERNS) {
        if (pattern.test(tailText)) {
            return true;
        }
    }

    return false;
}
