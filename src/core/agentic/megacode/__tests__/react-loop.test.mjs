/**
 * Tests for react-loop.mjs — Enhanced ReactLoop with status reporting,
 * retry logic, history loading, and synthesis at limit.
 */

import { jest } from '@jest/globals';

// Mock the status-reporter module
const mockEmitStatus = jest.fn();
const mockEmitCommentary = jest.fn();
const mockDescribeToolCall = jest.fn((name, args) => `${name}(${JSON.stringify(args)})`);
const mockSummarizeInput = jest.fn((input) => `"${(input || '').substring(0, 20)}"`);

jest.unstable_mockModule('../../../status-reporter.mjs', () => ({
    emitStatus: mockEmitStatus,
    emitCommentary: mockEmitCommentary,
    describeToolCall: mockDescribeToolCall,
    summarizeInput: mockSummarizeInput,
}));

// Mock the ActivityTracker
const mockSetActivity = jest.fn();
const mockStop = jest.fn();

jest.unstable_mockModule('../../../activity-tracker.mjs', () => ({
    ActivityTracker: jest.fn().mockImplementation(() => ({
        setActivity: mockSetActivity,
        stop: mockStop,
    })),
}));

// Import after mocks are set up
const { ReactLoop } = await import('../react-loop.mjs');

// ─── Test helpers ──────────────────────────────────────────────────────

function makeDeps(overrides = {}) {
    return {
        aiProvider: {
            askWithMessages: jest.fn().mockResolvedValue('{"action":"respond","response":"Hello!"}'),
        },
        toolExecutor: {
            getAllToolDefinitions: jest.fn().mockReturnValue([]),
            executeTool: jest.fn().mockResolvedValue({ content: 'tool result' }),
        },
        historyManager: null,
        eventBus: {
            emit: jest.fn(),
        },
        workingDir: '/test',
        facade: null,
        ...overrides,
    };
}

function makeLoop(options = {}) {
    return new ReactLoop({
        maxIterations: options.maxIterations ?? 5,
        compaction: {
            contextLimit: 100000,
            reservedTokens: 8000,
            pruneFirst: true,
        },
        doomDetection: {
            threshold: 3,
            windowSize: 10,
        },
        retryAttempts: options.retryAttempts ?? 3,
        heartbeatIntervalMs: 60000, // Long interval to avoid timers in tests
        ...options,
    });
}

// ─── Tests ─────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
});

describe('ReactLoop', () => {
    describe('execute() — basic flow', () => {
        test('returns response from a simple respond action', async () => {
            const loop = makeLoop();
            const deps = makeDeps();

            const result = await loop.execute('Hello', deps);

            expect(result.response).toBe('Hello!');
            expect(result.iterations).toBe(1);
            expect(result.toolCalls).toEqual([]);
        });

        test('handles freeform text response (non-JSON)', async () => {
            const loop = makeLoop();
            const deps = makeDeps({
                aiProvider: {
                    askWithMessages: jest.fn().mockResolvedValue('Just a plain text response'),
                },
            });

            const result = await loop.execute('Hi', deps);

            expect(result.response).toBe('Just a plain text response');
            expect(result.iterations).toBe(1);
        });

        test('processes tool_call then respond', async () => {
            const loop = makeLoop();
            const aiProvider = {
                askWithMessages: jest.fn()
                    .mockResolvedValueOnce('{"action":"tool_call","tool":"read_file","args":{"path":"test.txt"}}')
                    .mockResolvedValueOnce('{"action":"respond","response":"File content: hello"}'),
            };
            const deps = makeDeps({ aiProvider });

            const result = await loop.execute('Read test.txt', deps);

            expect(result.response).toBe('File content: hello');
            expect(result.iterations).toBe(2);
            expect(result.toolCalls.length).toBe(1);
            expect(result.toolCalls[0].tool).toBe('read_file');
        });
    });

    describe('Status reporting', () => {
        test('emits status for request analysis on start', async () => {
            const loop = makeLoop();
            const deps = makeDeps();

            await loop.execute('Tell me about cats', deps);

            expect(mockSummarizeInput).toHaveBeenCalledWith('Tell me about cats');
            expect(mockEmitStatus).toHaveBeenCalledWith(
                expect.stringContaining('Analyzing request:')
            );
        });

        test('sets ActivityTracker for LLM call phase', async () => {
            const loop = makeLoop();
            const deps = makeDeps();

            await loop.execute('Hello', deps);

            // Should set activity with llm-call phase
            expect(mockSetActivity).toHaveBeenCalledWith(
                'Waiting for AI response…',
                { phase: 'llm-call' }
            );
        });

        test('stops ActivityTracker when response is ready', async () => {
            const loop = makeLoop();
            const deps = makeDeps();

            await loop.execute('Hello', deps);

            expect(mockStop).toHaveBeenCalled();
        });

        test('emits status for AI composing final response', async () => {
            const loop = makeLoop();
            const deps = makeDeps();

            await loop.execute('Hello', deps);

            expect(mockEmitStatus).toHaveBeenCalledWith('AI composing final response');
        });

        test('emits status for tool execution', async () => {
            const loop = makeLoop();
            const aiProvider = {
                askWithMessages: jest.fn()
                    .mockResolvedValueOnce('{"action":"tool_call","tool":"read_file","args":{"path":"x.txt"}}')
                    .mockResolvedValueOnce('{"action":"respond","response":"done"}'),
            };
            const deps = makeDeps({ aiProvider });

            await loop.execute('Read x.txt', deps);

            expect(mockDescribeToolCall).toHaveBeenCalledWith('read_file', { path: 'x.txt' });
            expect(mockEmitStatus).toHaveBeenCalledWith(
                expect.stringContaining('Executing tool:')
            );
        });

        test('sets ActivityTracker for tool execution phase', async () => {
            const loop = makeLoop();
            const aiProvider = {
                askWithMessages: jest.fn()
                    .mockResolvedValueOnce('{"action":"tool_call","tool":"read_file","args":{"path":"x.txt"}}')
                    .mockResolvedValueOnce('{"action":"respond","response":"done"}'),
            };
            const deps = makeDeps({ aiProvider });

            await loop.execute('Read x.txt', deps);

            expect(mockSetActivity).toHaveBeenCalledWith(
                expect.stringContaining('Running:'),
                { phase: 'tool-exec' }
            );
        });

        test('emits commentary for tool completion', async () => {
            const loop = makeLoop();
            const aiProvider = {
                askWithMessages: jest.fn()
                    .mockResolvedValueOnce('{"action":"tool_call","tool":"read_file","args":{"path":"x.txt"}}')
                    .mockResolvedValueOnce('{"action":"respond","response":"done"}'),
            };
            const deps = makeDeps({ aiProvider });

            await loop.execute('Read x.txt', deps);

            expect(mockEmitCommentary).toHaveBeenCalledWith(
                expect.stringContaining('Tool completed: read_file')
            );
        });

        test('emits status for sending results back to AI', async () => {
            const loop = makeLoop();
            const aiProvider = {
                askWithMessages: jest.fn()
                    .mockResolvedValueOnce('{"action":"tool_call","tool":"read_file","args":{"path":"x.txt"}}')
                    .mockResolvedValueOnce('{"action":"respond","response":"done"}'),
            };
            const deps = makeDeps({ aiProvider });

            await loop.execute('Read x.txt', deps);

            expect(mockEmitStatus).toHaveBeenCalledWith(
                expect.stringContaining('Tool results received — sending back to AI')
            );
        });
    });

    describe('Thought field display', () => {
        test('emits commentary for thought field in tool_call', async () => {
            const loop = makeLoop();
            const aiProvider = {
                askWithMessages: jest.fn()
                    .mockResolvedValueOnce('{"action":"tool_call","tool":"read_file","args":{"path":"x.txt"},"thought":"I need to read this file first"}')
                    .mockResolvedValueOnce('{"action":"respond","response":"done"}'),
            };
            const deps = makeDeps({ aiProvider });

            await loop.execute('Fix the bug', deps);

            expect(mockEmitCommentary).toHaveBeenCalledWith(
                '💭 I need to read this file first'
            );
        });

        test('emits commentary for thought field in respond', async () => {
            const loop = makeLoop();
            const deps = makeDeps({
                aiProvider: {
                    askWithMessages: jest.fn().mockResolvedValue(
                        '{"action":"respond","response":"All done","thought":"The task is complete"}'
                    ),
                },
            });

            await loop.execute('Status?', deps);

            expect(mockEmitCommentary).toHaveBeenCalledWith(
                '💭 The task is complete'
            );
        });

        test('does not emit thought when not present', async () => {
            const loop = makeLoop();
            const deps = makeDeps();

            await loop.execute('Hello', deps);

            const thoughtCalls = mockEmitCommentary.mock.calls.filter(
                call => typeof call[0] === 'string' && call[0].startsWith('💭')
            );
            expect(thoughtCalls.length).toBe(0);
        });
    });

    describe('Tool error reporting', () => {
        test('emits commentary when tool execution fails', async () => {
            const loop = makeLoop();
            const aiProvider = {
                askWithMessages: jest.fn()
                    .mockResolvedValueOnce('{"action":"tool_call","tool":"write_file","args":{"path":"/readonly"}}')
                    .mockResolvedValueOnce('{"action":"respond","response":"Failed to write"}'),
            };
            const toolExecutor = {
                getAllToolDefinitions: jest.fn().mockReturnValue([]),
                executeTool: jest.fn().mockRejectedValue(new Error('Permission denied')),
            };
            const deps = makeDeps({ aiProvider, toolExecutor });

            await loop.execute('Write file', deps);

            expect(mockEmitCommentary).toHaveBeenCalledWith(
                '⚠️ Tool "write_file" failed: Permission denied'
            );
        });

        test('emits commentary for tool result that looks like an error', async () => {
            const loop = makeLoop();
            const aiProvider = {
                askWithMessages: jest.fn()
                    .mockResolvedValueOnce('{"action":"tool_call","tool":"read_file","args":{"path":"missing.txt"}}')
                    .mockResolvedValueOnce('{"action":"respond","response":"File not found"}'),
            };
            const toolExecutor = {
                getAllToolDefinitions: jest.fn().mockReturnValue([]),
                executeTool: jest.fn().mockResolvedValue({ content: 'Error: file not found' }),
            };
            const deps = makeDeps({ aiProvider, toolExecutor });

            await loop.execute('Read missing file', deps);

            expect(mockEmitCommentary).toHaveBeenCalledWith(
                expect.stringContaining('Tool "read_file" failed')
            );
        });

        test('tracks tool errors in metadata', async () => {
            const loop = makeLoop();
            const aiProvider = {
                askWithMessages: jest.fn()
                    .mockResolvedValueOnce('{"action":"tool_call","tool":"write_file","args":{"path":"/x"}}')
                    .mockResolvedValueOnce('{"action":"respond","response":"Error handled"}'),
            };
            const toolExecutor = {
                getAllToolDefinitions: jest.fn().mockReturnValue([]),
                executeTool: jest.fn().mockRejectedValue(new Error('Disk full')),
            };
            const deps = makeDeps({ aiProvider, toolExecutor });

            const result = await loop.execute('Write something', deps);

            expect(result.metadata.toolErrors).toBeGreaterThan(0);
        });
    });

    describe('Retry logic', () => {
        test('retries on rate limit (429) and succeeds', async () => {
            const loop = makeLoop({ retryAttempts: 3, heartbeatIntervalMs: 60000 });
            const rateLimitError = new Error('Rate limit exceeded');
            rateLimitError.status = 429;

            const aiProvider = {
                askWithMessages: jest.fn()
                    .mockRejectedValueOnce(rateLimitError)
                    .mockResolvedValueOnce('{"action":"respond","response":"Success after retry"}'),
            };
            const deps = makeDeps({ aiProvider });

            const result = await loop.execute('Hello', deps);

            expect(result.response).toBe('Success after retry');
            expect(aiProvider.askWithMessages).toHaveBeenCalledTimes(2);
            expect(mockEmitStatus).toHaveBeenCalledWith(
                expect.stringContaining('retrying')
            );
        });

        test('does not retry auth errors (401)', async () => {
            const loop = makeLoop({ retryAttempts: 3 });
            const authError = new Error('Unauthorized');
            authError.status = 401;

            const aiProvider = {
                askWithMessages: jest.fn().mockRejectedValue(authError),
            };
            const deps = makeDeps({ aiProvider });

            // The 401 error is fatal but _callLLMWithRetry catches it and returns error text
            // because it's caught by the outer try-catch in _callLLMWithRetry
            // Actually 401 is rethrown, so it should propagate
            await expect(loop.execute('Hello', deps)).rejects.toThrow('Unauthorized');
            expect(aiProvider.askWithMessages).toHaveBeenCalledTimes(1);
        });

        test('returns error text after exhausting retries', async () => {
            const loop = makeLoop({ retryAttempts: 2, heartbeatIntervalMs: 60000 });
            const serverError = new Error('Internal Server Error');
            serverError.status = 500;

            const aiProvider = {
                askWithMessages: jest.fn().mockRejectedValue(serverError),
            };
            const deps = makeDeps({ aiProvider });

            // After exhausting retries, returns LLM Error text (not throws)
            const result = await loop.execute('Hello', deps);

            // The response should contain the error message since all retries failed
            expect(result.response).toContain('LLM Error');
            expect(mockEmitCommentary).toHaveBeenCalledWith(
                expect.stringContaining('LLM call failed')
            );
        });

        test('tracks retry count in metadata', async () => {
            const loop = makeLoop({ retryAttempts: 3, heartbeatIntervalMs: 60000 });
            const rateLimitError = new Error('Rate limit');
            rateLimitError.status = 429;

            const aiProvider = {
                askWithMessages: jest.fn()
                    .mockRejectedValueOnce(rateLimitError)
                    .mockResolvedValueOnce('{"action":"respond","response":"OK"}'),
            };
            const deps = makeDeps({ aiProvider });

            const result = await loop.execute('Hello', deps);

            expect(result.metadata.retries).toBe(1);
        });
    });

    describe('Conversation history loading', () => {
        test('loads recent history from historyManager', async () => {
            const loop = makeLoop();
            const mockHistory = [
                { role: 'user', content: 'First message' },
                { role: 'assistant', content: 'First reply' },
            ];
            const deps = makeDeps({
                historyManager: {
                    getHistory: jest.fn().mockResolvedValue(mockHistory),
                },
            });

            await loop.execute('Follow up', deps);

            expect(deps.historyManager.getHistory).toHaveBeenCalled();
            expect(mockEmitStatus).toHaveBeenCalledWith(
                expect.stringContaining('Loaded 2 recent messages')
            );
        });

        test('loads history from facade.historyManager when facade is present', async () => {
            const loop = makeLoop();
            const mockHistory = [
                { role: 'user', content: 'First' },
            ];
            const facadeHm = {
                getHistory: jest.fn().mockResolvedValue(mockHistory),
            };
            const deps = makeDeps({
                facade: { historyManager: facadeHm },
            });

            await loop.execute('Follow up', deps);

            expect(facadeHm.getHistory).toHaveBeenCalled();
        });

        test('handles history load failure gracefully', async () => {
            const loop = makeLoop();
            const deps = makeDeps({
                historyManager: {
                    getHistory: jest.fn().mockRejectedValue(new Error('DB error')),
                },
            });

            const result = await loop.execute('Hello', deps);

            // Should continue without history
            expect(result.response).toBe('Hello!');
            expect(mockEmitStatus).toHaveBeenCalledWith(
                'Could not load conversation history — starting fresh'
            );
        });

        test('works when no historyManager available', async () => {
            const loop = makeLoop();
            const deps = makeDeps(); // historyManager is null by default

            const result = await loop.execute('Hello', deps);

            expect(result.response).toBe('Hello!');
        });
    });

    describe('Max iterations synthesis', () => {
        test('synthesizes response when max iterations reached', async () => {
            const loop = makeLoop({ maxIterations: 2 });
            const aiProvider = {
                askWithMessages: jest.fn()
                    // Iterations 1 and 2: always request tools
                    .mockResolvedValueOnce('{"action":"tool_call","tool":"read_file","args":{"path":"a.txt"}}')
                    .mockResolvedValueOnce('{"action":"tool_call","tool":"read_file","args":{"path":"b.txt"}}')
                    // Synthesis call
                    .mockResolvedValueOnce('Here is a summary of what I found...'),
            };
            const deps = makeDeps({ aiProvider });

            const result = await loop.execute('Analyze everything', deps);

            expect(result.response).toContain('summary');
            expect(result.metadata.maxIterationsReached).toBe(true);
            expect(mockEmitCommentary).toHaveBeenCalledWith(
                expect.stringContaining('Reached iteration limit')
            );
        });
    });

    describe('Progress tracking metadata', () => {
        test('includes elapsed time in metadata', async () => {
            const loop = makeLoop();
            const deps = makeDeps();

            const result = await loop.execute('Hello', deps);

            expect(result.metadata).toHaveProperty('elapsed');
            expect(typeof result.metadata.elapsed).toBe('number');
        });

        test('includes tool names in metadata', async () => {
            const loop = makeLoop();
            const aiProvider = {
                askWithMessages: jest.fn()
                    .mockResolvedValueOnce('{"action":"tool_call","tool":"read_file","args":{"path":"a.txt"}}')
                    .mockResolvedValueOnce('{"action":"tool_call","tool":"write_file","args":{"path":"b.txt"}}')
                    .mockResolvedValueOnce('{"action":"respond","response":"done"}'),
            };
            const deps = makeDeps({ aiProvider });

            const result = await loop.execute('Process files', deps);

            expect(result.metadata.toolNames).toContain('read_file');
            expect(result.metadata.toolNames).toContain('write_file');
        });

        test('emits progress event via eventBus', async () => {
            const loop = makeLoop();
            const deps = makeDeps();

            await loop.execute('Hello', deps);

            expect(deps.eventBus.emit).toHaveBeenCalledWith(
                'agentic:megacode-progress',
                expect.objectContaining({
                    iterations: expect.any(Number),
                    toolCallsCompleted: expect.any(Number),
                    tokensUsed: expect.any(Object),
                })
            );
        });
    });

    describe('Doom loop detection', () => {
        test('detects doom loop and emits commentary', async () => {
            const loop = makeLoop({ maxIterations: 10 });
            const aiProvider = {
                askWithMessages: jest.fn()
                    // Same tool call 3 times (doom threshold)
                    .mockResolvedValueOnce('{"action":"tool_call","tool":"read_file","args":{"path":"x.txt"}}')
                    .mockResolvedValueOnce('{"action":"tool_call","tool":"read_file","args":{"path":"x.txt"}}')
                    .mockResolvedValueOnce('{"action":"tool_call","tool":"read_file","args":{"path":"x.txt"}}')
                    // After doom warning, different approach
                    .mockResolvedValueOnce('{"action":"respond","response":"I tried a different approach"}'),
            };
            const deps = makeDeps({ aiProvider });

            const result = await loop.execute('Read file', deps);

            expect(mockEmitCommentary).toHaveBeenCalledWith(
                expect.stringContaining('Doom loop detected')
            );
            expect(deps.eventBus.emit).toHaveBeenCalledWith(
                'agentic:doom-detected',
                expect.objectContaining({ toolName: 'read_file' })
            );
        });
    });

    describe('Abort handling', () => {
        test('throws AbortError when signal is already aborted', async () => {
            const loop = makeLoop();
            const deps = makeDeps();
            const controller = new AbortController();
            controller.abort();

            await expect(
                loop.execute('Hello', deps, { signal: controller.signal })
            ).rejects.toThrow('ReactLoop execution was cancelled');
        });
    });

    describe('EventBus emissions', () => {
        test('emits iteration-start events', async () => {
            const loop = makeLoop();
            const deps = makeDeps();

            await loop.execute('Hello', deps);

            expect(deps.eventBus.emit).toHaveBeenCalledWith(
                'agentic:megacode-step',
                expect.objectContaining({
                    type: 'iteration-start',
                    iteration: 1,
                })
            );
        });

        test('emits tool-complete events', async () => {
            const loop = makeLoop();
            const aiProvider = {
                askWithMessages: jest.fn()
                    .mockResolvedValueOnce('{"action":"tool_call","tool":"read_file","args":{"path":"x.txt"}}')
                    .mockResolvedValueOnce('{"action":"respond","response":"done"}'),
            };
            const deps = makeDeps({ aiProvider });

            await loop.execute('Read x.txt', deps);

            expect(deps.eventBus.emit).toHaveBeenCalledWith(
                'agentic:megacode-step',
                expect.objectContaining({
                    type: 'tool-complete',
                    tool: 'read_file',
                })
            );
        });
    });

    describe('_parseAction()', () => {
        test('parses clean JSON respond action', () => {
            const loop = makeLoop();
            const result = loop._parseAction('{"action":"respond","response":"hello"}');
            expect(result).toEqual({
                type: 'respond',
                response: 'hello',
                thought: undefined,
            });
        });

        test('parses clean JSON tool_call action', () => {
            const loop = makeLoop();
            const result = loop._parseAction('{"action":"tool_call","tool":"read_file","args":{"path":"x.txt"}}');
            expect(result).toEqual({
                type: 'tool_call',
                tool: 'read_file',
                args: { path: 'x.txt' },
                thought: undefined,
            });
        });

        test('parses JSON in code block', () => {
            const loop = makeLoop();
            const result = loop._parseAction('```json\n{"action":"respond","response":"hello"}\n```');
            expect(result.type).toBe('respond');
            expect(result.response).toBe('hello');
        });

        test('extracts embedded JSON from mixed text', () => {
            const loop = makeLoop();
            const result = loop._parseAction('Some thinking text... {"action":"tool_call","tool":"search","args":{"query":"test"}}');
            expect(result.type).toBe('tool_call');
            expect(result.tool).toBe('search');
        });

        test('treats non-JSON text as respond', () => {
            const loop = makeLoop();
            const result = loop._parseAction('This is just plain text without any JSON');
            expect(result.type).toBe('respond');
            expect(result.response).toContain('plain text');
        });

        test('handles null/empty input', () => {
            const loop = makeLoop();
            expect(loop._parseAction(null)).toEqual({ type: 'respond', response: '' });
            expect(loop._parseAction('')).toEqual({ type: 'respond', response: '' });
        });

        test('preserves thought/reasoning field', () => {
            const loop = makeLoop();
            const result = loop._parseAction('{"action":"tool_call","tool":"read_file","args":{},"thought":"Need to check this file"}');
            expect(result.thought).toBe('Need to check this file');
        });
    });
});
