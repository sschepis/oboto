/**
 * Tests for EventicAIProvider multi-message stitching.
 *
 * When an LLM response is truncated at max_tokens (finish_reason === 'length'),
 * _sendRequest should automatically send continuation requests and stitch
 * the responses together.
 */

import { jest } from '@jest/globals';

// ── Module-level mocks (must be set up before dynamic import) ────────────

const mockCallProvider = jest.fn();
const mockCallProviderStream = jest.fn();
const mockIsCancellationError = jest.fn(() => false);

jest.unstable_mockModule('../ai-provider.mjs', () => ({
    callProvider: mockCallProvider,
    callProviderStream: mockCallProviderStream,
    isCancellationError: mockIsCancellationError,
}));

jest.unstable_mockModule('../../ui/console-styler.mjs', () => ({
    consoleStyler: {
        log: jest.fn(),
    },
}));

jest.unstable_mockModule('../../config.mjs', () => ({
    config: { ai: {} },
}));

// Dynamic import after mocks are registered
const { EventicAIProvider } = await import('../eventic-ai-plugin.mjs');

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build a mock OpenAI-compatible non-streaming response.
 */
function makeResponse(content, finishReason = 'stop', toolCalls = undefined) {
    return {
        choices: [{
            message: {
                role: 'assistant',
                content,
                tool_calls: toolCalls,
            },
            finish_reason: finishReason,
        }],
    };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('EventicAIProvider — multi-message stitching', () => {
    let provider;

    beforeEach(() => {
        jest.clearAllMocks();
        provider = new EventicAIProvider({
            model: 'gpt-4o',
            maxStitchContinuations: 5,
        });
    });

    // ── Basic stitching ──────────────────────────────────────────────

    test('stitches two parts when first response has finish_reason "length"', async () => {
        mockCallProvider
            .mockResolvedValueOnce(makeResponse('Hello, this is part one', 'length'))
            .mockResolvedValueOnce(makeResponse(' and this is part two.', 'stop'));

        const result = await provider.ask('Tell me a story');

        expect(result).toBe('Hello, this is part one and this is part two.');
        expect(mockCallProvider).toHaveBeenCalledTimes(2);
    });

    test('stitches three parts across multiple truncations', async () => {
        mockCallProvider
            .mockResolvedValueOnce(makeResponse('Part A', 'length'))
            .mockResolvedValueOnce(makeResponse('Part B', 'length'))
            .mockResolvedValueOnce(makeResponse('Part C', 'stop'));

        const result = await provider.ask('Tell me a long story');

        expect(result).toBe('Part APart BPart C');
        expect(mockCallProvider).toHaveBeenCalledTimes(3);
    });

    test('continuation messages include accumulated content as assistant message', async () => {
        mockCallProvider
            .mockResolvedValueOnce(makeResponse('First half', 'length'))
            .mockResolvedValueOnce(makeResponse(' second half', 'stop'));

        await provider.ask('Test prompt');

        // The second call should have the continuation messages
        const secondCallBody = mockCallProvider.mock.calls[1][0];
        const messages = secondCallBody.messages;

        // Should contain: system/user from original + assistant partial + user continuation
        const assistantMsg = messages.find(m => m.role === 'assistant' && m.content === 'First half');
        expect(assistantMsg).toBeDefined();

        const continuationPrompt = messages[messages.length - 1];
        expect(continuationPrompt.role).toBe('user');
        expect(continuationPrompt.content).toContain('Continue exactly where you left off');
    });

    // ── No stitching conditions ──────────────────────────────────────

    test('does NOT stitch when finish_reason is "stop"', async () => {
        mockCallProvider
            .mockResolvedValueOnce(makeResponse('Complete response', 'stop'));

        const result = await provider.ask('Hello');

        expect(result).toBe('Complete response');
        expect(mockCallProvider).toHaveBeenCalledTimes(1);
    });

    test('does NOT stitch when finish_reason is "tool_calls"', async () => {
        const toolCalls = [{ id: 'tc_1', type: 'function', function: { name: 'search', arguments: '{}' } }];
        mockCallProvider
            .mockResolvedValueOnce(makeResponse('', 'tool_calls', toolCalls));

        const result = await provider.ask('Search for something');

        expect(result).toEqual({ content: '', toolCalls, rawMessage: expect.any(Object) });
        expect(mockCallProvider).toHaveBeenCalledTimes(1);
    });

    test('does NOT stitch when tool calls are present even with finish_reason "length"', async () => {
        const toolCalls = [{ id: 'tc_1', type: 'function', function: { name: 'search', arguments: '{}' } }];
        mockCallProvider
            .mockResolvedValueOnce(makeResponse('partial', 'length', toolCalls));

        const result = await provider.ask('Search');

        expect(result).toEqual({ content: 'partial', toolCalls, rawMessage: expect.any(Object) });
        expect(mockCallProvider).toHaveBeenCalledTimes(1);
    });

    test('does NOT stitch when noStitch option is true', async () => {
        mockCallProvider
            .mockResolvedValueOnce(makeResponse('Truncated content', 'length'));

        const result = await provider.ask('Hello', { noStitch: true });

        expect(result).toBe('Truncated content');
        expect(mockCallProvider).toHaveBeenCalledTimes(1);
    });

    test('does NOT stitch when format is JSON', async () => {
        mockCallProvider
            .mockResolvedValueOnce(makeResponse('{"key": "value"}', 'length'));

        const result = await provider.ask('Give me JSON', { format: 'json' });

        expect(result).toEqual({ key: 'value' });
        expect(mockCallProvider).toHaveBeenCalledTimes(1);
    });

    test('does NOT stitch when content is empty', async () => {
        mockCallProvider
            .mockResolvedValueOnce(makeResponse('', 'length'));

        const result = await provider.ask('Hello');

        // Should get fallback empty content
        expect(result).toBe('(No response generated by the AI model)');
        expect(mockCallProvider).toHaveBeenCalledTimes(1);
    });

    // ── Max continuations ────────────────────────────────────────────

    test('respects maxStitchContinuations limit', async () => {
        const limitedProvider = new EventicAIProvider({
            model: 'gpt-4o',
            maxStitchContinuations: 2,
        });

        // All responses are truncated
        mockCallProvider
            .mockResolvedValueOnce(makeResponse('A', 'length'))
            .mockResolvedValueOnce(makeResponse('B', 'length'))
            .mockResolvedValueOnce(makeResponse('C', 'length'));

        const result = await limitedProvider.ask('Tell me everything');

        // Initial + 2 continuations = 3 calls total
        expect(mockCallProvider).toHaveBeenCalledTimes(3);
        expect(result).toBe('ABC');
    });

    // ── Error handling ───────────────────────────────────────────────

    test('returns partial content when a continuation fails', async () => {
        mockCallProvider
            .mockResolvedValueOnce(makeResponse('First part', 'length'))
            .mockRejectedValueOnce(new Error('Network error'));

        const result = await provider.ask('Hello');

        expect(result).toBe('First part');
        expect(mockCallProvider).toHaveBeenCalledTimes(2);
    });

    test('stops stitching when continuation returns empty content', async () => {
        mockCallProvider
            .mockResolvedValueOnce(makeResponse('Content here', 'length'))
            .mockResolvedValueOnce(makeResponse('', 'stop'));

        const result = await provider.ask('Hello');

        expect(result).toBe('Content here');
        expect(mockCallProvider).toHaveBeenCalledTimes(2);
    });

    test('stops stitching when continuation returns whitespace-only content', async () => {
        mockCallProvider
            .mockResolvedValueOnce(makeResponse('Content', 'length'))
            .mockResolvedValueOnce(makeResponse('   \n  ', 'stop'));

        const result = await provider.ask('Hello');

        expect(result).toBe('Content');
        expect(mockCallProvider).toHaveBeenCalledTimes(2);
    });

    // ── Cancellation ─────────────────────────────────────────────────

    test('stops stitching when signal is aborted', async () => {
        const controller = new AbortController();

        mockCallProvider
            .mockResolvedValueOnce(makeResponse('First part', 'length'))
            .mockImplementationOnce(async () => {
                // Simulate abort during the continuation
                controller.abort();
                return makeResponse(' more content', 'stop');
            });

        // The abort happens during the second call, but the stitching
        // checks the signal before making the call. Since we abort inside
        // the second mock, it should still return the initial content.
        // Let's test the pre-check path by aborting before the continuation starts.
        const controller2 = new AbortController();

        mockCallProvider.mockReset();
        mockCallProvider
            .mockImplementationOnce(async () => {
                controller2.abort();
                return makeResponse('Only this', 'length');
            });

        const result = await provider.ask('Hello', { signal: controller2.signal });

        // After the first call returns, signal is already aborted,
        // so stitching should not attempt any continuations.
        expect(result).toBe('Only this');
        expect(mockCallProvider).toHaveBeenCalledTimes(1);
    });

    // ── askWithMessages ──────────────────────────────────────────────

    test('stitches responses when called via askWithMessages', async () => {
        mockCallProvider
            .mockResolvedValueOnce(makeResponse('Hello from askWith', 'length'))
            .mockResolvedValueOnce(makeResponse('Messages continuation', 'stop'));

        const messages = [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Tell me something' },
        ];

        const result = await provider.askWithMessages(messages);

        expect(result).toBe('Hello from askWithMessages continuation');
        expect(mockCallProvider).toHaveBeenCalledTimes(2);
    });

    // ── History recording ────────────────────────────────────────────

    test('records full stitched content in conversation history', async () => {
        mockCallProvider
            .mockResolvedValueOnce(makeResponse('Part 1', 'length'))
            .mockResolvedValueOnce(makeResponse(' Part 2', 'stop'));

        await provider.ask('My question');

        // History should have user + assistant with full stitched content
        expect(provider.conversationHistory).toHaveLength(2);
        expect(provider.conversationHistory[0]).toEqual({
            role: 'user',
            content: 'My question',
        });
        expect(provider.conversationHistory[1].content).toBe('Part 1 Part 2');
    });

    // ── Default maxStitchContinuations ───────────────────────────────

    test('defaults to 5 max continuations', () => {
        const defaultProvider = new EventicAIProvider({ model: 'gpt-4o' });
        expect(defaultProvider.maxStitchContinuations).toBe(5);
    });

    test('accepts custom maxStitchContinuations in constructor', () => {
        const customProvider = new EventicAIProvider({
            model: 'gpt-4o',
            maxStitchContinuations: 10,
        });
        expect(customProvider.maxStitchContinuations).toBe(10);
    });
});
