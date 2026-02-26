/**
 * Tests for ai-provider.mjs — detectProvider and withRetry
 */

import { jest } from '@jest/globals';
import { detectProvider, AI_PROVIDERS, _testExports } from '../ai-provider.mjs';
import { consoleStyler } from '../../ui/console-styler.mjs';

const { withRetry, isCancellationError } = _testExports;

// Spy on consoleStyler.log so we can intercept warnings from the refactored code.
// In ESM, jest.mock() is unreliable; spying on the live singleton works reliably.
let consoleStylerLogSpy;

// ─── detectProvider ──────────────────────────────────────────────────────

describe('detectProvider', () => {
    beforeEach(() => {
        consoleStylerLogSpy = jest.spyOn(consoleStyler, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        // Reset the one-time claude warning flag between tests
        detectProvider._claudeWarned = false;
        consoleStylerLogSpy.mockRestore();
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
        // First call — should warn via consoleStyler.log('warning', ...)
        detectProvider('claude-3-opus');
        const warningCalls = consoleStylerLogSpy.mock.calls.filter(
            ([type]) => type === 'warning'
        );
        expect(warningCalls.length).toBe(1);
        expect(warningCalls[0][1]).toMatch(/Anthropic Vertex SDK has been removed/);

        // Second call — should NOT warn again
        detectProvider('claude-3-haiku');
        const warningCallsAfter = consoleStylerLogSpy.mock.calls.filter(
            ([type]) => type === 'warning'
        );
        expect(warningCallsAfter.length).toBe(1);
    });
});

// ─── withRetry ───────────────────────────────────────────────────────────

describe('withRetry', () => {
    // Retry logging now goes through consoleStyler.log — spy and suppress output.
    beforeEach(() => {
        consoleStylerLogSpy = jest.spyOn(consoleStyler, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        consoleStylerLogSpy.mockRestore();
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

    test('does NOT retry cancellation errors (AbortError)', async () => {
        let calls = 0;
        const fn = () => {
            calls++;
            const err = new Error('aborted');
            err.name = 'AbortError';
            return Promise.reject(err);
        };

        await expect(withRetry(fn, 3, 1)).rejects.toThrow('aborted');
        expect(calls).toBe(1);
    });

    test('does NOT retry Gemini 499 cancellation errors', async () => {
        let calls = 0;
        const fn = () => {
            calls++;
            const err = new Error('{"status":"CANCELLED"}');
            err.status = 499;
            return Promise.reject(err);
        };

        await expect(withRetry(fn, 3, 1)).rejects.toThrow();
        expect(calls).toBe(1);
    });
});

// ─── isCancellationError ─────────────────────────────────────────────────

describe('isCancellationError', () => {
    test('returns false for null/undefined', () => {
        expect(isCancellationError(null)).toBe(false);
        expect(isCancellationError(undefined)).toBe(false);
    });

    test('returns false for a generic Error', () => {
        expect(isCancellationError(new Error('something went wrong'))).toBe(false);
    });

    test('returns true for AbortError', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        expect(isCancellationError(err)).toBe(true);
    });

    test('returns true for CancellationError', () => {
        const err = new Error('cancelled');
        err.name = 'CancellationError';
        expect(isCancellationError(err)).toBe(true);
    });

    test('returns true for status 499 (Gemini cancellation)', () => {
        const err = new Error('request failed');
        err.status = 499;
        expect(isCancellationError(err)).toBe(true);
    });

    test('returns true when message contains "CANCELLED" status', () => {
        const err = new Error('{"status":"CANCELLED","message":"The operation was cancelled"}');
        expect(isCancellationError(err)).toBe(true);
    });

    test('returns true when message contains "The operation was cancelled"', () => {
        const err = new Error('The operation was cancelled by the client');
        expect(isCancellationError(err)).toBe(true);
    });

    test('returns false for HTTP error codes that are not 499', () => {
        const err = new Error('server error');
        err.status = 500;
        expect(isCancellationError(err)).toBe(false);
    });

    test('returns false for retryable network errors', () => {
        const err = new Error('connection reset');
        err.code = 'ECONNRESET';
        expect(isCancellationError(err)).toBe(false);
    });
});
