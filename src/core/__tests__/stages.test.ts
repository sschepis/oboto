/**
 * Tests for individual pipeline stages: validate, triage, finalize.
 *
 * We inline minimal implementations matching the behavioral contracts
 * of the actual stage functions, testing the logic without ESM imports.
 */

// ----- Minimal RequestContext -----
class Ctx {
    id = 'test-req';
    userInput: string;
    originalInput: string;
    signal: any;
    stream = false;
    onChunk: any = null;
    model: string | null = null;
    responseFormat: any = null;
    isRetry: boolean;
    retryCount: number;
    dryRun: boolean;
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

    constructor(opts: any = {}) {
        this.userInput = opts.userInput || '';
        this.originalInput = opts.userInput || '';
        this.signal = opts.signal || null;
        this.isRetry = opts.isRetry || false;
        this.retryCount = opts.retryCount || 0;
        this.dryRun = opts.dryRun || false;
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

    complete() { this.completedAt = Date.now(); }
}

// ========== validate stage logic (mirrors src/core/stages/validate.mjs) ==========
async function validate(
    ctx: Ctx,
    services: { get: (name: string) => any },
    next: () => Promise<void>
) {
    ctx.throwIfAborted();

    if (!ctx.userInput || ctx.userInput.trim().length === 0) {
        ctx.finalResponse = 'Please provide a message.';
        ctx._skipToFinalize = true;
        await next();
        return;
    }

    const toolLoader = services.get('toolLoader');
    await toolLoader.ensureLoaded();

    const toolExecutor = services.get('toolExecutor');
    toolExecutor.setDryRun(ctx.dryRun);

    await next();
}

// ========== triage stage logic (mirrors src/core/stages/triage.mjs) ==========
async function triage(
    ctx: Ctx,
    services: { get: (name: string) => any; optional: (name: string) => any },
    next: () => Promise<void>
) {
    if (ctx.isRetry) {
        await next();
        return;
    }

    const promptRouter = services.get('promptRouter');
    const llmAdapter = services.get('llmAdapter');
    const historyManager = services.get('historyManager');

    try {
        const modelConfig = promptRouter.resolveModel('triage');
        const fullHistory = historyManager.getHistory();
        const recentHistory = fullHistory.slice(-5);

        const messages = [
            { role: 'system', content: 'Classify...' },
            ...recentHistory.filter((m: any) => m.role !== 'system'),
        ];

        const result = await llmAdapter.generateContent({
            model: modelConfig.modelId,
            messages,
            temperature: 0.1,
            response_format: { type: 'json_object' },
        });

        const content = result.choices[0].message.content;
        const cleanContent = content.replace(/^```json\n?/, '').replace(/\n?```$/, '');
        const triageResult = JSON.parse(cleanContent);
        ctx.triageResult = triageResult;

        if (triageResult.status === 'COMPLETED' && triageResult.response) {
            ctx.finalResponse = triageResult.response;
            ctx._skipToFinalize = true;
            await next();
            return;
        }

        if (triageResult.status === 'MISSING_INFO' && triageResult.missing_info_question) {
            ctx.finalResponse = triageResult.missing_info_question;
            ctx._skipToFinalize = true;
            await next();
            return;
        }
    } catch (_error) {
        // Non-fatal: proceed to agent loop
    }

    await next();
}

// ========== finalize stage logic (mirrors src/core/stages/finalize.mjs) ==========
async function finalize(
    ctx: Ctx,
    services: { get: (name: string) => any; optional: (name: string) => any },
    next: () => Promise<void>
) {
    const historyManager = services.get('historyManager');
    const statusAdapter = services.optional('statusAdapter');
    const eventBus = services.optional('eventBus');

    if (ctx.finalResponse) {
        historyManager.pushMessage({
            role: 'assistant',
            content: ctx.finalResponse,
        });
    }

    try {
        await historyManager.save();
    } catch (_err) {
        // Log but don't throw
    }

    if (statusAdapter) {
        statusAdapter.onComplete(ctx.finalResponse);
    }

    if (eventBus) {
        eventBus.emit('assistant:response', {
            requestId: ctx.id,
            input: ctx.originalInput,
            response: ctx.finalResponse,
            model: ctx.model,
            toolCallCount: ctx.toolCallCount,
            turnNumber: ctx.turnNumber,
            errors: ctx.errors,
        });
    }

    ctx.complete();
    await next();
}

// ===================== TESTS =====================

describe('validate stage', () => {
    function mockServices(overrides: Record<string, any> = {}) {
        return {
            get: (name: string) => {
                const defaults: Record<string, any> = {
                    toolLoader: { ensureLoaded: jest.fn().mockResolvedValue(true) },
                    toolExecutor: { setDryRun: jest.fn() },
                };
                return overrides[name] || defaults[name];
            },
            optional: () => null,
        };
    }

    test('empty input sets finalResponse and skipToFinalize', async () => {
        const ctx = new Ctx({ userInput: '' });
        const services = mockServices();
        const next = jest.fn();

        await validate(ctx, services, next);

        expect(ctx.finalResponse).toBe('Please provide a message.');
        expect(ctx._skipToFinalize).toBe(true);
        expect(next).toHaveBeenCalled();
    });

    test('whitespace-only input is treated as empty', async () => {
        const ctx = new Ctx({ userInput: '   ' });
        const services = mockServices();
        const next = jest.fn();

        await validate(ctx, services, next);

        expect(ctx.finalResponse).toBe('Please provide a message.');
        expect(ctx._skipToFinalize).toBe(true);
    });

    test('valid input calls toolLoader.ensureLoaded and next()', async () => {
        const ensureLoaded = jest.fn().mockResolvedValue(true);
        const setDryRun = jest.fn();
        const ctx = new Ctx({ userInput: 'Hello', dryRun: true });
        const services = mockServices({
            toolLoader: { ensureLoaded },
            toolExecutor: { setDryRun },
        });
        const next = jest.fn();

        await validate(ctx, services, next);

        expect(ensureLoaded).toHaveBeenCalled();
        expect(setDryRun).toHaveBeenCalledWith(true);
        expect(next).toHaveBeenCalled();
        expect(ctx._skipToFinalize).toBe(false);
    });

    test('aborted signal throws AbortError', async () => {
        const ctx = new Ctx({
            userInput: 'Hello',
            signal: { aborted: true },
        });
        const services = mockServices();
        const next = jest.fn();

        await expect(validate(ctx, services, next)).rejects.toThrow('Agent execution was cancelled');
        expect(next).not.toHaveBeenCalled();
    });
});

describe('triage stage', () => {
    function mockServices(triageResponse: any) {
        return {
            get: (name: string) => {
                const defaults: Record<string, any> = {
                    promptRouter: {
                        resolveModel: jest.fn().mockReturnValue({ modelId: 'gpt-4o-mini' }),
                    },
                    llmAdapter: {
                        generateContent: jest.fn().mockResolvedValue({
                            choices: [{ message: { content: JSON.stringify(triageResponse) } }],
                        }),
                    },
                    historyManager: {
                        getHistory: () => [{ role: 'user', content: 'hi' }],
                    },
                };
                return defaults[name];
            },
            optional: () => null,
        };
    }

    test('skips triage on retry and calls next', async () => {
        const ctx = new Ctx({ userInput: 'test', isRetry: true });
        const services = mockServices({});
        const next = jest.fn();

        await triage(ctx, services, next);

        expect(next).toHaveBeenCalled();
        expect(ctx._skipToFinalize).toBe(false);
    });

    test('COMPLETED response sets finalResponse and skipToFinalize', async () => {
        const ctx = new Ctx({ userInput: 'hello' });
        const services = mockServices({
            status: 'COMPLETED',
            reasoning: 'Simple greeting',
            response: 'Hello! How can I help?',
            missing_info_question: null,
        });
        const next = jest.fn();

        await triage(ctx, services, next);

        expect(ctx.finalResponse).toBe('Hello! How can I help?');
        expect(ctx._skipToFinalize).toBe(true);
        expect(next).toHaveBeenCalled();
    });

    test('MISSING_INFO sets clarification question and skipToFinalize', async () => {
        const ctx = new Ctx({ userInput: 'fix the bug' });
        const services = mockServices({
            status: 'MISSING_INFO',
            reasoning: 'Too vague',
            response: null,
            missing_info_question: 'Which bug are you referring to?',
        });
        const next = jest.fn();

        await triage(ctx, services, next);

        expect(ctx.finalResponse).toBe('Which bug are you referring to?');
        expect(ctx._skipToFinalize).toBe(true);
        expect(next).toHaveBeenCalled();
    });

    test('READY proceeds to next without skipToFinalize', async () => {
        const ctx = new Ctx({ userInput: 'refactor the assistant' });
        const services = mockServices({
            status: 'READY',
            reasoning: 'Complex task',
            response: null,
            missing_info_question: null,
        });
        const next = jest.fn();

        await triage(ctx, services, next);

        expect(ctx._skipToFinalize).toBe(false);
        expect(ctx.finalResponse).toBeNull();
        expect(next).toHaveBeenCalled();
    });

    test('triage failure falls through to next gracefully', async () => {
        const ctx = new Ctx({ userInput: 'do something' });
        const services = {
            get: (name: string) => {
                if (name === 'promptRouter') return { resolveModel: () => ({ modelId: 'gpt-4o-mini' }) };
                if (name === 'llmAdapter') return { generateContent: () => Promise.reject(new Error('API down')) };
                if (name === 'historyManager') return { getHistory: () => [] };
                return null;
            },
            optional: () => null,
        };
        const next = jest.fn();

        await triage(ctx, services, next);

        expect(next).toHaveBeenCalled();
        expect(ctx._skipToFinalize).toBe(false);
    });
});

describe('finalize stage', () => {
    function mockServices(overrides: Record<string, any> = {}) {
        const defaultHistoryManager = {
            pushMessage: jest.fn(),
            save: jest.fn().mockResolvedValue(true),
        };

        return {
            get: (name: string) => {
                if (name === 'historyManager') return overrides.historyManager || defaultHistoryManager;
                return overrides[name] || defaultHistoryManager;
            },
            optional: (name: string) => {
                if (name === 'statusAdapter') return overrides.statusAdapter || null;
                if (name === 'eventBus') return overrides.eventBus || null;
                return null;
            },
        };
    }

    test('adds assistant response to history and saves', async () => {
        const pushMessage = jest.fn();
        const save = jest.fn().mockResolvedValue(true);
        const ctx = new Ctx({ userInput: 'test' });
        ctx.finalResponse = 'The answer is 42.';

        const services = mockServices({
            historyManager: { pushMessage, save },
        });
        const next = jest.fn();

        await finalize(ctx, services, next);

        expect(pushMessage).toHaveBeenCalledWith({
            role: 'assistant',
            content: 'The answer is 42.',
        });
        expect(save).toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
    });

    test('skips pushMessage when finalResponse is null', async () => {
        const pushMessage = jest.fn();
        const save = jest.fn().mockResolvedValue(true);
        const ctx = new Ctx({ userInput: 'test' });
        ctx.finalResponse = null;

        const services = mockServices({
            historyManager: { pushMessage, save },
        });
        const next = jest.fn();

        await finalize(ctx, services, next);

        expect(pushMessage).not.toHaveBeenCalled();
        expect(save).toHaveBeenCalled();
    });

    test('emits events when eventBus is available', async () => {
        const emit = jest.fn();
        const ctx = new Ctx({ userInput: 'test' });
        ctx.finalResponse = 'ok';

        const services = mockServices({
            eventBus: { emit },
        });
        const next = jest.fn();

        await finalize(ctx, services, next);

        expect(emit).toHaveBeenCalledWith('assistant:response', expect.objectContaining({
            requestId: ctx.id,
            input: 'test',
            response: 'ok',
        }));
    });

    test('calls statusAdapter.onComplete when available', async () => {
        const onComplete = jest.fn();
        const ctx = new Ctx({ userInput: 'test' });
        ctx.finalResponse = 'done';

        const services = mockServices({
            statusAdapter: { onComplete },
        });
        const next = jest.fn();

        await finalize(ctx, services, next);

        expect(onComplete).toHaveBeenCalledWith('done');
    });

    test('marks context as complete', async () => {
        const ctx = new Ctx({ userInput: 'test' });
        ctx.finalResponse = 'finished';

        const services = mockServices();
        const next = jest.fn();

        await finalize(ctx, services, next);

        expect(ctx.completedAt).not.toBeNull();
    });

    test('save failure does not throw', async () => {
        const ctx = new Ctx({ userInput: 'test' });
        ctx.finalResponse = 'ok';

        const services = mockServices({
            historyManager: {
                pushMessage: jest.fn(),
                save: jest.fn().mockRejectedValue(new Error('disk full')),
            },
        });
        const next = jest.fn();

        await expect(finalize(ctx, services, next)).resolves.not.toThrow();
        expect(next).toHaveBeenCalled();
    });
});
