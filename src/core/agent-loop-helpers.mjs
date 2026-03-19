import { emitStatus } from './status-reporter.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';

// ── Constants ──────────────────────────────────────────────────────────

/** Direct-answer precheck sentinel — model emits this to signal it needs tools. */
export const PROCEED_SENTINEL = '___AGENT_PROCEED___';

export const PRECHECK_PROMPT = `Answer the following directly if you can. If the request is too vague, ask one clarifying question. If it requires tools, file access, or multi-step reasoning, respond with exactly: ${PROCEED_SENTINEL}`;

/** Tools that signal the agent should wrap up with a summary when they succeed */
export const WRAPUP_TOOLS = new Set([
    'attempt_completion'
]);

// Pattern-based error detection for common tool failure modes.
// Hoisted to module level to avoid re-compiling the regex on every
// evaluateToolResults() call.
//
// Two regexes: one anchored to start-of-line for "error:" and exit codes,
// and one for error class names that must appear at the START of a line
// (not embedded in explanatory prose like "fixed a TypeError").
const ERROR_LINE_START = /^error:|exit\s*code\s*[1-9]/i;
const ERROR_CLASS_NAMES = /^(?:ENOENT|EACCES|permission\s+denied|command\s+not\s+found|Traceback|ModuleNotFoundError|SyntaxError|ReferenceError|TypeError)\b/im;

/** Tools related to task management */
export const TASK_TOOLS = [
    {
        type: "function",
        function: {
            name: "add_tasks",
            description: "Add one or more tasks to your current plan. Tasks are processed sequentially.",
            parameters: {
                type: "object",
                properties: {
                    tasks: {
                        type: "array",
                        items: { type: "string" },
                        description: "A list of task descriptions to add"
                    }
                },
                required: ["tasks"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "complete_current_task",
            description: "Mark the current running task as completed. It will be moved to the completed tasks list.",
            parameters: {
                type: "object",
                properties: {
                    result: {
                        type: "string",
                        description: "A brief summary of the final result of this task"
                    }
                },
                required: ["result"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "fail_current_task",
            description: "Mark the current running task as failed. It will be moved to the completed tasks list with a failed status.",
            parameters: {
                type: "object",
                properties: {
                    reason: {
                        type: "string",
                        description: "The reason why the task failed"
                    }
                },
                required: ["reason"]
            }
        }
    }
];

/**
 * Configurable thresholds for input complexity classification.
 * Adjust these to tune when the planning hint is injected.
 */
export const COMPLEXITY_THRESHOLDS = {
    /** Minimum word count to check for action-verb density */
    minWordsForVerbCheck: 30,
    /** Minimum distinct action verbs to classify as complex */
    minActionVerbs: 3,
    /** Minimum word count to check structural complexity patterns */
    minWordsForPatterns: 15,
};

// ── Pure helper functions ──────────────────────────────────────────────

/**
 * Remove transient system messages (pre-routed file content, surface context,
 * fact-context blocks) from conversation history so they don't accumulate
 * across requests.  Called on every exit path from the agent loop.
 */
export function purgeTransientMessages(engine) {
    if (engine?.ai?.conversationHistory) {
        engine.ai.conversationHistory = engine.ai.conversationHistory.filter(m => !m._transient);
    }
}

export function setupErrorListener(ctx) {
    if (ctx.eventBus && !ctx.errorListener) {
        ctx.pendingErrors = [];
        ctx.errorListener = (err) => {
            if (err.type === 'unhandledRejection' || err.type === 'uncaughtException') {
                const msg = `[SYSTEM ERROR] Unhandled background error: ${err.message}`;
                ctx.pendingErrors.push(msg);
                // Force status update
                emitStatus(`⚠️ Error detected: ${err.message.substring(0, 50)}...`);
            }
        };
        ctx.eventBus.on('system:error', ctx.errorListener);
    }
}

export function cleanupErrorListener(ctx) {
    if (ctx.eventBus && ctx.errorListener) {
        ctx.eventBus.off('system:error', ctx.errorListener);
        ctx.errorListener = null;
    }
}

/**
 * Gracefully clean up error listeners and persist state on early exit
 * (cancellation, fatal error, etc.).
 * Wrapped in try/catch so cleanup failures never mask the original error.
 */
export async function gracefulCleanup(ctx, engine) {
    cleanupErrorListener(ctx);
    purgeTransientMessages(engine);
    if (ctx.stateManager) {
        try {
            await ctx.stateManager.syncHistory(engine);
            await ctx.stateManager.complete(ctx);
        } catch (e) {
            // Best-effort cleanup — don't mask the original error
            consoleStyler.log('error', `State persistence failed: ${e.message}`);
        }
    }
}

/**
 * Test whether tool output content looks like an error.
 * Only checks the first few lines to avoid false positives from
 * tool output that merely *mentions* error types in explanatory text.
 */
export function hasToolError(content) {
    if (!content) return false;
    const trimmed = content.trim();
    // Check start-of-content patterns (anchored)
    if (ERROR_LINE_START.test(trimmed)) return true;
    // Check first 3 lines for error class names at line start
    const lines = trimmed.split('\n', 3);
    for (const line of lines) {
        if (ERROR_CLASS_NAMES.test(line.trim())) return true;
    }
    return false;
}

/**
 * Evaluate a text response inline — returns { action, guidance } without dispatching.
 * Replaces the former EVALUATE_TEXT_RESPONSE handler.
 */
export function evaluateTextResponse(content, input, retryCount) {
    // Short input + non-trivial response → accept
    if (input.trim().length < 50 && content.length > 20) {
        return { action: 'accept', guidance: '' };
    }
    // Extremely terse response to a long/complex input → retry
    // Threshold of 30 chars avoids false-positives on legitimately concise replies
    if (input.length > 200 && content.length < 30 && retryCount < 2) {
        return {
            action: 'retry',
            guidance: 'Response is too brief for the complexity of the question. Provide more detail.'
        };
    }
    // Bare refusal without explanation → retry
    const lower = content.toLowerCase();
    if ((lower.includes("i can't") || lower.includes("i cannot")) &&
        !lower.includes('because') && !lower.includes('however') &&
        retryCount < 2) {
        return {
            action: 'retry',
            guidance: 'You said you cannot do something. Explain why, or attempt an alternative approach.'
        };
    }
    return { action: 'accept', guidance: '' };
}

/**
 * Evaluate tool results inline — returns guidance string or null.
 * Enhanced with pattern-based error detection for common failure modes,
 * plus surface-aware verification prompts.
 */
export function evaluateToolResults(ctx, toolNames, results) {
    const allSucceeded = results.every(res => !hasToolError(res.content));

    // Count how many tools had errors for proportional guidance
    const errorCount = results.filter(res => hasToolError(res.content)).length;

    // Wrap-up tool succeeded → ask the model for a brief summary
    if (allSucceeded && toolNames.some(name => WRAPUP_TOOLS.has(name))) {
        return 'Tool completed successfully. Provide a brief summary response to the user.';
    }

    // ── Phase 2a: Surface-aware verification prompt ───────────────────
    // After a successful update_surface_component, remind the agent to verify.
    if (allSucceeded && toolNames.includes('update_surface_component')) {
        return 'Surface component was written to disk. You MUST now verify it rendered correctly:\n' +
            '1. Call read_surface to check for any CLIENT-SIDE ERRORS listed in the output.\n' +
            '2. If errors exist, fix the JSX and call update_surface_component again.\n' +
            '3. Only report success to the user after confirming zero client-side errors.\n' +
            'Do NOT skip verification — surfaces frequently fail to render due to JSX issues that pass static validation.';
    }

    // After create_surface, remind to add components (don't wrap up yet)
    if (allSucceeded && toolNames.includes('create_surface')) {
        return 'Surface created. Now add components using update_surface_component. Do not summarize yet — the surface is empty.';
    }

    // Too many tool calls → force completion
    if (ctx.toolCallCount > 25) {
        return 'You have made many tool calls. Focus on completing the original request. Provide your response now.';
    }

    // Approaching turn limit → force completion
    if (ctx.turnNumber >= (ctx.maxTurns - 2)) {
        return `You are approaching the turn limit (${ctx.maxTurns}). Summarize what you have done and provide your final response.`;
    }

    // Tools produced errors → provide targeted guidance
    if (!allSucceeded) {
        // Surface-specific error → extra context
        if (toolNames.includes('update_surface_component') && errorCount > 0) {
            return 'update_surface_component FAILED validation. Read the error messages carefully — they tell you exactly what is wrong. ' +
                'Fix the JSX source and call update_surface_component again. Common issues: missing "export default function", ' +
                'import statements (use globals instead), non-existent UI.* components, unbalanced braces/brackets.';
        }
        if (errorCount === results.length) {
            return 'All tools encountered errors. Review the error messages carefully, diagnose the root cause, and try a different approach.';
        }
        return `${errorCount} of ${results.length} tools encountered errors. Review the errors in your history, fix the failing operations, and continue with the remaining work.`;
    }

    // No guidance — continue normally
    return null;
}

/**
 * Heuristic classifier for input complexity.
 * Returns 'complex' if the input looks like it needs multi-step planning,
 * 'simple' otherwise. Mirrors the cognitive provider's classifyInput().
 *
 * Thresholds are configurable via the COMPLEXITY_THRESHOLDS constant.
 */
export function classifyInputComplexity(input) {
    const trimmed = input.trim();
    const wordCount = trimmed.split(/\s+/).length;
    
    // Very short messages are always simple
    if (wordCount <= 5) return 'simple';
    
    // Short questions/greetings
    if (wordCount <= 15) {
        if (/^(hi|hello|hey|thanks|ok|bye|good\s*(morning|evening|night))[\s!.?]*$/i.test(trimmed)) return 'simple';
        if (/^(what|who|where|when|why|how|is|are|do|does|can|could|would)\b/i.test(trimmed)) return 'simple';
    }
    
    // Complex patterns (only check if input has enough substance)
    if (wordCount >= COMPLEXITY_THRESHOLDS.minWordsForPatterns) {
        if (/\b(refactor|migrate|convert|restructure|reorganize|overhaul)\s/i.test(trimmed)) return 'complex';
        if (/\b(and\s+then|first.*then|step\s*1|multiple\s+(files?|components?|modules?))\b/i.test(trimmed)) return 'complex';
        if (/\b(project|application|app|website|service|api|system|platform)\b.*\b(with|using|including|that\s+has)\b/i.test(trimmed)) return 'complex';
    }
    
    // Multiple action verbs suggest complexity
    if (wordCount >= COMPLEXITY_THRESHOLDS.minWordsForVerbCheck) {
        const actionVerbs = /\b(create|build|implement|write|add|update|fix|refactor|deploy|test|install|configure|generate|modify)\b/gi;
        const matches = trimmed.match(actionVerbs);
        if (matches && matches.length >= COMPLEXITY_THRESHOLDS.minActionVerbs) return 'complex';
    }
    
    return 'simple';
}
