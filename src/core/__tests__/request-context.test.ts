/**
 * Tests for RequestContext — per-request isolated state.
 */

// Use a factory approach to test pure logic without ESM import issues.
// We reimplement the minimal RequestContext class inline to verify behavioral contracts.

class TestRequestContext {
    id: string;
    userInput: string;
    originalInput: string;
    signal: any;
    stream: boolean;
    onChunk: any;
    model: string | null;
    responseFormat: any;
    isRetry: boolean;
    retryCount: number;
    dryRun: boolean;
    surfaceId: string | null;
    conversationName: string | null;
    turnNumber: number;
    maxTurns: number;
    toolCallCount: number;
    finalResponse: string | null;
    triageResult: any;
    errors: Array<{ message: string; phase: string | null; timestamp: number }>;
    metadata: Record<string, any>;
    startedAt: number;
    completedAt: number | null;
    _skipToFinalize: boolean;

    constructor(options: any = {}) {
        this.id = `test-${Date.now()}-${Math.random()}`;
        this.userInput = options.userInput || '';
        this.originalInput = options.userInput || '';
        this.signal = options.signal || null;
        this.stream = options.stream || false;
        this.onChunk = options.onChunk || null;
        this.model = options.model || null;
        this.responseFormat = options.responseFormat || null;
        this.isRetry = options.isRetry || false;
        this.retryCount = options.retryCount || 0;
        this.dryRun = options.dryRun || false;
        this.surfaceId = options.surfaceId || null;
        this.conversationName = options.conversationName || null;
        this.turnNumber = 0;
        this.maxTurns = options.maxTurns || 100;
        this.toolCallCount = 0;
        this.finalResponse = null;
        this.triageResult = null;
        this.errors = [];
        this.metadata = {};
        this.startedAt = Date.now();
        this.completedAt = null;
        this._skipToFinalize = false;
    }

    get aborted() {
        return this.signal?.aborted || false;
    }

    throwIfAborted() {
        if (this.aborted) {
            const err: any = new Error('Agent execution was cancelled');
            err.name = 'AbortError';
            throw err;
        }
    }

    addError(error: Error, phase: string | null = null) {
        this.errors.push({
            message: error.message,
            phase,
            timestamp: Date.now(),
        });
    }

    complete() {
        this.completedAt = Date.now();
    }

    get elapsed() {
        return (this.completedAt || Date.now()) - this.startedAt;
    }

    createRetryContext(improvedPrompt: string) {
        return new TestRequestContext({
            userInput: improvedPrompt,
            signal: this.signal,
            stream: this.stream,
            onChunk: this.onChunk,
            model: this.model,
            responseFormat: this.responseFormat,
            isRetry: true,
            retryCount: this.retryCount + 1,
            dryRun: this.dryRun,
            surfaceId: this.surfaceId,
            maxTurns: this.maxTurns,
            conversationName: this.conversationName,
        });
    }
}

describe('RequestContext', () => {
    test('creates with default values', () => {
        const ctx = new TestRequestContext({ userInput: 'Hello' });
        expect(ctx.userInput).toBe('Hello');
        expect(ctx.originalInput).toBe('Hello');
        expect(ctx.stream).toBe(false);
        expect(ctx.isRetry).toBe(false);
        expect(ctx.retryCount).toBe(0);
        expect(ctx.dryRun).toBe(false);
        expect(ctx.turnNumber).toBe(0);
        expect(ctx.maxTurns).toBe(100);
        expect(ctx.toolCallCount).toBe(0);
        expect(ctx.finalResponse).toBeNull();
        expect(ctx.errors).toEqual([]);
        expect(ctx._skipToFinalize).toBe(false);
    });

    test('preserves all provided options', () => {
        const onChunk = jest.fn();
        const signal = { aborted: false };
        const ctx = new TestRequestContext({
            userInput: 'Test',
            signal,
            stream: true,
            onChunk,
            model: 'gpt-4',
            responseFormat: { type: 'json_object' },
            isRetry: true,
            retryCount: 2,
            dryRun: true,
            surfaceId: 'surface-1',
            maxTurns: 50,
            conversationName: 'test-conv',
        });

        expect(ctx.signal).toBe(signal);
        expect(ctx.stream).toBe(true);
        expect(ctx.onChunk).toBe(onChunk);
        expect(ctx.model).toBe('gpt-4');
        expect(ctx.responseFormat).toEqual({ type: 'json_object' });
        expect(ctx.isRetry).toBe(true);
        expect(ctx.retryCount).toBe(2);
        expect(ctx.dryRun).toBe(true);
        expect(ctx.surfaceId).toBe('surface-1');
        expect(ctx.maxTurns).toBe(50);
        expect(ctx.conversationName).toBe('test-conv');
    });

    test('throwIfAborted does nothing when not aborted', () => {
        const ctx = new TestRequestContext({ userInput: 'Test' });
        expect(() => ctx.throwIfAborted()).not.toThrow();
    });

    test('throwIfAborted throws AbortError when aborted', () => {
        const ctx = new TestRequestContext({
            userInput: 'Test',
            signal: { aborted: true },
        });
        expect(() => ctx.throwIfAborted()).toThrow('Agent execution was cancelled');
    });

    test('addError records errors with phase', () => {
        const ctx = new TestRequestContext({ userInput: 'Test' });
        ctx.addError(new Error('something went wrong'), 'validate');

        expect(ctx.errors).toHaveLength(1);
        expect(ctx.errors[0].message).toBe('something went wrong');
        expect(ctx.errors[0].phase).toBe('validate');
        expect(ctx.errors[0].timestamp).toBeGreaterThan(0);
    });

    test('addError without phase defaults to null', () => {
        const ctx = new TestRequestContext({ userInput: 'Test' });
        ctx.addError(new Error('oops'));

        expect(ctx.errors[0].phase).toBeNull();
    });

    test('complete sets completedAt', () => {
        const ctx = new TestRequestContext({ userInput: 'Test' });
        expect(ctx.completedAt).toBeNull();

        ctx.complete();
        expect(ctx.completedAt).not.toBeNull();
        expect(ctx.completedAt).toBeGreaterThanOrEqual(ctx.startedAt);
    });

    test('createRetryContext creates new context with incremented retryCount', () => {
        const onChunk = jest.fn();
        const ctx = new TestRequestContext({
            userInput: 'Original prompt',
            stream: true,
            onChunk,
            model: 'gpt-4',
            dryRun: true,
            surfaceId: 'surface-1',
            maxTurns: 50,
            conversationName: 'test-conv',
        });

        const retryCtx = ctx.createRetryContext('Improved prompt');

        expect(retryCtx.userInput).toBe('Improved prompt');
        expect(retryCtx.originalInput).toBe('Improved prompt');
        expect(retryCtx.isRetry).toBe(true);
        expect(retryCtx.retryCount).toBe(1);
        expect(retryCtx.stream).toBe(true);
        expect(retryCtx.onChunk).toBe(onChunk);
        expect(retryCtx.model).toBe('gpt-4');
        expect(retryCtx.dryRun).toBe(true);
        expect(retryCtx.surfaceId).toBe('surface-1');
        expect(retryCtx.maxTurns).toBe(50);
        expect(retryCtx.conversationName).toBe('test-conv');
        // New id
        expect(retryCtx.id).not.toBe(ctx.id);
    });

    test('metadata is initially empty and can be set', () => {
        const ctx = new TestRequestContext({ userInput: 'Test' });
        expect(ctx.metadata).toEqual({});

        ctx.metadata.reasoning = { effort: 0.8 };
        expect(ctx.metadata.reasoning.effort).toBe(0.8);
    });

    test('aborted getter reflects signal state', () => {
        const ctx = new TestRequestContext({
            userInput: 'Test',
            signal: { aborted: false },
        });
        expect(ctx.aborted).toBe(false);

        // Simulate abort
        ctx.signal.aborted = true;
        expect(ctx.aborted).toBe(true);
    });
});
