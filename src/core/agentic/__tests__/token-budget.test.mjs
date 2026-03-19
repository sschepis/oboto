/**
 * token-budget.test.mjs — Tests for TokenBudget
 * @module src/core/agentic/__tests__/token-budget.test
 */

import { TokenBudget } from '../token-budget.mjs';

describe('TokenBudget', () => {
  it('should construct with zero usage', () => {
    const tb = new TokenBudget();
    expect(tb.promptTokens).toBe(0);
    expect(tb.completionTokens).toBe(0);
    expect(tb.totalTokens).toBe(0);
    expect(tb.callCount).toBe(0);
    expect(tb.hasData).toBe(false);
  });

  it('should accumulate usage across multiple add() calls', () => {
    const tb = new TokenBudget();
    tb.add({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 });
    tb.add({ prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 });
    expect(tb.promptTokens).toBe(300);
    expect(tb.completionTokens).toBe(150);
    expect(tb.totalTokens).toBe(450);
    expect(tb.callCount).toBe(2);
    expect(tb.hasData).toBe(true);
  });

  it('should accept camelCase usage format', () => {
    const tb = new TokenBudget();
    tb.add({ promptTokens: 50, completionTokens: 25, totalTokens: 75 });
    expect(tb.promptTokens).toBe(50);
    expect(tb.completionTokens).toBe(25);
    expect(tb.totalTokens).toBe(75);
  });

  it('should handle null/undefined gracefully', () => {
    const tb = new TokenBudget();
    tb.add(null);
    tb.add(undefined);
    expect(tb.callCount).toBe(0);
    expect(tb.totalTokens).toBe(0);
  });

  it('should merge another TokenBudget', () => {
    const tb1 = new TokenBudget();
    tb1.add({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 });
    const tb2 = new TokenBudget();
    tb2.add({ prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 });
    tb1.merge(tb2);
    expect(tb1.promptTokens).toBe(300);
    expect(tb1.completionTokens).toBe(150);
    expect(tb1.totalTokens).toBe(450);
    expect(tb1.callCount).toBe(2);
  });

  it('should reset all counters', () => {
    const tb = new TokenBudget();
    tb.add({ prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 });
    tb.reset();
    expect(tb.totalTokens).toBe(0);
    expect(tb.callCount).toBe(0);
    expect(tb.hasData).toBe(false);
  });

  it('should serialize to JSON with snake_case keys', () => {
    const tb = new TokenBudget();
    tb.add({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    const json = tb.toJSON();
    expect(json).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      call_count: 1,
    });
  });
});
