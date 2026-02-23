/**
 * Tests for ai-provider.mjs — detectProvider and withRetry
 */

import { jest } from '@jest/globals';

// Mock config to avoid loading .env / real configuration
jest.mock('../../config.mjs', () => ({
    config: {
        ai: { provider: 'lmstudio', model: 'test-model', endpoint: null },
        keys: { openai: null, google: null },
    },
}));

import { detectProvider, AI_PROVIDERS, _testExports } from '../ai-provider.mjs';

const { withRetry } = _testExports;

// ─── detectProvider ──────────────────────────────────────────────────────

describe('detectProvider', () => {
    afterEach(() => {
        // Reset the one-time claude warning flag between tests
        detectProvider._claudeWarned = false;
    });

    test('returns "gemini" for "gemini-2.0-flash"', () => {
        expect(detectProvider('gemini-2.0-flash')).toBe(AI_PROVIDERS.GEMINI);
    });

    test('returns "gemini" for "models/gemini-pro"', () => {
        expect(detectProvider('models/gemini-pro')).toBe(AI_PROVIDERS.GEMINI);
    });

    test('returns "openai" for "gpt-4o"', () => {
        expect(detectProvider('gpt-4o')).toBe(AI_PROVIDERS.OPENAI);
    });

    test('returns "openai" for "o3-mini"', () => {
        expect(detectProvider('o3-mini')).toBe(AI_PROVIDERS.OPENAI);
    });

    test('returns "openai" for "claude-3-opus" (routed to OpenAI)', () => {
        expect(detectProvider('claude-3-opus')).toBe(AI_PROVIDERS.OPENAI);
    });

    test('returns "openai" for "claude-3-haiku"', () => {
        expect(detectProvider('claude-3-haiku')).toBe(AI_PROVIDERS.OPENAI);
    });

    test('returns "lmstudio" for "llama-3" (unknown model → fallback)', () => {
        expect(detectProvider('llama-3')).toBe(AI_PROVIDERS.LMSTUDIO);
    });

    test('returns "lmstudio" for "mistral-7b" (unknown model → fallback)', () => {
        expect(detectProvider('mistral-7b')).toBe(AI_PROVIDERS.LMSTUDIO);
    });

    test('emits claude deprecation warning only once', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        // First call — should warn
        detectProvider('claude-3-opus');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toMatch(/Anthropic Vertex SDK has been removed/);

        // Second call — should NOT warn again
        detectProvider('claude-3-haiku');
        expect(warnSpy).toHaveBeenCalledTimes(1);

        warnSpy.mockRestore();
    });
});

// ─── withRetry ───────────────────────────────────────────────────────────

describe('withRetry', () => {
    // Suppress console.warn noise from retry logging
    let warnSpy;
    beforeEach(() => {
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        warnSpy.mockRestore();
    });

    test('returns result on first success', async () => {
        const result = await withRetry(() => Promise.resolve('ok'));
        expect(result).toBe('ok');
    });

    test('retries on ECONNRESET then succeeds', async () => {
        let calls = 0;
        const fn = () => {
            calls++;
            if (calls === 1) {
                const err = new Error('connection reset');
                err.code = 'ECONNRESET';
                return Promise.reject(err);
            }
            return Promise.resolve('recovered');
        };

        const result = await withRetry(fn, 3, 1); // 1ms delay for fast tests
        expect(result).toBe('recovered');
        expect(calls).toBe(2);
    });

    test('does NOT retry non-retryable errors', async () => {
        let calls = 0;
        const fn = () => {
            calls++;
            return Promise.reject(new Error('some random error'));
        };

        await expect(withRetry(fn, 3, 1)).rejects.toThrow('some random error');
        expect(calls).toBe(1);
    });

    test('retries HTTP 429 responses', async () => {
        let calls = 0;
        const fn = () => {
            calls++;
            if (calls === 1) {
                return Promise.resolve({
                    ok: false,
                    status: 429,
                    headers: { get: () => null },
                });
            }
            return Promise.resolve({ ok: true, body: 'success' });
        };

        const result = await withRetry(fn, 3, 1);
        expect(result).toEqual({ ok: true, body: 'success' });
        expect(calls).toBe(2);
    });

    test('retries HTTP 503 responses', async () => {
        let calls = 0;
        const fn = () => {
            calls++;
            if (calls === 1) {
                return Promise.resolve({
                    ok: false,
                    status: 503,
                    headers: { get: () => null },
                });
            }
            return Promise.resolve({ ok: true, body: 'back up' });
        };

        const result = await withRetry(fn, 3, 1);
        expect(result).toEqual({ ok: true, body: 'back up' });
        expect(calls).toBe(2);
    });

    test('respects Retry-After header on 429', async () => {
        let calls = 0;
        const startTime = Date.now();
        const fn = () => {
            calls++;
            if (calls === 1) {
                return Promise.resolve({
                    ok: false,
                    status: 429,
                    headers: { get: (h) => (h === 'retry-after' ? '1' : null) },
                });
            }
            return Promise.resolve({ ok: true });
        };

        const result = await withRetry(fn, 3, 1);
        const elapsed = Date.now() - startTime;

        expect(result).toEqual({ ok: true });
        expect(calls).toBe(2);
        // Retry-After: 1 means 1 second = 1000ms; allow some tolerance
        expect(elapsed).toBeGreaterThanOrEqual(900);
    });

    test('gives up after max retries on persistent 429', async () => {
        let calls = 0;
        const fn = () => {
            calls++;
            return Promise.resolve({
                ok: false,
                status: 429,
                headers: { get: () => null },
            });
        };

        // 3 retries means 3 total attempts (loop runs i=0,1,2)
        const result = await withRetry(fn, 3, 1);
        expect(result.ok).toBe(false);
        expect(result.status).toBe(429);
        expect(calls).toBe(3);
    });

    test('does NOT retry HTTP 400 (client error)', async () => {
        let calls = 0;
        const fn = () => {
            calls++;
            return Promise.resolve({
                ok: false,
                status: 400,
                headers: { get: () => null },
            });
        };

        const result = await withRetry(fn, 3, 1);
        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
        expect(calls).toBe(1);
    });
});
