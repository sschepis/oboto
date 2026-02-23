/**
 * Tests for ws-utils.mjs — WebSocket utility functions
 */

import { jest } from '@jest/globals';
import { wsSend, wsSendError, requireService, wsHandler } from '../ws-utils.mjs';

// ─── Helpers ─────────────────────────────────────────────────────────────

function createMockWs() {
    const sent = [];
    return {
        readyState: 1, // OPEN
        send: jest.fn((data) => sent.push(JSON.parse(data))),
        _sent: sent,
    };
}

// ─── wsSend ──────────────────────────────────────────────────────────────

describe('wsSend', () => {
    test('sends JSON { type, payload } when ws.readyState === 1', () => {
        const ws = createMockWs();
        wsSend(ws, 'test-type', { foo: 'bar' });

        expect(ws.send).toHaveBeenCalledTimes(1);
        expect(ws._sent).toEqual([{ type: 'test-type', payload: { foo: 'bar' } }]);
    });

    test('does NOT send when ws.readyState !== 1', () => {
        for (const state of [0, 2, 3]) {
            const ws = createMockWs();
            ws.readyState = state;
            wsSend(ws, 'test-type', 'data');
            expect(ws.send).not.toHaveBeenCalled();
        }
    });

    test('does NOT throw if ws is null or undefined', () => {
        expect(() => wsSend(null, 'x', 'y')).not.toThrow();
        expect(() => wsSend(undefined, 'x', 'y')).not.toThrow();
    });
});

// ─── wsSendError ─────────────────────────────────────────────────────────

describe('wsSendError', () => {
    test('calls wsSend with "error" type by default', () => {
        const ws = createMockWs();
        wsSendError(ws, 'something broke');

        expect(ws._sent).toEqual([{ type: 'error', payload: 'something broke' }]);
    });

    test('allows custom error type', () => {
        const ws = createMockWs();
        wsSendError(ws, 'not found', 'custom-error');

        expect(ws._sent).toEqual([{ type: 'custom-error', payload: 'not found' }]);
    });
});

// ─── requireService ──────────────────────────────────────────────────────

describe('requireService', () => {
    test('resolves a simple path like "toolExecutor"', () => {
        const ws = createMockWs();
        const executor = { run: jest.fn() };
        const ctx = { ws, assistant: { toolExecutor: executor } };

        const result = requireService(ctx, 'toolExecutor');
        expect(result).toBe(executor);
        expect(ws.send).not.toHaveBeenCalled();
    });

    test('resolves a dotted path like "toolExecutor.surfaceManager"', () => {
        const ws = createMockWs();
        const sm = { list: jest.fn() };
        const ctx = { ws, assistant: { toolExecutor: { surfaceManager: sm } } };

        const result = requireService(ctx, 'toolExecutor.surfaceManager');
        expect(result).toBe(sm);
        expect(ws.send).not.toHaveBeenCalled();
    });

    test('returns null and sends error when service is missing', () => {
        const ws = createMockWs();
        const ctx = { ws, assistant: {} };

        const result = requireService(ctx, 'toolExecutor');
        expect(result).toBeNull();
        expect(ws._sent).toEqual([
            { type: 'error', payload: 'toolExecutor not available' },
        ]);
    });

    test('returns null and sends error when intermediate path segment is missing', () => {
        const ws = createMockWs();
        const ctx = { ws, assistant: { toolExecutor: {} } };

        const result = requireService(ctx, 'toolExecutor.surfaceManager');
        expect(result).toBeNull();
        expect(ws._sent).toEqual([
            { type: 'error', payload: 'toolExecutor.surfaceManager not available' },
        ]);
    });

    test('uses custom label in error message when provided', () => {
        const ws = createMockWs();
        const ctx = { ws, assistant: {} };

        requireService(ctx, 'toolExecutor.surfaceManager', 'Surface manager');
        expect(ws._sent).toEqual([
            { type: 'error', payload: 'Surface manager not available' },
        ]);
    });
});

// ─── wsHandler ───────────────────────────────────────────────────────────

describe('wsHandler', () => {
    test('calls the wrapped function with (data, ctx, null) when no require option', async () => {
        const fn = jest.fn();
        const handler = wsHandler(fn);
        const ws = createMockWs();
        const ctx = { ws, assistant: {} };
        const data = { key: 'value' };

        await handler(data, ctx);

        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith(data, ctx, null);
    });

    test('resolves service and passes as 3rd arg svc when require is set', async () => {
        const fn = jest.fn();
        const sm = { list: jest.fn() };
        const handler = wsHandler(fn, {
            require: 'toolExecutor.surfaceManager',
            requireLabel: 'Surface manager',
        });
        const ws = createMockWs();
        const ctx = { ws, assistant: { toolExecutor: { surfaceManager: sm } } };

        await handler({ action: 'list' }, ctx);

        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith({ action: 'list' }, ctx, sm);
    });

    test('returns early (does not call fn) when required service is missing', async () => {
        const fn = jest.fn();
        const handler = wsHandler(fn, { require: 'missingService' });
        const ws = createMockWs();
        const ctx = { ws, assistant: {} };

        await handler({}, ctx);

        expect(fn).not.toHaveBeenCalled();
        expect(ws._sent).toEqual([
            { type: 'error', payload: 'missingService not available' },
        ]);
    });

    test('catches errors from the wrapped function and sends them via ws', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('handler boom'));
        const handler = wsHandler(fn);
        const ws = createMockWs();
        const ctx = { ws, assistant: {} };

        await handler({}, ctx);

        expect(ws._sent).toEqual([
            { type: 'error', payload: 'handler boom' },
        ]);
    });

    test('uses errorPrefix in error messages when provided', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('oops'));
        const handler = wsHandler(fn, { errorPrefix: 'SurfaceOp' });
        const ws = createMockWs();
        const ctx = { ws, assistant: {} };

        await handler({}, ctx);

        expect(ws._sent).toEqual([
            { type: 'error', payload: 'SurfaceOp: oops' },
        ]);
    });

    test('uses errorType for error messages when provided', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('fail'));
        const handler = wsHandler(fn, { errorType: 'surface-error' });
        const ws = createMockWs();
        const ctx = { ws, assistant: {} };

        await handler({}, ctx);

        expect(ws._sent).toEqual([
            { type: 'surface-error', payload: 'fail' },
        ]);
    });
});
