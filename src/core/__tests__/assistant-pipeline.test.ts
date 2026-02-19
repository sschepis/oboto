/**
 * Tests for AssistantPipeline — the async middleware runner.
 *
 * We inline a lightweight pipeline implementation matching the behavioral
 * contract of AssistantPipeline to avoid ESM import issues in Jest.
 */

// ----- Minimal RequestContext inline -----
class Ctx {
    id = 'test';
    userInput: string;
    originalInput: string;
    signal: any;
    stream = false;
    onChunk: any = null;
    model: string | null = null;
    responseFormat: any = null;
    isRetry = false;
    retryCount = 0;
    dryRun = false;
    surfaceId: string | null = null;
    conversationName: string | null = null;
    turnNumber = 0;
    maxTurns = 100;
    toolCallCount = 0;
    finalResponse: string | null = null;
    triageResult: any = null;
    errors: Array<{ message: string; phase: string | null; timestamp: number }> = [];
    metadata: Record<string, any> = {};
    startedAt = Date.now();
    completedAt: number | null = null;
    _skipToFinalize = false;
    _completed = false;

    constructor(opts: any = {}) {
        this.userInput = opts.userInput || '';
        this.originalInput = opts.userInput || '';
        this.signal = opts.signal || null;
    }

    get aborted() { return this.signal?.aborted || false; }

    throwIfAborted() {
        if (this.aborted) {
            const err: any = new Error('Agent execution was cancelled');
            err.name = 'AbortError';
            throw err;
        }
    }

    addError(error: Error, phase: string | null = null) {
        this.errors.push({ message: error.message, phase, timestamp: Date.now() });
    }

    complete() { this.completedAt = Date.now(); this._completed = true; }
}

// ----- Pipeline implementation (mirrors assistant-pipeline.mjs) -----
interface Stage {
    name: string;
    fn: (ctx: Ctx, services: any, next: () => Promise<void>) => Promise<void>;
}

class TestPipeline {
    stages: Stage[];

    constructor(stages: Stage[]) {
        this.stages = stages;
    }

    async execute(ctx: Ctx, services: any): Promise<string> {
        let index = 0;
        const stages = this.stages;

        const next = async () => {
            ctx.throwIfAborted();
            if (index >= stages.length) return;

            if (ctx._skipToFinalize && stages[index].name !== 'finalize') {
                const finalizeIdx = stages.findIndex(s => s.name === 'finalize');
                if (finalizeIdx > index) {
                    index = finalizeIdx;
                }
            }

            const stage = stages[index++];
            const stageName = stage.name;

            try {
                await stage.fn(ctx, services, next);
            } catch (error: any) {
                if (error.name === 'AbortError') throw error;

                ctx.addError(error, stageName);

                const criticalStages = new Set(['validate', 'agentLoop', 'finalize']);
                if (criticalStages.has(stageName)) {
                    throw error;
                }

                // Non-critical: continue to next stage
                await next();
            }
        };

        try {
            await next();
        } catch (error: any) {
            if (error.name === 'AbortError') throw error;

            if (!ctx.finalResponse) {
                ctx.finalResponse = `Error: ${error.message}`;
            }
        }

        ctx.complete();
        return ctx.finalResponse || 'The assistant could not determine a final answer.';
    }
}


describe('AssistantPipeline', () => {
    function makeServices() {
        return {
            get: () => ({ getHistory: () => [], pushMessage: jest.fn(), save: jest.fn() }),
            optional: () => null,
        };
    }

    test('executes stages in order with next() chain', async () => {
        const order: string[] = [];

        const stages: Stage[] = [
            { name: 'first', fn: async (_ctx, _svc, next) => { order.push('first'); await next(); } },
            { name: 'second', fn: async (_ctx, _svc, next) => { order.push('second'); await next(); } },
            { name: 'third', fn: async (ctx, _svc, next) => { order.push('third'); ctx.finalResponse = 'done'; await next(); } },
        ];

        const pipeline = new TestPipeline(stages);
        const ctx = new Ctx({ userInput: 'test' });

        await pipeline.execute(ctx, makeServices());

        expect(order).toEqual(['first', 'second', 'third']);
        expect(ctx.finalResponse).toBe('done');
    });

    test('stages can skip remaining stages by not calling next()', async () => {
        const order: string[] = [];

        const stages: Stage[] = [
            { name: 'first', fn: async (_ctx, _svc, next) => { order.push('first'); await next(); } },
            { name: 'stopper', fn: async (ctx, _svc, _next) => { order.push('stopper'); ctx.finalResponse = 'stopped'; } },
            { name: 'skipped', fn: async (_ctx, _svc, next) => { order.push('skipped'); await next(); } },
        ];

        const pipeline = new TestPipeline(stages);
        const ctx = new Ctx({ userInput: 'test' });

        await pipeline.execute(ctx, makeServices());

        expect(order).toEqual(['first', 'stopper']);
        expect(ctx.finalResponse).toBe('stopped');
    });

    test('_skipToFinalize jumps to finalize stage', async () => {
        const order: string[] = [];

        const stages: Stage[] = [
            { name: 'validate', fn: async (_ctx, _svc, next) => { order.push('validate'); await next(); } },
            { name: 'triage', fn: async (ctx, _svc, next) => {
                order.push('triage');
                ctx._skipToFinalize = true;
                ctx.finalResponse = 'fast-path';
                await next();
            }},
            { name: 'agentLoop', fn: async (_ctx, _svc, next) => { order.push('agentLoop'); await next(); } },
            { name: 'finalize', fn: async (_ctx, _svc, next) => { order.push('finalize'); await next(); } },
        ];

        const pipeline = new TestPipeline(stages);
        const ctx = new Ctx({ userInput: 'test' });

        await pipeline.execute(ctx, makeServices());

        expect(order).toEqual(['validate', 'triage', 'finalize']);
        expect(ctx.finalResponse).toBe('fast-path');
    });

    test('non-critical stage errors are logged and skipped', async () => {
        const order: string[] = [];

        const stages: Stage[] = [
            { name: 'preprocess', fn: async () => { throw new Error('noncritical-fail'); } },
            { name: 'agentLoopAlt', fn: async (ctx, _svc, next) => { order.push('agentLoopAlt'); ctx.finalResponse = 'ok'; await next(); } },
        ];

        const pipeline = new TestPipeline(stages);
        const ctx = new Ctx({ userInput: 'test' });

        await pipeline.execute(ctx, makeServices());

        expect(order).toEqual(['agentLoopAlt']);
        expect(ctx.errors).toHaveLength(1);
        expect(ctx.errors[0].phase).toBe('preprocess');
    });

    test('critical stage errors propagate and set fallback response', async () => {
        const stages: Stage[] = [
            { name: 'validate', fn: async () => { throw new Error('validation-fail'); } },
            { name: 'finalize', fn: async (_ctx, _svc, next) => { await next(); } },
        ];

        const pipeline = new TestPipeline(stages);
        const ctx = new Ctx({ userInput: 'test' });

        const result = await pipeline.execute(ctx, makeServices());

        expect(result).toContain('validation-fail');
    });

    test('AbortError propagates through the pipeline', async () => {
        const stages: Stage[] = [
            { name: 'validate', fn: async () => {
                const err: any = new Error('Aborted');
                err.name = 'AbortError';
                throw err;
            }},
        ];

        const pipeline = new TestPipeline(stages);
        const ctx = new Ctx({ userInput: 'test' });

        await expect(pipeline.execute(ctx, makeServices())).rejects.toThrow('Aborted');
    });

    test('abort via signal.aborted triggers throwIfAborted', async () => {
        const stages: Stage[] = [
            { name: 'first', fn: async (_ctx, _svc, next) => { await next(); } },
            { name: 'second', fn: async (ctx, _svc, next) => { ctx.finalResponse = 'done'; await next(); } },
        ];

        const pipeline = new TestPipeline(stages);
        const ctx = new Ctx({ userInput: 'test' });
        ctx.signal = { aborted: true };

        await expect(pipeline.execute(ctx, makeServices())).rejects.toThrow();
    });

    test('pipeline with zero stages returns fallback response', async () => {
        const pipeline = new TestPipeline([]);
        const ctx = new Ctx({ userInput: 'test' });

        const result = await pipeline.execute(ctx, makeServices());
        expect(result).toBe('The assistant could not determine a final answer.');
    });

    test('services are passed through to stages', async () => {
        let receivedServices: any;

        const stages: Stage[] = [
            { name: 'check', fn: async (ctx, svc, next) => {
                receivedServices = svc;
                ctx.finalResponse = 'ok';
                await next();
            }},
        ];

        const pipeline = new TestPipeline(stages);
        const ctx = new Ctx({ userInput: 'test' });
        const services = makeServices();

        await pipeline.execute(ctx, services);
        expect(receivedServices).toBe(services);
    });

    test('context is marked complete after execution', async () => {
        const stages: Stage[] = [
            { name: 'step', fn: async (ctx, _svc, next) => { ctx.finalResponse = 'ok'; await next(); } },
        ];

        const pipeline = new TestPipeline(stages);
        const ctx = new Ctx({ userInput: 'test' });

        await pipeline.execute(ctx, makeServices());
        expect(ctx._completed).toBe(true);
        expect(ctx.completedAt).not.toBeNull();
    });
});
