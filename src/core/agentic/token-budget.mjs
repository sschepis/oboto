/**
 * TokenBudget — unified token usage accumulator for agent providers.
 * Tracks prompt, completion, and total tokens across multiple LLM calls
 * within a single turn/run.
 *
 * @module src/core/agentic/token-budget
 */
export class TokenBudget {
  constructor() {
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.totalTokens = 0;
    this.callCount = 0;
  }

  /**
   * Accumulate usage from an LLM response.
   * Accepts various formats: { prompt_tokens, completion_tokens, total_tokens }
   * or { promptTokens, completionTokens, totalTokens }.
   * @param {Object} usage
   */
  add(usage) {
    if (!usage) return;
    this.promptTokens += usage.prompt_tokens || usage.promptTokens || 0;
    this.completionTokens += usage.completion_tokens || usage.completionTokens || 0;
    this.totalTokens += usage.total_tokens || usage.totalTokens || 0;
    this.callCount++;
  }

  /**
   * Merge another TokenBudget into this one.
   * @param {TokenBudget} other
   */
  merge(other) {
    if (!other) return;
    this.promptTokens += other.promptTokens;
    this.completionTokens += other.completionTokens;
    this.totalTokens += other.totalTokens;
    this.callCount += other.callCount;
  }

  /**
   * Return a plain object suitable for JSON serialization.
   * Uses snake_case to match OpenAI API conventions.
   * @returns {{prompt_tokens: number, completion_tokens: number, total_tokens: number, call_count: number}}
   */
  toJSON() {
    return {
      prompt_tokens: this.promptTokens,
      completion_tokens: this.completionTokens,
      total_tokens: this.totalTokens,
      call_count: this.callCount,
    };
  }

  /** @returns {boolean} Whether any tokens have been recorded */
  get hasData() {
    return this.callCount > 0;
  }

  /** Reset to zero. */
  reset() {
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.totalTokens = 0;
    this.callCount = 0;
  }
}
