/**
 * ReactLoop helpers — pure utility functions extracted from react-loop.mjs.
 *
 * Contains action parsing, JSON extraction, abort/sleep helpers,
 * metadata builders, and progress event emission.
 *
 * @module src/core/agentic/megacode/react-loop-helpers
 */

import { emitCommentary } from '../../status-reporter.mjs';

/**
 * Pre-compiled regex patterns for JSON extraction from LLM responses.
 * @private
 */
const RE_JSON_CODE_BLOCK = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/;
const RE_JSON_OBJECT = /\{[\s\S]*"action"\s*:\s*"[^"]+"/;

/**
 * Parse the LLM response to extract a structured action.
 *
 * Handles:
 * - Clean JSON: `{"action":"tool_call","tool":"search","args":{...}}`
 * - JSON in markdown code blocks: ```json\n{...}\n```
 * - Mixed text with embedded JSON
 * - Freeform text (treated as direct response)
 *
 * @param {string} response — raw LLM response
 * @returns {{ type: string, tool?: string, args?: Object, response?: string, thought?: string }}
 */
export function parseAction(response) {
    if (!response || typeof response !== 'string') {
        return { type: 'respond', response: response || '' };
    }

    const trimmed = response.trim();

    // Attempt 1: Direct JSON parse
    const directParsed = tryParseJSON(trimmed);
    if (directParsed) return normaliseAction(directParsed);

    // Attempt 2: JSON inside a markdown code block
    const codeBlockMatch = trimmed.match(RE_JSON_CODE_BLOCK);
    if (codeBlockMatch) {
        const blockParsed = tryParseJSON(codeBlockMatch[1].trim());
        if (blockParsed) return normaliseAction(blockParsed);
    }

    // Attempt 3: Find a JSON object containing "action" anywhere in the text
    const jsonMatch = trimmed.match(RE_JSON_OBJECT);
    if (jsonMatch) {
        // Extract from the opening brace to the matching closing brace
        const jsonStr = extractBalancedJSON(trimmed, jsonMatch.index);
        if (jsonStr) {
            const embeddedParsed = tryParseJSON(jsonStr);
            if (embeddedParsed) return normaliseAction(embeddedParsed);
        }
    }

    // Attempt 4: Freeform text — treat as a direct response
    return { type: 'respond', response: trimmed };
}

/**
 * Normalise a parsed JSON action object into the expected internal format.
 *
 * @param {Object} parsed
 * @returns {{ type: string, tool?: string, args?: Object, response?: string, thought?: string }}
 */
export function normaliseAction(parsed) {
    const action = parsed.action;

    if (action === 'tool_call') {
        return {
            type: 'tool_call',
            tool: parsed.tool || parsed.toolName || parsed.name || '',
            args: parsed.args || parsed.arguments || parsed.input || {},
            thought: parsed.thought || parsed.reasoning || undefined,
        };
    }

    if (action === 'respond' || action === 'response' || action === 'answer') {
        return {
            type: 'respond',
            response: parsed.response || parsed.answer || parsed.text || parsed.content || '',
            thought: parsed.thought || parsed.reasoning || undefined,
        };
    }

    // Unknown action type — if there's a response field, treat as respond
    if (parsed.response || parsed.answer || parsed.text) {
        return {
            type: 'respond',
            response: parsed.response || parsed.answer || parsed.text || '',
            thought: parsed.thought || parsed.reasoning || undefined,
        };
    }

    // If there's a tool field, treat as tool_call
    if (parsed.tool || parsed.toolName) {
        return {
            type: 'tool_call',
            tool: parsed.tool || parsed.toolName || '',
            args: parsed.args || parsed.arguments || parsed.input || {},
            thought: parsed.thought || parsed.reasoning || undefined,
        };
    }

    // Completely unrecognised — return as respond with the raw JSON
    return { type: 'respond', response: JSON.stringify(parsed) };
}

/**
 * Try to parse a string as JSON. Returns null on failure.
 *
 * @param {string} str
 * @returns {Object|null}
 */
export function tryParseJSON(str) {
    try {
        const parsed = JSON.parse(str);
        if (parsed && typeof parsed === 'object') return parsed;
        return null;
    } catch {
        return null;
    }
}

/**
 * Extract a balanced JSON object starting from the given index.
 * Counts braces to find the matching closing brace.
 *
 * @param {string} text
 * @param {number} startIndex
 * @returns {string|null}
 */
export function extractBalancedJSON(text, startIndex) {
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = startIndex; i < text.length; i++) {
        const ch = text[i];

        if (escape) {
            escape = false;
            continue;
        }

        if (ch === '\\' && inString) {
            escape = true;
            continue;
        }

        if (ch === '"') {
            inString = !inString;
            continue;
        }

        if (inString) continue;

        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return text.substring(startIndex, i + 1);
            }
        }
    }

    return null; // Unbalanced
}

/**
 * Check abort signal and throw if aborted.
 *
 * @param {AbortSignal} [signal]
 * @throws {Error} — AbortError if signal is aborted
 */
export function checkAbort(signal) {
    if (signal?.aborted) {
        const err = new Error('ReactLoop execution was cancelled.');
        err.name = 'AbortError';
        throw err;
    }
}

/**
 * Sleep for a given duration, respecting the abort signal.
 *
 * @param {number} ms — milliseconds to sleep
 * @param {AbortSignal} [signal] — abort signal
 * @returns {Promise<void>}
 */
export function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            const err = new Error('Sleep aborted');
            err.name = 'AbortError';
            reject(err);
            return;
        }

        const timer = setTimeout(resolve, ms);
        if (timer.unref) timer.unref();

        if (signal) {
            const onAbort = () => {
                clearTimeout(timer);
                const err = new Error('Sleep aborted');
                err.name = 'AbortError';
                reject(err);
            };
            signal.addEventListener('abort', onAbort, { once: true });
            // Clean up listener when timer fires
            const originalResolve = resolve;
            resolve = () => {
                signal.removeEventListener('abort', onAbort);
                originalResolve();
            };
        }
    });
}

/**
 * Get available tool definitions from deps.toolExecutor.
 *
 * @param {Object} deps
 * @returns {Array} — OpenAI-format tool definitions
 */
export function getAvailableTools(deps) {
    if (!deps.toolExecutor?.getAllToolDefinitions) return [];

    try {
        return deps.toolExecutor.getAllToolDefinitions();
    } catch {
        return [];
    }
}

/**
 * Build metadata object for the run result.
 *
 * @param {Object} runMetrics
 * @param {Array} allToolCalls
 * @returns {Object}
 */
export function buildMetadata(runMetrics, allToolCalls) {
    return {
        elapsed: Date.now() - runMetrics.startTime,
        iterations: runMetrics.iterations,
        toolErrors: runMetrics.toolErrors,
        compactions: runMetrics.compactions,
        doomWarnings: runMetrics.doomWarnings,
        retries: runMetrics.retries,
        toolNames: [...new Set(allToolCalls.map(tc => tc.tool))],
    };
}

/**
 * Emit a progress event with current run metrics.
 *
 * @param {Object} deps
 * @param {Object} runMetrics
 * @param {Array} allToolCalls
 * @param {TokenBudget} budget
 * @param {number} maxIterations
 */
export function emitProgress(deps, runMetrics, allToolCalls, budget, maxIterations) {
    if (!deps.eventBus) return;
    deps.eventBus.emit('agentic:megacode-progress', {
        elapsed: Date.now() - runMetrics.startTime,
        iterations: runMetrics.iterations,
        maxIterations,
        toolCallsCompleted: allToolCalls.length,
        toolErrors: runMetrics.toolErrors,
        compactions: runMetrics.compactions,
        doomWarnings: runMetrics.doomWarnings,
        retries: runMetrics.retries,
        tokensUsed: budget.toJSON(),
        timestamp: Date.now(),
    });
}
