/**
 * Shared guidance formatting utility.
 *
 * Provides a consistent prompt-injection format for user guidance messages
 * across all agentic providers (Eventic, LMScript, Cognitive, etc.).
 *
 * @module src/core/guidance-formatter
 */

/**
 * Format user guidance entries into a prompt block for LLM injection.
 *
 * Each entry is a timestamped object produced by EventicFacade.drainGuidanceQueue().
 * The output is wrapped in `[USER GUIDANCE]…[/USER GUIDANCE]` delimiters so
 * the LLM can distinguish injected user commentary from system instructions.
 *
 * @param {Array<{timestamp: number, message: string, source?: string}>} entries
 * @returns {string} Formatted guidance block, or empty string if no entries.
 */
export function formatGuidanceBlock(entries) {
    if (!entries || entries.length === 0) return '';
    const lines = entries.map((e, i) => {
        const time = new Date(e.timestamp).toLocaleTimeString();
        const source = e.source ? ` (${e.source})` : '';
        return `  ${i + 1}. [${time}]${source} ${e.message}`;
    });
    return `\n\n[USER GUIDANCE — The user has injected the following guidance/commentary while you are working. Read carefully and adjust your approach accordingly.]\n${lines.join('\n')}\n[/USER GUIDANCE]\n`;
}
