/**
 * Unit tests for HistoryManager
 * @see src/core/history-manager.mjs
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

let uuidCounter = 0;

jest.unstable_mockModule('../../ui/console-styler.mjs', () => ({
    consoleStyler: { log: jest.fn() }
}));

jest.unstable_mockModule('../../config.mjs', () => ({
    config: { ai: { maxTokens: 4096, contextWindowSize: 128000 } }
}));

jest.unstable_mockModule('uuid', () => ({
    v4: () => `test-uuid-${++uuidCounter}`
}));

const { HistoryManager } = await import('../history-manager.mjs');

describe('HistoryManager', () => {
    let hm;

    beforeEach(() => {
        uuidCounter = 0;
        hm = new HistoryManager();
    });

    // ── Constructor ────────────────────────────────────────────────────

    describe('constructor', () => {
        it('initializes with default maxTokens and contextWindowSize from config', () => {
            expect(hm.maxTokens).toBe(4096);
            expect(hm.contextWindowSize).toBe(128000);
        });

        it('accepts custom maxTokens and contextWindowSize', () => {
            const custom = new HistoryManager(8192, 64000);
            expect(custom.maxTokens).toBe(8192);
            expect(custom.contextWindowSize).toBe(64000);
        });

        it('starts with empty history', () => {
            expect(hm.history).toEqual([]);
            expect(hm.systemMessage).toBeNull();
        });

        it('starts with empty checkpoints', () => {
            expect(hm.listCheckpoints()).toEqual([]);
        });
    });

    // ── initialize() ──────────────────────────────────────────────────

    describe('initialize()', () => {
        it('creates history with a system message', () => {
            hm.initialize('You are a helpful assistant');
            const history = hm.getHistory();
            expect(history).toHaveLength(1);
            expect(history[0].role).toBe('system');
            expect(history[0].content).toBe('You are a helpful assistant');
        });

        it('assigns an id to the system message', () => {
            hm.initialize('system prompt');
            expect(hm.getHistory()[0].id).toBeDefined();
        });

        it('sets systemMessage property', () => {
            hm.initialize('system prompt');
            expect(hm.systemMessage).toBe(hm.getHistory()[0]);
            expect(hm.systemMessage.content).toBe('system prompt');
        });
    });

    // ── addMessage() ──────────────────────────────────────────────────

    describe('addMessage()', () => {
        beforeEach(() => {
            hm.initialize('system');
        });

        it('adds a user message to history', () => {
            hm.addMessage('user', 'Hello');
            expect(hm.getHistory()).toHaveLength(2);
            expect(hm.getHistory()[1].role).toBe('user');
            expect(hm.getHistory()[1].content).toBe('Hello');
        });

        it('adds an assistant message to history', () => {
            hm.addMessage('assistant', 'Hi there');
            const msg = hm.getHistory()[1];
            expect(msg.role).toBe('assistant');
            expect(msg.content).toBe('Hi there');
        });

        it('assigns unique ids to each message', () => {
            hm.addMessage('user', 'msg1');
            hm.addMessage('assistant', 'msg2');
            const ids = hm.getHistory().map(m => m.id);
            const uniqueIds = new Set(ids);
            expect(uniqueIds.size).toBe(ids.length);
        });

        it('attaches tool_calls when provided', () => {
            const toolCalls = [{ function: { name: 'readFile', arguments: '{}' } }];
            hm.addMessage('assistant', null, toolCalls);
            expect(hm.getHistory()[1].tool_calls).toEqual(toolCalls);
        });

        it('attaches tool_call_id when provided', () => {
            hm.addMessage('tool', 'result', null, 'call-123');
            expect(hm.getHistory()[1].tool_call_id).toBe('call-123');
        });

        it('attaches name when provided', () => {
            hm.addMessage('tool', 'result', null, 'call-123', 'readFile');
            expect(hm.getHistory()[1].name).toBe('readFile');
        });

        it('does not add tool_calls/tool_call_id/name fields when not provided', () => {
            hm.addMessage('user', 'hello');
            const msg = hm.getHistory()[1];
            expect(msg.tool_calls).toBeUndefined();
            expect(msg.tool_call_id).toBeUndefined();
            expect(msg.name).toBeUndefined();
        });
    });

    // ── pushMessage() ─────────────────────────────────────────────────

    describe('pushMessage()', () => {
        beforeEach(() => {
            hm.initialize('system');
        });

        it('adds a raw message object to history', () => {
            hm.pushMessage({ role: 'user', content: 'raw message' });
            expect(hm.getHistory()).toHaveLength(2);
            expect(hm.getHistory()[1].content).toBe('raw message');
        });

        it('assigns an id if the message does not have one', () => {
            hm.pushMessage({ role: 'user', content: 'no id' });
            expect(hm.getHistory()[1].id).toBeDefined();
        });

        it('preserves existing id on the message', () => {
            hm.pushMessage({ id: 'existing-id', role: 'user', content: 'has id' });
            expect(hm.getHistory()[1].id).toBe('existing-id');
        });
    });

    // ── getHistory() / setHistory() ───────────────────────────────────

    describe('getHistory() / setHistory()', () => {
        it('getHistory returns the current history array', () => {
            hm.initialize('sys');
            hm.addMessage('user', 'hello');
            expect(hm.getHistory()).toHaveLength(2);
        });

        it('setHistory replaces the history with provided messages', () => {
            const messages = [
                { role: 'system', content: 'new system' },
                { role: 'user', content: 'new user msg' }
            ];
            hm.setHistory(messages);
            expect(hm.getHistory()).toHaveLength(2);
            expect(hm.getHistory()[0].content).toBe('new system');
        });

        it('setHistory updates systemMessage when first message is system', () => {
            hm.setHistory([{ role: 'system', content: 'updated' }]);
            expect(hm.systemMessage.content).toBe('updated');
        });

        it('setHistory creates a shallow copy (does not reference original array)', () => {
            const messages = [{ role: 'system', content: 'test' }];
            hm.setHistory(messages);
            messages.push({ role: 'user', content: 'extra' });
            expect(hm.getHistory()).toHaveLength(1);
        });
    });

    // ── getLastExchanges() ────────────────────────────────────────────

    describe('getLastExchanges()', () => {
        beforeEach(() => {
            hm.initialize('system prompt');
            hm.addMessage('user', 'user1');
            hm.addMessage('assistant', 'assist1');
            hm.addMessage('user', 'user2');
            hm.addMessage('assistant', 'assist2');
            hm.addMessage('user', 'user3');
            hm.addMessage('assistant', 'assist3');
        });

        it('returns last N exchanges plus system prompt', () => {
            const result = hm.getLastExchanges(1);
            expect(result[0].role).toBe('system');
            expect(result.find(m => m.content === 'user3')).toBeTruthy();
            expect(result.find(m => m.content === 'assist3')).toBeTruthy();
            expect(result.find(m => m.content === 'user1')).toBeFalsy();
        });

        it('returns last 2 exchanges', () => {
            const result = hm.getLastExchanges(2);
            expect(result[0].role).toBe('system');
            expect(result.find(m => m.content === 'user2')).toBeTruthy();
            expect(result.find(m => m.content === 'user3')).toBeTruthy();
            expect(result.find(m => m.content === 'user1')).toBeFalsy();
        });

        it('returns all history when requesting more exchanges than exist', () => {
            const result = hm.getLastExchanges(100);
            expect(result).toHaveLength(hm.getHistory().length);
        });

        it('returns full history copy when count <= 0', () => {
            const result = hm.getLastExchanges(0);
            expect(result).toHaveLength(hm.getHistory().length);
        });

        it('handles history with no system prompt', () => {
            const hm2 = new HistoryManager();
            hm2.addMessage('user', 'hello');
            hm2.addMessage('assistant', 'hi');
            const result = hm2.getLastExchanges(1);
            expect(result.find(m => m.content === 'hello')).toBeTruthy();
        });
    });

    // ── getStats() ────────────────────────────────────────────────────

    describe('getStats()', () => {
        it('returns correct stats for empty history', () => {
            const stats = hm.getStats();
            expect(stats.messageCount).toBe(0);
            expect(stats.estimatedTokens).toBe(0);
            expect(stats.contextWindowSize).toBe(128000);
            expect(stats.utilizationPercent).toBe(0);
        });

        it('returns correct message count', () => {
            hm.initialize('system');
            hm.addMessage('user', 'hello');
            hm.addMessage('assistant', 'hi');
            const stats = hm.getStats();
            expect(stats.messageCount).toBe(3);
        });

        it('calculates utilization percentage', () => {
            hm.initialize('system');
            const stats = hm.getStats();
            expect(stats.utilizationPercent).toBeGreaterThanOrEqual(0);
            expect(stats.utilizationPercent).toBeLessThanOrEqual(100);
        });
    });

    // ── updateSystemPrompt() ──────────────────────────────────────────

    describe('updateSystemPrompt()', () => {
        it('updates existing system prompt content', () => {
            hm.initialize('original');
            hm.updateSystemPrompt('updated');
            expect(hm.getHistory()[0].content).toBe('updated');
            expect(hm.systemMessage.content).toBe('updated');
        });

        it('creates system prompt if none exists', () => {
            hm.updateSystemPrompt('new system');
            expect(hm.getHistory()[0].role).toBe('system');
            expect(hm.getHistory()[0].content).toBe('new system');
            expect(hm.systemMessage.content).toBe('new system');
        });

        it('prepends system prompt to existing non-system history', () => {
            hm.addMessage('user', 'hello');
            hm.updateSystemPrompt('late system');
            expect(hm.getHistory()[0].role).toBe('system');
            expect(hm.getHistory()[1].role).toBe('user');
        });
    });

    // ── deleteHistoryExchanges() ──────────────────────────────────────

    describe('deleteHistoryExchanges()', () => {
        beforeEach(() => {
            hm.initialize('system');
            hm.addMessage('user', 'user1');
            hm.addMessage('assistant', 'assist1');
            hm.addMessage('user', 'user2');
            hm.addMessage('assistant', 'assist2');
        });

        it('deletes the most recent exchange', () => {
            const deleted = hm.deleteHistoryExchanges(1);
            expect(deleted).toBe(1);
            expect(hm.getHistory().find(m => m.content === 'user2')).toBeFalsy();
            expect(hm.getHistory().find(m => m.content === 'assist2')).toBeFalsy();
        });

        it('returns 0 for count <= 0', () => {
            expect(hm.deleteHistoryExchanges(0)).toBe(0);
            expect(hm.deleteHistoryExchanges(-1)).toBe(0);
        });

        it('preserves the system message', () => {
            hm.deleteHistoryExchanges(10);
            expect(hm.getHistory()[0].role).toBe('system');
        });

        it('returns actual number of exchanges deleted', () => {
            const deleted = hm.deleteHistoryExchanges(100);
            expect(deleted).toBeLessThanOrEqual(2);
        });
    });

    // ── deleteMessage() ───────────────────────────────────────────────

    describe('deleteMessage()', () => {
        it('deletes a message by its id', () => {
            hm.initialize('system');
            hm.addMessage('user', 'to delete');
            const msgId = hm.getHistory()[1].id;
            expect(hm.deleteMessage(msgId)).toBe(true);
            expect(hm.getHistory()).toHaveLength(1);
        });

        it('returns false when id is not found', () => {
            hm.initialize('system');
            expect(hm.deleteMessage('nonexistent-id')).toBe(false);
        });

        it('does not modify history when id is not found', () => {
            hm.initialize('system');
            hm.addMessage('user', 'keep');
            const lenBefore = hm.getHistory().length;
            hm.deleteMessage('nonexistent-id');
            expect(hm.getHistory().length).toBe(lenBefore);
        });
    });

    // ── reset() ───────────────────────────────────────────────────────

    describe('reset()', () => {
        it('resets history to just the system prompt', () => {
            hm.initialize('system');
            hm.addMessage('user', 'hello');
            hm.addMessage('assistant', 'hi');
            hm.reset();
            expect(hm.getHistory()).toHaveLength(1);
            expect(hm.getHistory()[0].role).toBe('system');
        });

        it('resets to empty when no system message exists', () => {
            hm.addMessage('user', 'hello');
            hm.reset();
            expect(hm.getHistory()).toHaveLength(0);
        });
    });

    // ── estimateTokens() / getTotalTokens() ───────────────────────────

    describe('estimateTokens()', () => {
        it('estimates tokens based on character count', () => {
            expect(hm.estimateTokens('hello world!')).toBe(3);
        });

        it('returns 0 for null/empty input', () => {
            expect(hm.estimateTokens(null)).toBe(0);
            expect(hm.estimateTokens('')).toBe(0);
        });

        it('rounds up fractional token counts', () => {
            expect(hm.estimateTokens('hello')).toBe(2);
        });
    });

    describe('getTotalTokens()', () => {
        it('returns 0 for empty history', () => {
            expect(hm.getTotalTokens()).toBe(0);
        });

        it('includes role overhead per message', () => {
            hm.initialize('sys');
            const tokens = hm.getTotalTokens();
            expect(tokens).toBeGreaterThan(0);
        });

        it('includes tool call tokens in the count', () => {
            hm.initialize('sys');
            const beforeTokens = hm.getTotalTokens();
            hm.addMessage('assistant', '', [
                { function: { name: 'readFile', arguments: '{"path": "/tmp/file"}' } }
            ]);
            expect(hm.getTotalTokens()).toBeGreaterThan(beforeTokens);
        });
    });

    // ── checkpoint() / rollbackTo() / listCheckpoints() ───────────────

    describe('checkpoint system', () => {
        beforeEach(() => {
            hm.initialize('system');
            hm.addMessage('user', 'message 1');
        });

        it('creates a named checkpoint', () => {
            hm.checkpoint('cp1');
            const checkpoints = hm.listCheckpoints();
            expect(checkpoints).toHaveLength(1);
            expect(checkpoints[0].name).toBe('cp1');
        });

        it('checkpoint captures current history state', () => {
            hm.checkpoint('cp1');
            const checkpoints = hm.listCheckpoints();
            expect(checkpoints[0].messageCount).toBe(2);
        });

        it('checkpoint includes a timestamp', () => {
            hm.checkpoint('cp1');
            const checkpoints = hm.listCheckpoints();
            expect(typeof checkpoints[0].timestamp).toBe('number');
        });

        it('rollbackTo restores history to checkpoint state', () => {
            hm.checkpoint('before-more');
            hm.addMessage('user', 'message 2');
            hm.addMessage('assistant', 'response 2');
            expect(hm.getHistory()).toHaveLength(4);

            hm.rollbackTo('before-more');
            expect(hm.getHistory()).toHaveLength(2);
            expect(hm.getHistory()[1].content).toBe('message 1');
        });

        it('rollbackTo returns the checkpoint timestamp', () => {
            hm.checkpoint('cp1');
            const timestamp = hm.rollbackTo('cp1');
            expect(typeof timestamp).toBe('number');
        });

        it('rollbackTo throws for nonexistent checkpoint', () => {
            expect(() => hm.rollbackTo('nonexistent')).toThrow(/not found/);
        });

        it('rollbackTo restores systemMessage reference', () => {
            hm.checkpoint('cp1');
            hm.addMessage('user', 'extra');
            hm.rollbackTo('cp1');
            expect(hm.systemMessage).toBe(hm.getHistory()[0]);
        });

        it('multiple checkpoints can coexist', () => {
            hm.checkpoint('cp1');
            hm.addMessage('user', 'msg2');
            hm.checkpoint('cp2');
            expect(hm.listCheckpoints()).toHaveLength(2);
        });

        it('overwriting a checkpoint replaces the old one', () => {
            hm.checkpoint('cp1');
            hm.addMessage('user', 'extra');
            hm.checkpoint('cp1');
            expect(hm.listCheckpoints()).toHaveLength(1);
            hm.rollbackTo('cp1');
            expect(hm.getHistory()).toHaveLength(3);
        });
    });

    // ── deleteCheckpoint() ────────────────────────────────────────────

    describe('deleteCheckpoint()', () => {
        it('deletes an existing checkpoint', () => {
            hm.initialize('system');
            hm.checkpoint('cp1');
            expect(hm.deleteCheckpoint('cp1')).toBe(true);
            expect(hm.listCheckpoints()).toHaveLength(0);
        });

        it('returns false for nonexistent checkpoint', () => {
            expect(hm.deleteCheckpoint('nonexistent')).toBe(false);
        });
    });

    // ── clone() ───────────────────────────────────────────────────────

    describe('clone()', () => {
        it('creates a deep copy of the history manager', () => {
            hm.initialize('system');
            hm.addMessage('user', 'hello');
            const cloned = hm.clone();
            expect(cloned.getHistory()).toHaveLength(2);
            expect(cloned.getHistory()[0].content).toBe('system');
        });

        it('modifications to clone do not affect original', () => {
            hm.initialize('system');
            const cloned = hm.clone();
            cloned.addMessage('user', 'only in clone');
            expect(hm.getHistory()).toHaveLength(1);
            expect(cloned.getHistory()).toHaveLength(2);
        });

        it('modifications to original do not affect clone', () => {
            hm.initialize('system');
            hm.addMessage('user', 'original msg');
            const cloned = hm.clone();
            hm.addMessage('user', 'after clone');
            expect(cloned.getHistory()).toHaveLength(2);
            expect(hm.getHistory()).toHaveLength(3);
        });

        it('preserves maxTokens and contextWindowSize', () => {
            const custom = new HistoryManager(8192, 64000);
            const cloned = custom.clone();
            expect(cloned.maxTokens).toBe(8192);
            expect(cloned.contextWindowSize).toBe(64000);
        });

        it('re-links systemMessage on clone', () => {
            hm.initialize('system');
            const cloned = hm.clone();
            expect(cloned.systemMessage).toBe(cloned.getHistory()[0]);
        });
    });

    // ── setSummarizer() ───────────────────────────────────────────────

    describe('setSummarizer()', () => {
        it('stores the summarizer function', () => {
            const fn = jest.fn();
            hm.setSummarizer(fn);
            expect(hm._summarizer).toBe(fn);
        });
    });

    // ── Edge cases ────────────────────────────────────────────────────

    describe('edge cases', () => {
        it('handles empty history gracefully for getLastExchanges', () => {
            const result = hm.getLastExchanges(5);
            expect(result).toHaveLength(0);
        });

        it('handles history with only system message for getLastExchanges', () => {
            hm.initialize('system');
            const result = hm.getLastExchanges(5);
            expect(result).toHaveLength(1);
            expect(result[0].role).toBe('system');
        });

        it('deleteHistoryExchanges on empty history returns 0', () => {
            expect(hm.deleteHistoryExchanges(5)).toBe(0);
        });

        it('deleteHistoryExchanges on history with only system returns 0', () => {
            hm.initialize('system');
            expect(hm.deleteHistoryExchanges(5)).toBe(0);
        });

        it('clone on empty history produces empty clone', () => {
            const cloned = hm.clone();
            expect(cloned.getHistory()).toHaveLength(0);
            expect(cloned.systemMessage).toBeNull();
        });

        it('getStats on large history calculates correctly', () => {
            hm.initialize('system');
            for (let i = 0; i < 50; i++) {
                hm.addMessage('user', `message ${i}`);
                hm.addMessage('assistant', `response ${i}`);
            }
            const stats = hm.getStats();
            expect(stats.messageCount).toBe(101);
            expect(stats.estimatedTokens).toBeGreaterThan(0);
        });
    });
});
