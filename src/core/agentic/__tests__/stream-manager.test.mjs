/**
 * stream-manager.test.mjs — Tests for StreamManager
 * @module src/core/agentic/__tests__/stream-manager.test
 */

import { StreamManager } from '../stream-manager.mjs';

describe('StreamManager', () => {
  it('should construct with default options (no callbacks → inactive)', () => {
    const sm = new StreamManager({});
    expect(sm).toBeDefined();
    // isActive requires at least one callback
    expect(sm.isActive).toBe(false);
  });

  it('should be active when onToken is provided', () => {
    const sm = new StreamManager({ onToken: () => {} });
    expect(sm.isActive).toBe(true);
  });

  it('should be active when onChunk is provided', () => {
    const sm = new StreamManager({ onChunk: () => {} });
    expect(sm.isActive).toBe(true);
  });

  it('should forward tokens to onToken callback', () => {
    const tokens = [];
    const sm = new StreamManager({ onToken: (t) => tokens.push(t) });
    sm.token('hello');
    sm.token(' world');
    expect(tokens).toEqual(['hello', ' world']);
  });

  it('should forward chunks to onChunk callback', () => {
    const chunks = [];
    const sm = new StreamManager({ onChunk: (c) => chunks.push(c) });
    sm.chunk({ type: 'text', text: 'hi' });
    expect(chunks).toHaveLength(1);
  });

  it('should suppress and resume token delivery', () => {
    const tokens = [];
    const sm = new StreamManager({ onToken: (t) => tokens.push(t) });
    sm.token('before');
    sm.suppress();
    expect(sm.isSuppressed).toBe(true);
    sm.token('suppressed');
    sm.resume();
    expect(sm.isSuppressed).toBe(false);
    sm.token('after');
    expect(tokens).toEqual(['before', 'after']);
  });

  it('should stop forwarding after dispose', () => {
    const tokens = [];
    const sm = new StreamManager({ onToken: (t) => tokens.push(t) });
    sm.token('ok');
    sm.dispose();
    sm.token('nope');
    expect(tokens).toEqual(['ok']);
    expect(sm.isActive).toBe(false);
  });

  it('should respect external AbortSignal', () => {
    const ac = new AbortController();
    const tokens = [];
    const sm = new StreamManager({ onToken: (t) => tokens.push(t), signal: ac.signal });
    sm.token('one');
    ac.abort();
    sm.token('two');
    expect(tokens).toEqual(['one']);
  });

  it('should buffer tokens when bufferSize > 0', () => {
    const tokens = [];
    const sm = new StreamManager({ onToken: (t) => tokens.push(t), bufferSize: 3 });
    sm.token('a');
    sm.token('b');
    expect(tokens).toEqual([]); // buffered, not yet flushed
    sm.token('c'); // triggers flush at size 3
    expect(tokens).toEqual(['abc']);
  });

  it('should flush remaining buffer on dispose', () => {
    const tokens = [];
    const sm = new StreamManager({ onToken: (t) => tokens.push(t), bufferSize: 5 });
    sm.token('x');
    sm.token('y');
    sm.dispose();
    expect(tokens).toEqual(['xy']); // flushed on dispose
  });

  it('should return callbacks via getCallbacks()', () => {
    const sm = new StreamManager({ onToken: () => {}, onChunk: () => {} });
    const cbs = sm.getCallbacks();
    expect(typeof cbs.onToken).toBe('function');
    expect(typeof cbs.onChunk).toBe('function');
  });
});
