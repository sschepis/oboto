/**
 * Tests for megacode-provider.mjs — MegacodeProvider with status reporting
 */

import { jest } from '@jest/globals';

// Mock status-reporter
const mockEmitStatus = jest.fn();
const mockEmitCommentary = jest.fn();

jest.unstable_mockModule('../../../status-reporter.mjs', () => ({
    emitStatus: mockEmitStatus,
    emitCommentary: mockEmitCommentary,
    describeToolCall: jest.fn((name) => name),
    summarizeInput: jest.fn((input) => `"${(input || '').substring(0, 20)}"`),
}));

// Mock ActivityTracker
jest.unstable_mockModule('../../../activity-tracker.mjs', () => ({
    ActivityTracker: jest.fn().mockImplementation(() => ({
        setActivity: jest.fn(),
        stop: jest.fn(),
    })),
}));

const { MegacodeProvider } = await import('../megacode-provider.mjs');

// ─── Test helpers ──────────────────────────────────────────────────────

function makeDeps(overrides = {}) {
    return {
        aiProvider: {
            askWithMessages: jest.fn().mockResolvedValue('{"action":"respond","response":"Hello!"}'),
        },
        toolExecutor: {
            getAllToolDefinitions: jest.fn().mockReturnValue([]),
            executeTool: jest.fn().mockResolvedValue({ content: 'result' }),
        },
        historyManager: {
            addMessage: jest.fn(),
        },
        eventBus: {
            emit: jest.fn(),
        },
        workingDir: '/test',
        facade: null,
        ...overrides,
    };
}

// ─── Tests ─────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
});

describe('MegacodeProvider', () => {
    describe('identity', () => {
        test('has correct id', () => {
            const provider = new MegacodeProvider();
            expect(provider.id).toBe('megacode');
        });

        test('has correct name', () => {
            const provider = new MegacodeProvider();
            expect(provider.name).toBe('Megacode Provider');
        });

        test('has a description', () => {
            const provider = new MegacodeProvider();
            expect(provider.description).toBeTruthy();
            expect(provider.description).toContain('ReAct');
        });
    });

    describe('initialize()', () => {
        test('creates ReactLoop and emits status', async () => {
            const provider = new MegacodeProvider();
            const deps = makeDeps();

            await provider.initialize(deps);

            expect(mockEmitStatus).toHaveBeenCalledWith('Megacode provider initialized');
        });

        test('accepts configuration options', async () => {
            const provider = new MegacodeProvider({
                maxIterations: 10,
                contextLimit: 50000,
                retryAttempts: 5,
            });
            const deps = makeDeps();

            await provider.initialize(deps);

            const diag = provider.getDiagnostics();
            expect(diag.hasReactLoop).toBe(true);
            expect(diag.options.maxIterations).toBe(10);
        });
    });

    describe('run()', () => {
        test('throws when not initialized', async () => {
            const provider = new MegacodeProvider();
            await expect(provider.run('Hello')).rejects.toThrow('not initialized');
        });

        test('returns response from ReactLoop', async () => {
            const provider = new MegacodeProvider();
            const deps = makeDeps();
            await provider.initialize(deps);

            const result = await provider.run('Hello');

            expect(result.response).toBe('Hello!');
        });

        test('emits turn start status', async () => {
            const provider = new MegacodeProvider();
            const deps = makeDeps();
            await provider.initialize(deps);

            await provider.run('Hello');

            expect(mockEmitStatus).toHaveBeenCalledWith(
                expect.stringContaining('Starting megacode turn')
            );
        });

        test('emits turn complete commentary', async () => {
            const provider = new MegacodeProvider();
            const deps = makeDeps();
            await provider.initialize(deps);

            await provider.run('Hello');

            expect(mockEmitCommentary).toHaveBeenCalledWith(
                expect.stringContaining('Turn 1 complete')
            );
        });

        test('saves user message to history', async () => {
            const provider = new MegacodeProvider();
            const deps = makeDeps();
            await provider.initialize(deps);

            await provider.run('Test input');

            expect(deps.historyManager.addMessage).toHaveBeenCalledWith({
                role: 'user',
                content: 'Test input',
            });
        });

        test('saves assistant response to history with metadata', async () => {
            const provider = new MegacodeProvider();
            const deps = makeDeps();
            await provider.initialize(deps);

            await provider.run('Test input');

            expect(deps.historyManager.addMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    role: 'assistant',
                    content: 'Hello!',
                    metadata: expect.objectContaining({
                        provider: 'megacode',
                    }),
                })
            );
        });

        test('emits agentic:turn-complete event', async () => {
            const provider = new MegacodeProvider();
            const deps = makeDeps();
            await provider.initialize(deps);

            await provider.run('Hello');

            expect(deps.eventBus.emit).toHaveBeenCalledWith(
                'agentic:turn-complete',
                expect.objectContaining({
                    provider: 'megacode',
                    turnNumber: 1,
                })
            );
        });

        test('increments turn count', async () => {
            const provider = new MegacodeProvider();
            const deps = makeDeps();
            await provider.initialize(deps);

            await provider.run('First');
            await provider.run('Second');

            const diag = provider.getDiagnostics();
            expect(diag.turnCount).toBe(2);
        });

        test('handles cancellation gracefully', async () => {
            const provider = new MegacodeProvider();
            const deps = makeDeps({
                aiProvider: {
                    askWithMessages: jest.fn().mockImplementation(() => {
                        const err = new Error('Aborted');
                        err.name = 'AbortError';
                        throw err;
                    }),
                },
            });
            await provider.initialize(deps);

            const controller = new AbortController();
            controller.abort();

            const result = await provider.run('Hello', { signal: controller.signal });

            expect(result.response).toContain('cancelled');
            expect(mockEmitStatus).toHaveBeenCalledWith(
                expect.stringContaining('cancelled')
            );
        });

        test('emits error commentary on non-cancellation error', async () => {
            const provider = new MegacodeProvider();
            const deps = makeDeps({
                aiProvider: {
                    askWithMessages: jest.fn().mockImplementation(() => {
                        const err = new Error('Auth failed');
                        err.status = 401;
                        throw err;
                    }),
                },
            });
            await provider.initialize(deps);

            await expect(provider.run('Hello')).rejects.toThrow('Auth failed');
            expect(mockEmitCommentary).toHaveBeenCalledWith(
                expect.stringContaining('Megacode provider error')
            );
        });

        test('includes metadata in response', async () => {
            const provider = new MegacodeProvider();
            const deps = makeDeps();
            await provider.initialize(deps);

            const result = await provider.run('Hello');

            expect(result.metadata).toBeDefined();
            expect(result.metadata.provider).toBe('megacode');
        });
    });

    describe('healthCheck()', () => {
        test('returns unhealthy when not initialized', async () => {
            const provider = new MegacodeProvider();
            const result = await provider.healthCheck();
            expect(result.healthy).toBe(false);
        });

        test('returns healthy when properly initialized', async () => {
            const provider = new MegacodeProvider();
            await provider.initialize(makeDeps());
            const result = await provider.healthCheck();
            expect(result.healthy).toBe(true);
        });

        test('returns unhealthy when aiProvider missing', async () => {
            const provider = new MegacodeProvider();
            await provider.initialize(makeDeps({ aiProvider: null }));
            const result = await provider.healthCheck();
            expect(result.healthy).toBe(false);
            expect(result.reason).toContain('aiProvider');
        });
    });

    describe('dispose()', () => {
        test('resets state', async () => {
            const provider = new MegacodeProvider();
            await provider.initialize(makeDeps());

            await provider.run('Hello');
            await provider.dispose();

            const diag = provider.getDiagnostics();
            expect(diag.turnCount).toBe(0);
            expect(diag.hasReactLoop).toBe(false);
        });
    });

    describe('getDiagnostics()', () => {
        test('returns diagnostics info', async () => {
            const provider = new MegacodeProvider({ maxIterations: 10 });
            await provider.initialize(makeDeps());

            const diag = provider.getDiagnostics();

            expect(diag.turnCount).toBe(0);
            expect(diag.hasReactLoop).toBe(true);
            expect(diag.options.maxIterations).toBe(10);
        });
    });
});
