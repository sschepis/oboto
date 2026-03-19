/**
 * request-deduplicator.test.mjs — Tests for RequestDeduplicator
 * @module src/core/agentic/__tests__/request-deduplicator.test
 */

import { RequestDeduplicator } from '../request-deduplicator.mjs';

describe('RequestDeduplicator', () => {
  it('should construct with default options', () => {
    const d = new RequestDeduplicator();
    expect(d.size).toBe(0);
  });

  it('should generate deterministic keys', () => {
    const d = new RequestDeduplicator();
    const k1 = d.makeKey('hello', 'gpt-4', 'abc');
    const k2 = d.makeKey('hello', 'gpt-4', 'abc');
    expect(k1).toBe(k2);
    expect(k1).toHaveLength(16);
  });

  it('should produce different keys for different inputs', () => {
    const d = new RequestDeduplicator();
    const k1 = d.makeKey('hello', 'gpt-4', 'abc');
    const k2 = d.makeKey('world', 'gpt-4', 'abc');
    expect(k1).not.toBe(k2);
  });

  it('should deduplicate concurrent identical requests', async () => {
    const d = new RequestDeduplicator();
    let callCount = 0;
    const fn = async () => { callCount++; return 'result'; };

    const key = d.makeKey('test', 'model', '');
    const [r1, r2] = await Promise.all([
      d.dedupe(key, fn),
      d.dedupe(key, fn),
    ]);

    expect(callCount).toBe(1);
    expect(r1).toBe('result');
    expect(r2).toBe('result');
  });

  it('should remove failed requests immediately for retry', async () => {
    const d = new RequestDeduplicator();
    const key = d.makeKey('fail', 'model', '');
    let attempt = 0;

    const failFn = async () => { attempt++; throw new Error('fail'); };
    const successFn = async () => { attempt++; return 'ok'; };

    await expect(d.dedupe(key, failFn)).rejects.toThrow('fail');
    expect(d.has(key)).toBe(false);

    const result = await d.dedupe(key, successFn);
    expect(result).toBe('ok');
    expect(attempt).toBe(2);
  });

  it('should evict entries when over maxEntries limit (while loop fix)', () => {
    const d = new RequestDeduplicator({ maxEntries: 2, ttlMs: 60000 });
    // Manually populate beyond limit
    d._inflight.set('a', { promise: Promise.resolve(), timestamp: Date.now() - 1000 });
    d._inflight.set('b', { promise: Promise.resolve(), timestamp: Date.now() - 500 });
    d._inflight.set('c', { promise: Promise.resolve(), timestamp: Date.now() });
    d._cleanup();
    expect(d._inflight.size).toBeLessThanOrEqual(2);
  });

  it('should clear all entries on dispose', () => {
    const d = new RequestDeduplicator();
    d._inflight.set('x', { promise: Promise.resolve(), timestamp: Date.now() });
    d.dispose();
    expect(d.size).toBe(0);
  });
});
