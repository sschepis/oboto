/**
 * Unit tests for WsDispatcher
 * @see src/server/ws-dispatcher.mjs
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.unstable_mockModule('../../ui/console-styler.mjs', () => ({
    consoleStyler: { log: jest.fn() }
}));

const { WsDispatcher } = await import('../ws-dispatcher.mjs');

describe('WsDispatcher', () => {
    let dispatcher;

    beforeEach(() => {
        dispatcher = new WsDispatcher();
    });

    // ── Constructor ────────────────────────────────────────────────────

    describe('constructor', () => {
        it('starts with empty handler map', () => {
            expect(dispatcher.registeredTypes).toEqual([]);
        });
    });

    // ── register() ────────────────────────────────────────────────────

    describe('register()', () => {
        it('registers a handler for a message type', () => {
            const handler = jest.fn();
            dispatcher.register('chat', handler);
            expect(dispatcher.registeredTypes).toContain('chat');
        });

        it('overwrites a previously registered handler for the same type', () => {
            const handler1 = jest.fn();
            const handler2 = jest.fn();
            dispatcher.register('chat', handler1);
            dispatcher.register('chat', handler2);
            expect(dispatcher.registeredTypes.filter(t => t === 'chat')).toHaveLength(1);
        });

        it('registers handlers for multiple different types', () => {
            dispatcher.register('chat', jest.fn());
            dispatcher.register('file', jest.fn());
            dispatcher.register('task', jest.fn());
            expect(dispatcher.registeredTypes).toHaveLength(3);
            expect(dispatcher.registeredTypes).toContain('chat');
            expect(dispatcher.registeredTypes).toContain('file');
            expect(dispatcher.registeredTypes).toContain('task');
        });
    });

    // ── registerAll() ─────────────────────────────────────────────────

    describe('registerAll()', () => {
        it('registers all handlers from a handler map', () => {
            const handlerMap = {
                'chat': jest.fn(),
                'file': jest.fn(),
                'task': jest.fn(),
            };
            dispatcher.registerAll(handlerMap);
            expect(dispatcher.registeredTypes).toHaveLength(3);
            expect(dispatcher.registeredTypes).toContain('chat');
            expect(dispatcher.registeredTypes).toContain('file');
            expect(dispatcher.registeredTypes).toContain('task');
        });

        it('registers from an empty map without error', () => {
            dispatcher.registerAll({});
            expect(dispatcher.registeredTypes).toEqual([]);
        });

        it('merges with existing registrations', () => {
            dispatcher.register('existing', jest.fn());
            dispatcher.registerAll({ 'new1': jest.fn(), 'new2': jest.fn() });
            expect(dispatcher.registeredTypes).toHaveLength(3);
        });

        it('overwrites existing handlers with same type', async () => {
            const oldHandler = jest.fn();
            const newHandler = jest.fn().mockImplementation(async () => {});
            dispatcher.register('chat', oldHandler);
            dispatcher.registerAll({ 'chat': newHandler });

            await dispatcher.dispatch({ type: 'chat' }, {});
            expect(newHandler).toHaveBeenCalled();
            expect(oldHandler).not.toHaveBeenCalled();
        });
    });

    // ── dispatch() ────────────────────────────────────────────────────

    describe('dispatch()', () => {
        it('routes to the correct handler based on message type', async () => {
            const chatHandler = jest.fn().mockImplementation(async () => {});
            const fileHandler = jest.fn().mockImplementation(async () => {});
            dispatcher.register('chat', chatHandler);
            dispatcher.register('file', fileHandler);

            await dispatcher.dispatch({ type: 'chat', content: 'hello' }, { ws: {} });

            expect(chatHandler).toHaveBeenCalledWith(
                { type: 'chat', content: 'hello' },
                { ws: {} }
            );
            expect(fileHandler).not.toHaveBeenCalled();
        });

        it('returns true when handler is found and invoked', async () => {
            dispatcher.register('chat', jest.fn().mockImplementation(async () => {}));
            const result = await dispatcher.dispatch({ type: 'chat' }, {});
            expect(result).toBe(true);
        });

        it('returns false for unknown message types', async () => {
            dispatcher.register('chat', jest.fn());
            const result = await dispatcher.dispatch({ type: 'unknown-type' }, {});
            expect(result).toBe(false);
        });

        it('does not crash on unknown message types (silently ignores)', async () => {
            const result = await dispatcher.dispatch({ type: 'nonexistent' }, {});
            expect(result).toBe(false);
        });

        it('passes both data and ctx to the handler', async () => {
            const handler = jest.fn().mockImplementation(async () => {});
            dispatcher.register('test', handler);

            const data = { type: 'test', payload: { key: 'value' } };
            const ctx = { ws: {}, assistant: {} };

            await dispatcher.dispatch(data, ctx);

            expect(handler).toHaveBeenCalledWith(data, ctx);
        });

        it('awaits async handlers', async () => {
            let resolved = false;
            const asyncHandler = jest.fn().mockImplementation(async () => {
                await new Promise(r => setTimeout(r, 10));
                resolved = true;
            });
            dispatcher.register('async-test', asyncHandler);

            await dispatcher.dispatch({ type: 'async-test' }, {});
            expect(resolved).toBe(true);
        });

        it('propagates handler errors (uncaught)', async () => {
            const errorHandler = jest.fn().mockImplementation(async () => {
                throw new Error('handler failed');
            });
            dispatcher.register('error-type', errorHandler);

            await expect(
                dispatcher.dispatch({ type: 'error-type' }, {})
            ).rejects.toThrow('handler failed');
        });
    });

    // ── registeredTypes ───────────────────────────────────────────────

    describe('registeredTypes', () => {
        it('returns empty array when no handlers registered', () => {
            expect(dispatcher.registeredTypes).toEqual([]);
        });

        it('returns all registered type names', () => {
            dispatcher.register('a', jest.fn());
            dispatcher.register('b', jest.fn());
            dispatcher.register('c', jest.fn());
            expect(dispatcher.registeredTypes).toEqual(['a', 'b', 'c']);
        });

        it('returns a new array on each access (not a reference)', () => {
            dispatcher.register('test', jest.fn());
            const types1 = dispatcher.registeredTypes;
            const types2 = dispatcher.registeredTypes;
            expect(types1).not.toBe(types2);
            expect(types1).toEqual(types2);
        });
    });

    // ── Edge cases ────────────────────────────────────────────────────

    describe('edge cases', () => {
        it('handles dispatching with undefined type field', async () => {
            const result = await dispatcher.dispatch({}, {});
            expect(result).toBe(false);
        });

        it('handles dispatching with null type field', async () => {
            const result = await dispatcher.dispatch({ type: null }, {});
            expect(result).toBe(false);
        });

        it('can register and dispatch with numeric type (uncommon)', async () => {
            const handler = jest.fn().mockImplementation(async () => {});
            dispatcher.register(42, handler);
            const result = await dispatcher.dispatch({ type: 42 }, {});
            expect(result).toBe(true);
            expect(handler).toHaveBeenCalled();
        });

        it('can register handler that returns a value (ignored by dispatch)', async () => {
            const handler = jest.fn().mockImplementation(async () => 'return-value');
            dispatcher.register('test', handler);
            const result = await dispatcher.dispatch({ type: 'test' }, {});
            expect(result).toBe(true);
        });

        it('multiple sequential dispatches to same handler work correctly', async () => {
            const handler = jest.fn().mockImplementation(async () => {});
            dispatcher.register('repeat', handler);

            await dispatcher.dispatch({ type: 'repeat', seq: 1 }, {});
            await dispatcher.dispatch({ type: 'repeat', seq: 2 }, {});
            await dispatcher.dispatch({ type: 'repeat', seq: 3 }, {});

            expect(handler).toHaveBeenCalledTimes(3);
            expect(handler).toHaveBeenNthCalledWith(1, { type: 'repeat', seq: 1 }, {});
            expect(handler).toHaveBeenNthCalledWith(2, { type: 'repeat', seq: 2 }, {});
            expect(handler).toHaveBeenNthCalledWith(3, { type: 'repeat', seq: 3 }, {});
        });
    });
});
