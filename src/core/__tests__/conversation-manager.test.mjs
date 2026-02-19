/**
 * Unit tests for ConversationManager
 * @see src/core/conversation-manager.mjs
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.unstable_mockModule('../../ui/console-styler.mjs', () => ({
    consoleStyler: { log: jest.fn() }
}));

jest.unstable_mockModule('../../config.mjs', () => ({
    config: { ai: { maxTokens: 4096, contextWindowSize: 128000 } }
}));

let uuidCounter = 0;
jest.unstable_mockModule('uuid', () => ({
    v4: () => `test-uuid-${++uuidCounter}`
}));

// Mock fs module
const mockMkdir = jest.fn(async () => undefined);
const mockReaddir = jest.fn(async () => []);
const mockReadFile = jest.fn(async () => '{}');
const mockWriteFile = jest.fn(async () => undefined);
const mockUnlink = jest.fn(async () => undefined);
const mockRename = jest.fn(async () => undefined);
const mockExistsSync = jest.fn(() => false);

jest.unstable_mockModule('fs', () => ({
    default: {
        promises: {
            mkdir: mockMkdir,
            readdir: mockReaddir,
            readFile: mockReadFile,
            writeFile: mockWriteFile,
            unlink: mockUnlink,
            rename: mockRename,
        },
        existsSync: mockExistsSync,
    },
    promises: {
        mkdir: mockMkdir,
        readdir: mockReaddir,
        readFile: mockReadFile,
        writeFile: mockWriteFile,
        unlink: mockUnlink,
        rename: mockRename,
    },
    existsSync: mockExistsSync,
}));

const { ConversationManager } = await import('../conversation-manager.mjs');

describe('ConversationManager', () => {
    let cm;
    const WORK_DIR = '/tmp/test-workspace';

    beforeEach(() => {
        uuidCounter = 0;
        jest.clearAllMocks();
        mockExistsSync.mockReturnValue(false);
        mockReaddir.mockImplementation(async () => []);
        mockMkdir.mockImplementation(async () => undefined);
        mockWriteFile.mockImplementation(async () => undefined);
        mockUnlink.mockImplementation(async () => undefined);
        mockRename.mockImplementation(async () => undefined);
        mockReadFile.mockImplementation(async () => '{}');
        cm = new ConversationManager(WORK_DIR);
    });

    // ── Constructor ────────────────────────────────────────────────────

    describe('constructor', () => {
        it('sets working directory', () => {
            expect(cm.workingDir).toBe(WORK_DIR);
        });

        it('sets conversations dir to .conversations under workingDir', () => {
            expect(cm._conversationsDir).toContain('.conversations');
        });

        it('sets default active conversation to "chat"', () => {
            expect(cm.getActiveConversationName()).toBe('chat');
        });

        it('accepts maxTokens and contextWindowSize options', () => {
            const cm2 = new ConversationManager(WORK_DIR, { maxTokens: 8192, contextWindowSize: 64000 });
            expect(cm2.maxTokens).toBe(8192);
            expect(cm2.contextWindowSize).toBe(64000);
        });
    });

    // ── initialize() ──────────────────────────────────────────────────

    describe('initialize()', () => {
        it('creates the .conversations/ directory', async () => {
            await cm.initialize();
            expect(mockMkdir).toHaveBeenCalledWith(
                expect.stringContaining('.conversations'),
                { recursive: true }
            );
        });

        it('creates default "chat" conversation in memory', async () => {
            await cm.initialize();
            const hm = cm.getActiveHistoryManager();
            expect(hm).toBeDefined();
            expect(typeof hm.addMessage).toBe('function');
        });

        it('attempts to load persisted history for default conversation', async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFile.mockImplementation(async () => JSON.stringify({
                name: 'chat',
                history: [{ role: 'system', content: 'old' }]
            }));
            await cm.initialize();
            expect(mockExistsSync).toHaveBeenCalled();
        });
    });

    // ── createConversation() ──────────────────────────────────────────

    describe('createConversation()', () => {
        beforeEach(async () => {
            await cm.initialize();
        });

        it('creates a new named conversation', async () => {
            const result = await cm.createConversation('dev-task');
            expect(result.created).toBe(true);
            expect(result.name).toBe('dev-task');
        });

        it('sanitizes the conversation name', async () => {
            const result = await cm.createConversation('My Task!');
            expect(result.created).toBe(true);
            expect(result.name).toBe('my-task-');
        });

        it('returns error for duplicate conversation name', async () => {
            await cm.createConversation('task1');
            const result = await cm.createConversation('task1');
            expect(result.created).toBe(false);
            expect(result.error).toContain('already exists');
        });

        it('returns error for invalid name (empty string)', async () => {
            const result = await cm.createConversation('');
            expect(result.created).toBe(false);
            expect(result.error).toContain('Invalid');
        });

        it('saves new conversation to disk when it has content', async () => {
            await cm.createConversation('saved-task', 'system prompt');
            expect(mockWriteFile).toHaveBeenCalled();
        });

        it('initializes with system prompt when provided', async () => {
            await cm.createConversation('task-with-prompt', 'You are a coder');
            const hm = cm.getHistoryManager('task-with-prompt');
            expect(hm).toBeDefined();
            const history = hm.getHistory();
            expect(history[0]?.role).toBe('system');
            expect(history[0]?.content).toBe('You are a coder');
        });

        it('creates conversation without system prompt when not provided', async () => {
            await cm.createConversation('no-prompt');
            const hm = cm.getHistoryManager('no-prompt');
            expect(hm.getHistory()).toHaveLength(0);
        });
    });

    // ── switchConversation() ──────────────────────────────────────────

    describe('switchConversation()', () => {
        beforeEach(async () => {
            await cm.initialize();
            await cm.createConversation('task1');
        });

        it('switches to an existing conversation', async () => {
            const result = await cm.switchConversation('task1');
            expect(result.switched).toBe(true);
            expect(result.name).toBe('task1');
            expect(cm.getActiveConversationName()).toBe('task1');
        });

        it('saves current conversation before switching', async () => {
            const writeCallsBefore = mockWriteFile.mock.calls.length;
            cm.getActiveHistoryManager().initialize('sys');
            await cm.switchConversation('task1');
            expect(mockWriteFile.mock.calls.length).toBeGreaterThan(writeCallsBefore);
        });

        it('returns previousConversation name', async () => {
            const result = await cm.switchConversation('task1');
            expect(result.previousConversation).toBe('chat');
        });

        it('is a no-op when switching to same conversation', async () => {
            const result = await cm.switchConversation('chat');
            expect(result.switched).toBe(true);
            expect(result.name).toBe('chat');
        });

        it('returns error for non-existent conversation', async () => {
            const result = await cm.switchConversation('nonexistent');
            expect(result.switched).toBe(false);
            expect(result.error).toContain('not found');
        });

        it('returns error for invalid name', async () => {
            const result = await cm.switchConversation('');
            expect(result.switched).toBe(false);
            expect(result.error).toContain('Invalid');
        });
    });

    // ── deleteConversation() ──────────────────────────────────────────

    describe('deleteConversation()', () => {
        beforeEach(async () => {
            await cm.initialize();
            await cm.createConversation('to-delete');
        });

        it('deletes a conversation', async () => {
            const result = await cm.deleteConversation('to-delete');
            expect(result.deleted).toBe(true);
            expect(result.name).toBe('to-delete');
        });

        it('removes conversation from memory', async () => {
            await cm.deleteConversation('to-delete');
            expect(cm.getHistoryManager('to-delete')).toBeNull();
        });

        it('removes conversation file from disk', async () => {
            await cm.deleteConversation('to-delete');
            expect(mockUnlink).toHaveBeenCalledWith(
                expect.stringContaining('to-delete.json')
            );
        });

        it('cannot delete the default conversation "chat"', async () => {
            const result = await cm.deleteConversation('chat');
            expect(result.deleted).toBe(false);
            expect(result.error).toContain('Cannot delete');
        });

        it('switches to default when deleting the active conversation', async () => {
            await cm.switchConversation('to-delete');
            expect(cm.getActiveConversationName()).toBe('to-delete');
            await cm.deleteConversation('to-delete');
            expect(cm.getActiveConversationName()).toBe('chat');
        });

        it('returns error for invalid name', async () => {
            const result = await cm.deleteConversation('');
            expect(result.deleted).toBe(false);
            expect(result.error).toContain('Invalid');
        });

        it('handles unlink failure gracefully', async () => {
            mockUnlink.mockImplementation(async () => { throw new Error('ENOENT'); });
            const result = await cm.deleteConversation('to-delete');
            expect(result.deleted).toBe(true);
        });
    });

    // ── listConversations() ───────────────────────────────────────────

    describe('listConversations()', () => {
        beforeEach(async () => {
            await cm.initialize();
        });

        it('lists all loaded conversations', async () => {
            await cm.createConversation('task1');
            const list = await cm.listConversations();
            expect(list.length).toBeGreaterThanOrEqual(2);
            expect(list.find(c => c.name === 'chat')).toBeTruthy();
            expect(list.find(c => c.name === 'task1')).toBeTruthy();
        });

        it('marks active conversation', async () => {
            const list = await cm.listConversations();
            const active = list.find(c => c.isActive);
            expect(active.name).toBe('chat');
        });

        it('marks default conversation', async () => {
            const list = await cm.listConversations();
            const def = list.find(c => c.isDefault);
            expect(def.name).toBe('chat');
        });

        it('includes messageCount for each conversation', async () => {
            const list = await cm.listConversations();
            for (const conv of list) {
                expect(typeof conv.messageCount).toBe('number');
            }
        });

        it('includes estimatedTokens for each conversation', async () => {
            const list = await cm.listConversations();
            for (const conv of list) {
                expect(typeof conv.estimatedTokens).toBe('number');
            }
        });

        it('scans disk for conversations not yet in memory', async () => {
            mockReaddir.mockImplementation(async () => ['on-disk.json']);
            mockExistsSync.mockReturnValue(true);
            mockReadFile.mockImplementation(async () => JSON.stringify({
                name: 'on-disk',
                history: [{ role: 'system', content: 'loaded from disk' }]
            }));
            const list = await cm.listConversations();
            expect(list.find(c => c.name === 'on-disk')).toBeTruthy();
        });

        it('handles readdir failure gracefully', async () => {
            mockReaddir.mockImplementation(async () => { throw new Error('ENOENT'); });
            const list = await cm.listConversations();
            expect(Array.isArray(list)).toBe(true);
        });
    });

    // ── getActiveHistoryManager() ─────────────────────────────────────

    describe('getActiveHistoryManager()', () => {
        beforeEach(async () => {
            await cm.initialize();
        });

        it('returns the HistoryManager for the active conversation', () => {
            const hm = cm.getActiveHistoryManager();
            expect(hm).toBeDefined();
            expect(typeof hm.addMessage).toBe('function');
        });

        it('creates a HistoryManager if one is missing for the active conversation', () => {
            cm._conversations.delete('chat');
            const hm = cm.getActiveHistoryManager();
            expect(hm).toBeDefined();
        });
    });

    // ── getActiveConversationName() / isDefaultConversation() ──────────

    describe('getActiveConversationName()', () => {
        it('returns the name of the active conversation', () => {
            expect(cm.getActiveConversationName()).toBe('chat');
        });

        it('updates when conversation is switched', async () => {
            await cm.initialize();
            await cm.createConversation('task1');
            await cm.switchConversation('task1');
            expect(cm.getActiveConversationName()).toBe('task1');
        });
    });

    describe('isDefaultConversation()', () => {
        it('returns true for the default conversation', () => {
            expect(cm.isDefaultConversation()).toBe(true);
        });

        it('returns true when "chat" is passed', () => {
            expect(cm.isDefaultConversation('chat')).toBe(true);
        });

        it('returns false for non-default conversations', () => {
            expect(cm.isDefaultConversation('task1')).toBe(false);
        });

        it('returns false when active conversation is not default', async () => {
            await cm.initialize();
            await cm.createConversation('task1');
            await cm.switchConversation('task1');
            expect(cm.isDefaultConversation()).toBe(false);
        });
    });

    // ── reportToParent() ──────────────────────────────────────────────

    describe('reportToParent()', () => {
        beforeEach(async () => {
            await cm.initialize();
            cm.getActiveHistoryManager().initialize('system prompt');
            await cm.createConversation('child-task');
        });

        it('injects a summary message into the parent (chat) conversation', async () => {
            const result = await cm.reportToParent('child-task', 'Task completed successfully');
            expect(result.reported).toBe(true);

            const parentHm = cm.getHistoryManager('chat');
            const history = parentHm.getHistory();
            const reportMsg = history.find(m => m.content?.includes('child-task'));
            expect(reportMsg).toBeTruthy();
            expect(reportMsg.content).toContain('Task completed successfully');
        });

        it('includes metadata in the report', async () => {
            await cm.reportToParent('child-task', 'Done', { filesChanged: 3 });
            const parentHm = cm.getHistoryManager('chat');
            const history = parentHm.getHistory();
            const reportMsg = history.find(m => m.content?.includes('filesChanged'));
            expect(reportMsg).toBeTruthy();
        });

        it('returns error when default conversation reports to itself', async () => {
            const result = await cm.reportToParent('chat', 'self report');
            expect(result.reported).toBe(false);
            expect(result.error).toContain('cannot report to itself');
        });

        it('saves parent conversation after injection', async () => {
            const callsBefore = mockWriteFile.mock.calls.length;
            await cm.reportToParent('child-task', 'Done');
            expect(mockWriteFile.mock.calls.length).toBeGreaterThan(callsBefore);
        });
    });

    // ── switchWorkspace() ─────────────────────────────────────────────

    describe('switchWorkspace()', () => {
        beforeEach(async () => {
            await cm.initialize();
        });

        it('updates workingDir to new directory', async () => {
            await cm.switchWorkspace('/new/workspace');
            expect(cm.workingDir).toBe('/new/workspace');
        });

        it('updates conversations dir to new location', async () => {
            await cm.switchWorkspace('/new/workspace');
            expect(cm._conversationsDir).toContain('/new/workspace');
            expect(cm._conversationsDir).toContain('.conversations');
        });

        it('clears in-memory conversations', async () => {
            await cm.createConversation('task1');
            await cm.switchWorkspace('/new/workspace');
            expect(cm.getHistoryManager('task1')).toBeNull();
        });

        it('resets active conversation to default', async () => {
            await cm.createConversation('task1');
            await cm.switchConversation('task1');
            await cm.switchWorkspace('/new/workspace');
            expect(cm.getActiveConversationName()).toBe('chat');
        });
    });

    // ── migrateFromLegacy() ───────────────────────────────────────────

    describe('migrateFromLegacy()', () => {
        beforeEach(async () => {
            await cm.initialize();
        });

        it('returns false when legacy file does not exist', async () => {
            mockExistsSync.mockReturnValue(false);
            const result = await cm.migrateFromLegacy();
            expect(result).toBe(false);
        });

        it('migrates legacy .conversation.json to default conversation', async () => {
            const legacyHistory = [
                { role: 'system', content: 'old system prompt' },
                { role: 'user', content: 'hello' }
            ];
            mockExistsSync.mockReturnValue(true);
            mockReadFile.mockImplementation(async () => JSON.stringify(legacyHistory));

            const result = await cm.migrateFromLegacy();
            expect(result).toBe(true);
        });

        it('renames legacy file to .bak after migration', async () => {
            const legacyHistory = [
                { role: 'system', content: 'old' },
                { role: 'user', content: 'hello' }
            ];
            mockExistsSync.mockReturnValue(true);
            mockReadFile.mockImplementation(async () => JSON.stringify(legacyHistory));

            await cm.migrateFromLegacy();
            expect(mockRename).toHaveBeenCalledWith(
                expect.stringContaining('.conversation.json'),
                expect.stringContaining('.conversation.json.bak')
            );
        });

        it('returns false on migration error', async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFile.mockImplementation(async () => { throw new Error('read error'); });
            const result = await cm.migrateFromLegacy();
            expect(result).toBe(false);
        });
    });

    // ── clearConversation() ───────────────────────────────────────────

    describe('clearConversation()', () => {
        beforeEach(async () => {
            await cm.initialize();
            cm.getActiveHistoryManager().initialize('system');
            cm.getActiveHistoryManager().addMessage('user', 'hello');
        });

        it('clears the active conversation', async () => {
            const result = await cm.clearConversation();
            expect(result.cleared).toBe(true);
            const hm = cm.getActiveHistoryManager();
            expect(hm.getHistory()).toHaveLength(1);
        });

        it('clears a named conversation', async () => {
            await cm.createConversation('task1', 'system for task1');
            cm.getHistoryManager('task1').addMessage('user', 'task msg');
            const result = await cm.clearConversation('task1');
            expect(result.cleared).toBe(true);
        });

        it('returns error for non-existent conversation', async () => {
            const result = await cm.clearConversation('nonexistent');
            expect(result.cleared).toBe(false);
            expect(result.error).toContain('not found');
        });
    });

    // ── _sanitizeName() ───────────────────────────────────────────────

    describe('_sanitizeName()', () => {
        it('lowercases names', () => {
            expect(cm._sanitizeName('MyTask')).toBe('mytask');
        });

        it('replaces special characters with hyphens', () => {
            expect(cm._sanitizeName('my task!')).toBe('my-task-');
        });

        it('returns null for null/undefined', () => {
            expect(cm._sanitizeName(null)).toBeNull();
            expect(cm._sanitizeName(undefined)).toBeNull();
        });

        it('returns null for empty string', () => {
            expect(cm._sanitizeName('')).toBeNull();
        });

        it('returns null for names longer than 64 characters', () => {
            const longName = 'a'.repeat(65);
            expect(cm._sanitizeName(longName)).toBeNull();
        });

        it('returns null for non-string input', () => {
            expect(cm._sanitizeName(123)).toBeNull();
        });

        it('allows hyphens and underscores', () => {
            expect(cm._sanitizeName('my-task_1')).toBe('my-task_1');
        });
    });

    // ── saveAll() / saveActive() ──────────────────────────────────────

    describe('saveAll() / saveActive()', () => {
        beforeEach(async () => {
            await cm.initialize();
            cm.getActiveHistoryManager().initialize('system');
        });

        it('saveActive saves the current conversation', async () => {
            const callsBefore = mockWriteFile.mock.calls.length;
            await cm.saveActive();
            expect(mockWriteFile.mock.calls.length).toBeGreaterThan(callsBefore);
        });

        it('saveAll saves all loaded conversations', async () => {
            await cm.createConversation('task1', 'system1');
            const callsBefore = mockWriteFile.mock.calls.length;
            await cm.saveAll();
            expect(mockWriteFile.mock.calls.length).toBeGreaterThan(callsBefore);
        });
    });

    // ── getHistoryManager() ───────────────────────────────────────────

    describe('getHistoryManager()', () => {
        beforeEach(async () => {
            await cm.initialize();
        });

        it('returns the HistoryManager for a named conversation', async () => {
            await cm.createConversation('task1');
            const hm = cm.getHistoryManager('task1');
            expect(hm).toBeDefined();
            expect(typeof hm.addMessage).toBe('function');
        });

        it('returns null for non-existent conversation', () => {
            expect(cm.getHistoryManager('nonexistent')).toBeNull();
        });
    });
});
