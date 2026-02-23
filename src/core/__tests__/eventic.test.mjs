/**
 * Tests for eventic.mjs — Eventic core engine, defaultTools plugin
 */

import { jest } from '@jest/globals';
import { Eventic, defaultSchemas, defaultTools } from '../eventic.mjs';

// ─── Constructor ─────────────────────────────────────────────────────────

describe('Eventic constructor', () => {
    test('creates instance with default context fields', () => {
        const engine = new Eventic({ logHandlers: [] });
        expect(engine.context).toMatchObject({
            goal: '',
            mode: 'interactive',
            status: 'idle',
            plan: [],
            results: [],
            memory: {},
            files: {},
            metrics: expect.objectContaining({
                totalSteps: 0,
                completedSteps: 0,
                score: 100,
                history: [],
            }),
        });
    });

    test('merges custom context from options', () => {
        const engine = new Eventic({
            context: { goal: 'test-goal', customField: 42 },
            logHandlers: [],
        });
        expect(engine.context.goal).toBe('test-goal');
        expect(engine.context.customField).toBe(42);
        // defaults still present
        expect(engine.context.status).toBe('idle');
    });

    test('accepts tools as an object and stores them in a Map', () => {
        const myTool = async () => 'result';
        const engine = new Eventic({ tools: { myTool }, logHandlers: [] });
        expect(engine.tools).toBeInstanceOf(Map);
        expect(engine.tools.get('myTool')).toBe(myTool);
    });

    test('accepts logHandlers array', () => {
        const handler = jest.fn();
        const engine = new Eventic({ logHandlers: [handler] });
        expect(engine.logHandlers).toEqual([handler]);
    });
});

// ─── Plugin system (use) ─────────────────────────────────────────────────

describe('Eventic.use()', () => {
    test('registers an AI provider plugin', () => {
        const engine = new Eventic({ logHandlers: [] });
        const provider = { ask: jest.fn(), clearHistory: jest.fn() };
        engine.use({ type: 'ai', provider });
        expect(engine.ai).toBe(provider);
    });

    test('registers a tool plugin', () => {
        const engine = new Eventic({ logHandlers: [] });
        const execute = jest.fn();
        engine.use({ type: 'tool', name: 'myTool', execute });
        expect(engine.tools.get('myTool')).toBe(execute);
    });

    test('calls install() for generic plugins', () => {
        const engine = new Eventic({ logHandlers: [] });
        const install = jest.fn();
        engine.use({ install });
        expect(install).toHaveBeenCalledWith(engine);
    });

    test('returns this for chaining', () => {
        const engine = new Eventic({ logHandlers: [] });
        const result = engine.use({ install: jest.fn() });
        expect(result).toBe(engine);
    });
});

// ─── Tool registration ──────────────────────────────────────────────────

describe('Eventic.registerTool()', () => {
    test('stores the function in engine.tools', () => {
        const engine = new Eventic({ logHandlers: [] });
        const fn = async () => {};
        engine.registerTool('testTool', fn);
        expect(engine.tools.get('testTool')).toBe(fn);
    });

    test('returns this for chaining', () => {
        const engine = new Eventic({ logHandlers: [] });
        const result = engine.registerTool('x', () => {});
        expect(result).toBe(engine);
    });
});

// ─── Handler registration ───────────────────────────────────────────────

describe('Eventic.registerHandler()', () => {
    test('stores the handler', () => {
        const engine = new Eventic({ logHandlers: [] });
        const fn = jest.fn();
        engine.registerHandler('onStart', fn);
        expect(engine.handlers.get('onStart')).toBe(fn);
    });

    test('returns this for chaining', () => {
        const engine = new Eventic({ logHandlers: [] });
        const result = engine.registerHandler('onStart', jest.fn());
        expect(result).toBe(engine);
    });
});

// ─── Dispatch ────────────────────────────────────────────────────────────

describe('Eventic.dispatch()', () => {
    test('dispatches to a registered handler with correct arguments', async () => {
        const engine = new Eventic({ logHandlers: [] });
        const handler = jest.fn().mockResolvedValue('done');
        engine.registerHandler('run', handler);

        const payload = { data: 1 };
        await engine.dispatch('run', payload);

        expect(handler).toHaveBeenCalledTimes(1);
        const [ctx, pl, logFn, dispatchFn, eng] = handler.mock.calls[0];
        expect(ctx).toBe(engine.context);
        expect(pl).toBe(payload);
        expect(typeof logFn).toBe('function');
        expect(typeof dispatchFn).toBe('function');
        expect(eng).toBe(engine);
    });

    test('throws if handler does not exist', async () => {
        const engine = new Eventic({ logHandlers: [] });
        await expect(engine.dispatch('nonexistent')).rejects.toThrow(
            '[ERROR] Missing handler: nonexistent'
        );
    });

    test('sets ctx.status = "error" on handler error', async () => {
        const engine = new Eventic({ logHandlers: [] });
        engine.registerHandler('fail', async () => {
            throw new Error('boom');
        });

        await expect(engine.dispatch('fail')).rejects.toThrow('boom');
        expect(engine.context.status).toBe('error');
    });

    test('passes this.dispatch.bind(this) so handlers can dispatch recursively', async () => {
        const engine = new Eventic({ logHandlers: [] });
        const innerHandler = jest.fn().mockResolvedValue('inner-result');
        engine.registerHandler('inner', innerHandler);

        engine.registerHandler('outer', async (ctx, payload, log, dispatch) => {
            return await dispatch('inner', { from: 'outer' });
        });

        const result = await engine.dispatch('outer');
        expect(result).toBe('inner-result');
        expect(innerHandler).toHaveBeenCalledTimes(1);
        expect(innerHandler.mock.calls[0][1]).toEqual({ from: 'outer' });
    });
});

// ─── Log ─────────────────────────────────────────────────────────────────

describe('Eventic.log()', () => {
    test('calls all log handlers with the message', () => {
        const h1 = jest.fn();
        const h2 = jest.fn();
        const engine = new Eventic({ logHandlers: [h1, h2] });
        engine.log('hello');
        expect(h1).toHaveBeenCalledWith('hello');
        expect(h2).toHaveBeenCalledWith('hello');
    });

    test('handles non-function log handlers gracefully', () => {
        const engine = new Eventic({ logHandlers: ['not-a-function', null, 42] });
        // Should not throw
        expect(() => engine.log('test')).not.toThrow();
    });
});

// ─── defaultTools plugin ─────────────────────────────────────────────────

describe('defaultTools plugin', () => {
    test('install registers expected tools', () => {
        const engine = new Eventic({ logHandlers: [] });
        defaultTools.install(engine);

        const expectedTools = [
            'web_search',
            'database_save',
            'database_get',
            'database_query',
            'database_save_memory',
            'bash',
            'file_read',
            'file_write',
            'file_list',
            'file_exists',
            'file_delete',
        ];

        for (const name of expectedTools) {
            expect(engine.tools.has(name)).toBe(true);
            expect(typeof engine.tools.get(name)).toBe('function');
        }
    });

    test('file_write and file_read work together', async () => {
        const engine = new Eventic({ logHandlers: [] });
        defaultTools.install(engine);

        const write = engine.tools.get('file_write');
        const read = engine.tools.get('file_read');

        await write('test.txt', 'hello world');
        const content = await read('test.txt');
        expect(content).toBe('hello world');
    });
});
