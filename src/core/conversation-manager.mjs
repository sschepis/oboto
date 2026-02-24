/**
 * ConversationManager — manages multiple named conversations per workspace.
 *
 * Conversations are stored as JSON files under `<workingDir>/.conversations/`.
 * The default conversation is always named "chat" and cannot be deleted.
 *
 * Each conversation is a separate HistoryManager; switching conversations
 * swaps which HistoryManager the assistant uses while keeping the
 * WorkspaceManager, ResoLangService, and other shared state intact.
 *
 * Parent-child reporting:
 *   Child conversations can report results back to the parent ("chat")
 *   by appending a system message to the parent's history.
 */

import fs from 'fs';
import path from 'path';
import { HistoryManager } from './history-manager.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';

const CONVERSATIONS_DIR = '.conversations';
const DEFAULT_CONVERSATION = 'chat';

export class ConversationManager {
    /**
     * @param {string} workingDir - The workspace root directory.
     * @param {Object} [options]
     * @param {number|null} [options.maxTokens] - Max tokens for HistoryManagers
     * @param {number|null} [options.contextWindowSize] - Context window size
     */
    constructor(workingDir, options = {}) {
        this.workingDir = workingDir;
        this.maxTokens = options.maxTokens || null;
        this.contextWindowSize = options.contextWindowSize || null;

        /** @type {Map<string, HistoryManager>} Loaded conversations keyed by name */
        this._conversations = new Map();

        /** @type {string} Name of the currently active conversation */
        this._activeConversation = DEFAULT_CONVERSATION;

        /** @type {string} Path to the conversations directory */
        this._conversationsDir = path.join(this.workingDir, CONVERSATIONS_DIR);
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────

    /**
     * Ensure the .conversations/ directory exists and load the default conversation.
     */
    async initialize() {
        await fs.promises.mkdir(this._conversationsDir, { recursive: true });

        // Always ensure the default conversation exists
        if (!this._conversations.has(DEFAULT_CONVERSATION)) {
            const hm = this._createHistoryManager();
            this._conversations.set(DEFAULT_CONVERSATION, hm);
        }

        // Try to load persisted history for the default conversation
        await this._loadFromDisk(DEFAULT_CONVERSATION);
    }

    /**
     * Switch the working directory (called when workspace changes).
     * Saves current conversations and re-initializes at the new location.
     */
    async switchWorkspace(newDir) {
        // Save everything before switching
        await this.saveAll();

        this.workingDir = newDir;
        this._conversationsDir = path.join(newDir, CONVERSATIONS_DIR);
        this._conversations.clear();
        this._activeConversation = DEFAULT_CONVERSATION;

        await this.initialize();
    }

    // ─── Conversation CRUD ────────────────────────────────────────────────

    /**
     * List all available conversations.
     * Returns metadata only, not full history.
     * @returns {Array<{name: string, messageCount: number, isActive: boolean, createdAt: string|null}>}
     */
    async listConversations() {
        // Scan disk for any conversations not yet loaded into memory
        try {
            const files = await fs.promises.readdir(this._conversationsDir);
            for (const file of files) {
                // Only load plain conversation JSON files; skip auxiliary files
                // like .continuity.json (symbolic continuity data)
                if (file.endsWith('.json') && !file.includes('.continuity.')) {
                    const name = file.replace(/\.json$/, '');
                    if (!this._conversations.has(name)) {
                        await this._loadFromDisk(name);
                    }
                }
            }
        } catch {
            // Directory might not exist yet
        }

        const result = [];
        for (const [name, hm] of this._conversations) {
            const history = hm.getHistory();
            result.push({
                name,
                messageCount: history.length,
                isActive: name === this._activeConversation,
                isDefault: name === DEFAULT_CONVERSATION,
                estimatedTokens: hm.getTotalTokens()
            });
        }

        return result;
    }

    /**
     * Create a new conversation.
     * @param {string} name - Conversation name (alphanumeric + hyphens/underscores)
     * @param {string} [systemPrompt] - Optional initial system prompt
     * @returns {{name: string, created: boolean, error?: string}}
     */
    async createConversation(name, systemPrompt = null) {
        // Validate name
        const sanitized = this._sanitizeName(name);
        if (!sanitized) {
            return { name, created: false, error: 'Invalid conversation name. Use alphanumeric characters, hyphens, and underscores.' };
        }

        if (this._conversations.has(sanitized)) {
            return { name: sanitized, created: false, error: `Conversation "${sanitized}" already exists.` };
        }

        const hm = this._createHistoryManager();
        if (systemPrompt) {
            hm.initialize(systemPrompt);
        }

        this._conversations.set(sanitized, hm);
        await this._saveToDisk(sanitized);

        consoleStyler.log('system', `📝 Created conversation: ${sanitized}`);
        return { name: sanitized, created: true };
    }

    /**
     * Switch to a different conversation.
     * Saves the current conversation before switching.
     * @param {string} name
     * @returns {{switched: boolean, name: string, error?: string}}
     */
    async switchConversation(name) {
        const sanitized = this._sanitizeName(name);
        if (!sanitized) {
            return { switched: false, name, error: 'Invalid conversation name.' };
        }

        // If switching to the same conversation, no-op
        if (sanitized === this._activeConversation) {
            return { switched: true, name: sanitized, error: null };
        }

        // Save current conversation
        await this._saveToDisk(this._activeConversation);

        // Load target if not in memory
        if (!this._conversations.has(sanitized)) {
            const loaded = await this._loadFromDisk(sanitized);
            if (!loaded) {
                return { switched: false, name: sanitized, error: `Conversation "${sanitized}" not found.` };
            }
        }

        const prevConversation = this._activeConversation;
        this._activeConversation = sanitized;

        consoleStyler.log('system', `🔄 Switched conversation: ${prevConversation} → ${sanitized}`);
        return { switched: true, name: sanitized, previousConversation: prevConversation };
    }

    /**
     * Delete a conversation.
     * The default conversation ("chat") cannot be deleted.
     * @param {string} name
     * @returns {{deleted: boolean, name: string, error?: string}}
     */
    async deleteConversation(name) {
        const sanitized = this._sanitizeName(name);
        if (!sanitized) {
            return { deleted: false, name, error: 'Invalid conversation name.' };
        }

        if (sanitized === DEFAULT_CONVERSATION) {
            return { deleted: false, name: sanitized, error: `Cannot delete the default conversation "${DEFAULT_CONVERSATION}".` };
        }

        // If deleting the active conversation, switch to default first
        if (sanitized === this._activeConversation) {
            await this.switchConversation(DEFAULT_CONVERSATION);
        }

        this._conversations.delete(sanitized);

        // Remove from disk
        const filePath = path.join(this._conversationsDir, `${sanitized}.json`);
        try {
            await fs.promises.unlink(filePath);
        } catch {
            // File might not exist
        }

        consoleStyler.log('system', `🗑️  Deleted conversation: ${sanitized}`);
        return { deleted: true, name: sanitized };
    }

    /**
     * Rename a conversation.
     * The default conversation ("chat") cannot be renamed.
     * @param {string} oldName
     * @param {string} newName
     * @returns {{success: boolean, oldName: string, newName?: string, error?: string}}
     */
    async renameConversation(oldName, newName) {
        const sanitizedNewName = this._sanitizeName(newName);
        if (!sanitizedNewName) {
            return { success: false, oldName, error: 'Invalid new conversation name. Use alphanumeric characters, hyphens, and underscores.' };
        }

        if (oldName === DEFAULT_CONVERSATION) {
            return { success: false, oldName, error: `Cannot rename the default conversation "${DEFAULT_CONVERSATION}".` };
        }

        if (!this._conversations.has(oldName)) {
            return { success: false, oldName, error: `Conversation "${oldName}" not found.` };
        }

        if (this._conversations.has(sanitizedNewName)) {
            return { success: false, oldName, error: `Conversation "${sanitizedNewName}" already exists.` };
        }

        // Rename the JSON file on disk
        const oldPath = path.join(this._conversationsDir, `${oldName}.json`);
        const newPath = path.join(this._conversationsDir, `${sanitizedNewName}.json`);
        try {
            await fs.promises.rename(oldPath, newPath);
        } catch (err) {
            return { success: false, oldName, error: `Failed to rename file on disk: ${err.message}` };
        }

        // Update the in-memory map
        const hm = this._conversations.get(oldName);
        this._conversations.delete(oldName);
        this._conversations.set(sanitizedNewName, hm);

        // Update active conversation pointer if needed
        if (this._activeConversation === oldName) {
            this._activeConversation = sanitizedNewName;
        }

        consoleStyler.log('system', `✏️  Renamed conversation: ${oldName} → ${sanitizedNewName}`);
        return { success: true, oldName, newName: sanitizedNewName };
    }

    /**
     * Clear a conversation's history (reset to system prompt only).
     * @param {string} [name] - Defaults to active conversation
     */
    async clearConversation(name = null) {
        const target = name ? this._sanitizeName(name) : this._activeConversation;
        if (!target) {
            return { cleared: false, name, error: 'Invalid conversation name.' };
        }
        const hm = this._conversations.get(target);
        if (hm) {
            hm.reset();
            // _saveToDisk skips empty histories, so force-write the cleared state
            const history = hm.getHistory();
            if (history.length === 0) {
                const filePath = path.join(this._conversationsDir, `${target}.json`);
                try {
                    await fs.promises.writeFile(filePath, JSON.stringify({
                        name: target,
                        timestamp: new Date().toISOString(),
                        history: []
                    }, null, 2), 'utf8');
                } catch (err) {
                    consoleStyler.log('error', `Failed to persist cleared conversation "${target}": ${err.message}`);
                }
            } else {
                await this._saveToDisk(target);
            }
            return { cleared: true, name: target };
        }
        return { cleared: false, name: target, error: 'Conversation not found.' };
    }

    // ─── Active conversation access ───────────────────────────────────────

    /**
     * Get the HistoryManager for the currently active conversation.
     * @returns {HistoryManager}
     */
    getActiveHistoryManager() {
        let hm = this._conversations.get(this._activeConversation);
        if (!hm) {
            // Defensive: create if missing
            hm = this._createHistoryManager();
            this._conversations.set(this._activeConversation, hm);
        }
        return hm;
    }

    /**
     * Get the HistoryManager for a specific conversation (without switching).
     * @param {string} name
     * @returns {HistoryManager|null}
     */
    getHistoryManager(name) {
        return this._conversations.get(name) || null;
    }

    /**
     * Get the name of the currently active conversation.
     * @returns {string}
     */
    getActiveConversationName() {
        return this._activeConversation;
    }

    /**
     * Check if the given conversation is the default ("chat") conversation.
     * @param {string} [name] - Defaults to active conversation
     * @returns {boolean}
     */
    isDefaultConversation(name = null) {
        const target = name || this._activeConversation;
        return target === DEFAULT_CONVERSATION;
    }

    // ─── Parent-child reporting ───────────────────────────────────────────

    /**
     * Report results from a child conversation back to the parent (default) conversation.
     * Appends a system message to the "chat" conversation summarizing the child's work.
     *
     * @param {string} childName - Name of the child conversation reporting
     * @param {string} summary - Summary of work done / results
     * @param {Object} [metadata] - Optional structured metadata
     * @returns {{reported: boolean, error?: string}}
     */
    async reportToParent(childName, summary, metadata = {}) {
        if (childName === DEFAULT_CONVERSATION) {
            return { reported: false, error: 'The default conversation cannot report to itself.' };
        }

        const parentHm = this._conversations.get(DEFAULT_CONVERSATION);
        if (!parentHm) {
            return { reported: false, error: 'Parent conversation not found.' };
        }

        const reportContent = [
            `📋 **Report from child conversation "${childName}"**`,
            '',
            summary,
            '',
            metadata && Object.keys(metadata).length > 0
                ? `Metadata: ${JSON.stringify(metadata, null, 2)}`
                : '',
            `(Reported at ${new Date().toISOString()})`
        ].filter(Boolean).join('\n');

        parentHm.addMessage('system', reportContent);

        // Save the parent conversation with the new report
        await this._saveToDisk(DEFAULT_CONVERSATION);

        consoleStyler.log('system', `📋 Report from "${childName}" delivered to parent conversation.`);
        return { reported: true };
    }

    // ─── Persistence ──────────────────────────────────────────────────────

    /**
     * Save the currently active conversation to disk.
     */
    async saveActive() {
        await this._saveToDisk(this._activeConversation);
    }

    /**
     * Save all loaded conversations to disk.
     */
    async saveAll() {
        for (const name of this._conversations.keys()) {
            await this._saveToDisk(name);
        }
    }

    /**
     * Load a conversation from disk into the in-memory map.
     * Creates an empty HistoryManager if the file doesn't exist.
     * @param {string} name
     * @returns {boolean} True if loaded from disk, false if created fresh.
     */
    async _loadFromDisk(name) {
        const filePath = path.join(this._conversationsDir, `${name}.json`);

        if (!fs.existsSync(filePath)) {
            // If not already in memory, we can't "load" it
            return this._conversations.has(name);
        }

        try {
            const data = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));

            let hm = this._conversations.get(name);
            if (!hm) {
                hm = this._createHistoryManager();
                this._conversations.set(name, hm);
            }

            if (data.history && Array.isArray(data.history)) {
                hm.setHistory(data.history);
                return true;
            }
        } catch (error) {
            consoleStyler.log('error', `Failed to load conversation "${name}": ${error.message}`);
        }

        return false;
    }

    /**
     * Save a conversation to disk.
     * @param {string} name
     */
    async _saveToDisk(name) {
        const hm = this._conversations.get(name);
        if (!hm) return;

        const history = hm.getHistory();
        // Only save if there's meaningful content
        if (history.length <= 0) return;

        await fs.promises.mkdir(this._conversationsDir, { recursive: true });

        const filePath = path.join(this._conversationsDir, `${name}.json`);
        const data = {
            name,
            timestamp: new Date().toISOString(),
            history
        };

        try {
            await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
        } catch (error) {
            consoleStyler.log('error', `Failed to save conversation "${name}": ${error.message}`);
        }
    }

    // ─── Backward Compatibility ───────────────────────────────────────────

    /**
     * Migrate from the legacy `.conversation.json` file to the new `.conversations/` directory.
     * Called once during initialization.
     */
    async migrateFromLegacy() {
        const legacyPath = path.join(this.workingDir, '.conversation.json');
        if (!fs.existsSync(legacyPath)) return false;

        try {
            const content = await fs.promises.readFile(legacyPath, 'utf8');
            const history = JSON.parse(content);

            if (Array.isArray(history) && history.length > 0) {
                const hm = this._conversations.get(DEFAULT_CONVERSATION);
                if (hm) {
                    hm.setHistory(history);
                    await this._saveToDisk(DEFAULT_CONVERSATION);
                    consoleStyler.log('system', `✓ Migrated legacy .conversation.json → .conversations/${DEFAULT_CONVERSATION}.json`);
                }
            }

            // Rename the legacy file so it's not re-migrated
            const backupPath = path.join(this.workingDir, '.conversation.json.bak');
            await fs.promises.rename(legacyPath, backupPath);
            return true;
        } catch (error) {
            consoleStyler.log('error', `Legacy migration failed: ${error.message}`);
            return false;
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────

    /**
     * Create a fresh HistoryManager with our configured limits.
     * @returns {HistoryManager}
     */
    _createHistoryManager() {
        return new HistoryManager(this.maxTokens, this.contextWindowSize);
    }

    /**
     * Sanitize a conversation name to be filesystem-safe.
     * @param {string} name
     * @returns {string|null}
     */
    _sanitizeName(name) {
        if (!name || typeof name !== 'string') return null;
        const sanitized = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        if (sanitized.length === 0 || sanitized.length > 64) return null;
        return sanitized;
    }
}
