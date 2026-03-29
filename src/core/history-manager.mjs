// History management and token estimation
// Handles context limits and conversation history optimization

import { consoleStyler } from '../ui/console-styler.mjs';
import { config } from '../config.mjs';
import { v4 as uuidv4 } from 'uuid';
import { readJsonFileSync, writeJsonFileSync } from '../lib/json-file-utils.mjs';

// Average characters per token (approximate for English text)
const CHARS_PER_TOKEN = 4;

/**
 * Manages conversation history, token estimation, and context limits.
 */
/**
 * Default interval (ms) between in-progress message autosaves.
 * During streaming, the in-progress message content is updated on every
 * token, but a disk write is only triggered at most once per interval
 * to avoid disk thrashing.
 */
const IN_PROGRESS_SAVE_INTERVAL_MS = 5_000;

export class HistoryManager {
    /**
     * @param {number|null} maxTokens - Maximum allow tokens
     * @param {number|null} contextWindowSize - Total context window size
     */
    constructor(maxTokens = null, contextWindowSize = null) {
        this.maxTokens = maxTokens || config.ai.maxTokens || 4096;
        this.contextWindowSize = contextWindowSize || config.ai.contextWindowSize || 128000;
        
        /** @type {Array<Object>} */
        this.history = [];
        this.systemMessage = null;
        this._checkpoints = new Map();
        this._summarizer = null;
        this._onChange = null;

        /**
         * In-progress message — stores a partial assistant response during
         * streaming so that if the server crashes, the accumulated text can
         * be recovered on next startup.  Stored separately from `this.history`
         * so that providers reading history for LLM context don't see the
         * partial text, but it IS included in the serialised save payload.
         * @type {Object|null}
         */
        this._inProgressMessage = null;

        /** @private Timer handle for debounced in-progress saves */
        this._inProgressTimer = null;

        /**
         * Promise queue for serialising async enforceContextLimits() calls.
         * Each call chains onto this promise so that concurrent addMessage()
         * invocations don't create overlapping summarisation requests.
         * @type {Promise<void>}
         */
        this._limitQueue = Promise.resolve();
    }

    /**
     * Set a callback to fire when history changes (e.g. for autosave)
     * @param {Function} callback
     */
    setOnChange(callback) {
        this._onChange = callback;
    }

    /**
     * Set a function to summarize conversation history
     * @param {Function} summarizerFn - async (text) => string
     */
    setSummarizer(summarizerFn) {
        this._summarizer = summarizerFn;
    }

    /**
     * Initialize history with a system message
     * @param {string} systemPrompt 
     */
    initialize(systemPrompt) {
        this.systemMessage = { 
            id: uuidv4(),
            role: 'system', 
            content: systemPrompt,
            timestamp: new Date().toISOString()
        };
        this.history = [this.systemMessage];
    }

    /**
     * Add a message to history
     * @param {string} role - 'user', 'assistant', 'system', or 'tool'
     * @param {string} content - Message content
     * @param {Array<Object>|null} toolCalls - Optional tool calls
     * @param {string|null} toolCallId - Optional tool call ID
     * @param {string|null} name - Optional name for tool messages
     */
    addMessage(role, content, toolCalls = null, toolCallId = null, name = null) {
        const message = { 
            id: uuidv4(),
            role, 
            content,
            timestamp: new Date().toISOString()
        };
        
        if (toolCalls) {
            message.tool_calls = toolCalls;
        }
        
        if (toolCallId) {
            message.tool_call_id = toolCallId;
        }

        if (name) {
            message.name = name;
        }
        
        this.history.push(message);
        
        // Check context limits and optimize if needed.
        // Enqueue onto the serial promise queue so concurrent calls don't
        // create overlapping summarisation requests (async race fix).
        this._limitQueue = this._limitQueue
            .then(() => this.enforceContextLimits())
            .catch(err => consoleStyler.log('error', `enforceContextLimits failed: ${err.message}`));
        
        if (this._onChange) {
            this._onChange(this).catch?.(() => {}); // fire and forget
        }
    }

    // ─── In-progress message tracking ─────────────────────────────────────
    // These methods allow streaming responses to be periodically flushed to
    // disk so that partial content survives server restarts.

    /**
     * Start tracking an in-progress assistant message.
     * Call this when streaming begins. The message is not added to `history`
     * until {@link commitInProgressMessage} is called, but it IS included in
     * the serialised save payload so disk reflects the partial content.
     *
     * @param {string} [role='assistant'] - Message role
     * @returns {Object} The in-progress message object
     */
    beginInProgressMessage(role = 'assistant') {
        this._inProgressMessage = {
            id: uuidv4(),
            role,
            content: '',
            timestamp: new Date().toISOString(),
            _inProgress: true,
        };
        return this._inProgressMessage;
    }

    /**
     * Append text to the in-progress message and schedule a debounced save.
     * Called on every streaming token/chunk — the save is debounced to
     * `IN_PROGRESS_SAVE_INTERVAL_MS` to avoid disk thrashing.
     *
     * @param {string} delta - Text chunk to append
     */
    appendToInProgressMessage(delta) {
        if (!this._inProgressMessage) return;
        this._inProgressMessage.content += delta;

        // Schedule a debounced save if not already pending
        if (!this._inProgressTimer && this._onChange) {
            this._inProgressTimer = setTimeout(() => {
                this._inProgressTimer = null;
                if (this._onChange) {
                    this._onChange(this).catch?.(() => {});
                }
            }, IN_PROGRESS_SAVE_INTERVAL_MS);
        }
    }

    /**
     * Finalise the in-progress message: promote it into `history` with the
     * definitive content (which may differ slightly from the accumulated
     * chunks due to post-processing), clear the in-progress slot, and fire
     * the onChange callback for a final save.
     *
     * @param {string} [finalContent] - If provided, overrides the accumulated
     *   content. Pass the fully-processed response text here.
     * @param {Object} [extra] - Extra fields to merge (tool_calls, etc.)
     * @returns {Object} The committed message
     */
    commitInProgressMessage(finalContent, extra = {}) {
        if (!this._inProgressMessage) {
            // Fallback: nothing in progress — just addMessage normally
            const content = finalContent || '';
            this.addMessage('assistant', content);
            return this.history[this.history.length - 1];
        }

        // Clear timer
        if (this._inProgressTimer) {
            clearTimeout(this._inProgressTimer);
            this._inProgressTimer = null;
        }

        const msg = this._inProgressMessage;
        this._inProgressMessage = null;

        // Use final content if provided (post-processed), else use accumulated
        if (finalContent !== undefined && finalContent !== null) {
            msg.content = finalContent;
        }
        delete msg._inProgress;

        // Merge any extra fields
        Object.assign(msg, extra);

        // Push into history (use pushMessage so context limits are checked)
        this.pushMessage(msg);

        return msg;
    }

    /**
     * Discard the in-progress message without committing it to history.
     * Call this if streaming is aborted/errored.
     *
     * If `keepPartial` is true, the partial content is committed to history
     * with a `[partial - interrupted]` suffix so it isn't lost.
     *
     * @param {boolean} [keepPartial=true] - Whether to save partial content
     * @returns {Object|null} The discarded/committed message, or null
     */
    discardInProgressMessage(keepPartial = true) {
        if (!this._inProgressMessage) return null;

        if (this._inProgressTimer) {
            clearTimeout(this._inProgressTimer);
            this._inProgressTimer = null;
        }

        const msg = this._inProgressMessage;
        this._inProgressMessage = null;

        if (keepPartial && msg.content && msg.content.trim().length > 0) {
            msg.content += '\n\n*[Response interrupted — partial content preserved]*';
            delete msg._inProgress;
            this.pushMessage(msg);
            return msg;
        }

        // Fire onChange to clear the in-progress from the saved file
        if (this._onChange) {
            this._onChange(this).catch?.(() => {});
        }

        return null;
    }

    /**
     * Get the current in-progress message, if any.
     * Used by serialisation code to include it in the save payload.
     * @returns {Object|null}
     */
    getInProgressMessage() {
        return this._inProgressMessage;
    }

    /**
     * Add a complete message object directly
     * @param {Object} message
     */
    pushMessage(message) {
        if (!message.id) {
            message.id = uuidv4();
        }
        if (!message.timestamp) {
            message.timestamp = new Date().toISOString();
        }
        this.history.push(message);
        // Enqueue context-limit enforcement (same serial queue as addMessage)
        this._limitQueue = this._limitQueue
            .then(() => this.enforceContextLimits())
            .catch(err => consoleStyler.log('error', `enforceContextLimits failed: ${err.message}`));
        if (this._onChange) {
            this._onChange(this).catch?.(() => {});
        }
    }

    /**
     * Delete a specific message by ID
     * @param {string} id
     * @returns {boolean}
     */
    deleteMessage(id) {
        const index = this.history.findIndex(m => m.id === id);
        if (index !== -1) {
            this.history.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * Get the full history
     * @returns {Array<Object>}
     */
    getHistory() {
        return this.history;
    }

    /**
     * Get the last N exchanges (plus system prompt)
     * @param {number} count - Number of exchanges to retrieve
     * @returns {Array<Object>}
     */
    getLastExchanges(count) {
        if (count <= 0) return this.history.slice();
        
        // Always include system prompt (index 0) if it exists
        const systemPrompt = this.history.length > 0 && this.history[0].role === 'system' 
            ? [this.history[0]] 
            : [];
        
        // Start scanning from the end
        let exchangesFound = 0;
        let startIndex = -1;
        
        // Scan backwards to find the start of the Nth exchange from the end
        // An exchange is defined as starting with a 'user' message
        for (let i = this.history.length - 1; i > 0; i--) {
            if (this.history[i].role === 'user') {
                exchangesFound++;
                if (exchangesFound === count) {
                    startIndex = i;
                    break;
                }
            }
        }
        
        if (startIndex === -1) {
            // Requesting more exchanges than exist (or all available), return everything
            return this.history.slice();
        }
        
        // Return system prompt + history from startIndex
        // Ensure we don't duplicate system prompt if startIndex is 0 (though loop stops at 1)
        return [...systemPrompt, ...this.history.slice(startIndex)];
    }

    /**
     * Update the system prompt
     * @param {string} newContent
     */
    updateSystemPrompt(newContent) {
        if (this.history.length > 0 && this.history[0].role === 'system') {
            this.history[0].content = newContent;
            this.systemMessage.content = newContent;
        } else {
            this.systemMessage = { role: 'system', content: newContent };
            this.history.unshift(this.systemMessage);
        }
        if (this._onChange) {
            this._onChange(this).catch?.(() => {});
        }
    }

    /**
     * Delete specified number of exchanges from history (backwards)
     * @param {number} count 
     * @returns {number} Number of exchanges deleted
     */
    deleteHistoryExchanges(count) {
        if (count <= 0) return 0;
        
        let deletedExchanges = 0;
        
        // Work backwards through history, preserving system message at index 0
        for (let i = 0; i < count; i++) {
            // Find the most recent complete exchange (user + assistant + any tools)
            let foundUserMessage = false;
            let messagesToDelete = [];
            
            // Scan backwards from end of history
            for (let j = this.history.length - 1; j > 0; j--) { // Start from index 1 to preserve system message
                const message = this.history[j];
                
                if (message.role === 'user' && !foundUserMessage) {
                    // Found the start of the exchange to delete
                    foundUserMessage = true;
                    messagesToDelete.unshift(j); // Add to beginning since we're going backwards
                } else if (foundUserMessage) {
                    // Part of the exchange (assistant, tool responses)
                    messagesToDelete.unshift(j);
                    
                    // Check if this completes an exchange (hit previous user message or system)
                    if (message.role === 'user' || message.role === 'system') {
                        break;
                    }
                } else if (message.role === 'assistant' || message.role === 'tool') {
                    // Dangling assistant/tool message, include it in deletion
                    messagesToDelete.unshift(j);
                }
            }
            
            // Delete the identified messages
            if (messagesToDelete.length > 0) {
                // Sort in descending order to delete from end first (preserves indices)
                messagesToDelete.sort((a, b) => b - a);
                for (const index of messagesToDelete) {
                    this.history.splice(index, 1);
                }
                deletedExchanges++;
            } else {
                // No more exchanges to delete
                break;
            }
        }
        
        if (deletedExchanges > 0 && this._onChange) {
            this._onChange(this).catch?.(() => {});
        }
        
        return deletedExchanges;
    }

    /**
     * Reset history to just the system prompt
     */
    reset() {
        if (this.systemMessage) {
            this.history = [this.systemMessage];
        } else {
            this.history = [];
        }
        if (this._onChange) {
            this._onChange(this).catch?.(() => {});
        }
    }

    /**
     * Set history to a specific set of messages (e.g. for retries)
     * @param {Array<Object>} messages
     * @param {boolean} [skipOnChange=false] - Whether to skip firing the onChange callback
     */
    setHistory(messages, skipOnChange = false) {
        this.history = [...messages];
        // Ensure system message is tracked
        if (this.history.length > 0 && this.history[0].role === 'system') {
            this.systemMessage = this.history[0];
        }
        if (!skipOnChange && this._onChange) {
            this._onChange(this).catch?.(() => {});
        }
    }

    /**
     * Estimate token count for a string
     * @param {string} text 
     * @returns {number}
     */
    estimateTokens(text) {
        if (!text) return 0;
        return Math.ceil(text.length / CHARS_PER_TOKEN);
    }

    /**
     * Estimate total tokens in history
     * @returns {number}
     */
    getTotalTokens() {
        let total = 0;
        for (const msg of this.history) {
            // Content tokens
            total += this.estimateTokens(msg.content || '');
            
            // Role overhead (approximate)
            total += 4; 
            
            // Tool calls tokens
            if (msg.tool_calls) {
                for (const call of msg.tool_calls) {
                    total += this.estimateTokens(call.function.name);
                    total += this.estimateTokens(call.function.arguments);
                }
            }
        }
        return total;
    }

    /**
     * Enforce context window limits by summarizing or truncating
     */
    async enforceContextLimits() {
        const currentTokens = this.getTotalTokens();
        
        // If we're approaching the limit (90% capacity)
        if (currentTokens > this.contextWindowSize * 0.9) {
            consoleStyler.log('system', `⚠️ Context limit approaching (${currentTokens}/${this.contextWindowSize} tokens). Optimizing history...`);
            
            // Try summarization first if available
            if (this._summarizer) {
                const preserveRecent = 4;
                // Slice: skip system prompt (0), take up to recent
                const messagesToSummarize = this.history.slice(1, -preserveRecent);
                
                if (messagesToSummarize.length > 2) {
                     const summaryPrompt = `Summarize these exchanges into a context memo. PRESERVE: file paths, decisions, errors, progress.\n\n${messagesToSummarize.map(m => `[${m.role}]: ${(m.content || '').substring(0, 500)}`).join('\n')}`;
                     
                     try {
                         const summary = await this._summarizer(summaryPrompt);
                         
                         this.history = [
                             this.history[0], // system prompt
                             { role: 'system', content: `CONVERSATION SUMMARY:\n${summary}` },
                             ...this.history.slice(-preserveRecent)
                         ];
                         consoleStyler.log('system', `✓ Summarized ${messagesToSummarize.length} messages`);
                         return;
                     } catch (e) {
                         consoleStyler.log('error', `Summarization failed: ${e.message}`);
                     }
                }
            }

            // Calculate how many tokens we need to free up (aim for 70% capacity)
            const targetTokens = Math.floor(this.contextWindowSize * 0.7);
            
            // Simple strategy: Remove oldest exchanges (after system prompt)
            
            let attempts = 0;
            const maxAttempts = 20; // Prevent infinite loops
            
            while (this.getTotalTokens() > targetTokens && this.history.length > 2 && attempts < maxAttempts) {
                // Remove the oldest exchange (index 1 is usually the first user message)
                // We use deleteHistoryExchanges logic but target specific indices
                
                // Find first user message after system prompt
                let firstUserIndex = -1;
                for (let i = 1; i < this.history.length; i++) {
                    if (this.history[i].role === 'user') {
                        firstUserIndex = i;
                        break;
                    }
                }
                
                if (firstUserIndex === -1) break; // No user messages found
                
                // Find the next user message to define the exchange boundary
                let nextUserIndex = -1;
                for (let i = firstUserIndex + 1; i < this.history.length; i++) {
                    if (this.history[i].role === 'user') {
                        nextUserIndex = i;
                        break;
                    }
                }
                
                // If no next user message, we're at the last exchange - don't delete recent context unless critical
                if (nextUserIndex === -1 && currentTokens < this.contextWindowSize) {
                    break;
                }
                
                // Delete everything from firstUserIndex up to (but not including) nextUserIndex
                // If nextUserIndex is -1, delete until end (only if we are critically over limit)
                const deleteCount = (nextUserIndex !== -1 ? nextUserIndex : this.history.length) - firstUserIndex;
                
                this.history.splice(firstUserIndex, deleteCount);
                attempts++;
            }
            
            consoleStyler.log('system', `✓ History optimized. New token count: ~${this.getTotalTokens()}`);
        }
    }

    /**
     * Get context statistics
     * @returns {Object}
     */
    getStats() {
        return {
            messageCount: this.history.length,
            estimatedTokens: this.getTotalTokens(),
            contextWindowSize: this.contextWindowSize,
            utilizationPercent: Math.round((this.getTotalTokens() / this.contextWindowSize) * 100)
        };
    }

    /**
     * Save history to a file
     * @param {string} filePath 
     * @returns {Promise<boolean>}
     */
    async save(filePath) {
        try {
            writeJsonFileSync(filePath, {
                timestamp: new Date().toISOString(),
                history: this.history,
                systemMessage: this.systemMessage
            });
            return true;
        } catch (error) {
            consoleStyler.log('error', `Failed to save history: ${error.message}`);
            return false;
        }
    }

    /**
     * Load history from a file
     * @param {string} filePath 
     * @returns {Promise<boolean>}
     */
    async load(filePath) {
        try {
            const data = readJsonFileSync(filePath);
            if (!data) return false;
            
            if (data.history && Array.isArray(data.history)) {
                this.history = data.history.map(msg => {
                    if (!msg.id) msg.id = uuidv4();
                    return msg;
                });
                this.systemMessage = data.systemMessage || this.history.find(msg => msg.role === 'system');
                return true;
            }
            return false;
        } catch (error) {
            consoleStyler.log('error', `Failed to load history: ${error.message}`);
            return false;
        }
    }

    /**
     * Create a deep clone of the history manager
     * @returns {HistoryManager}
     */
    clone() {
        const cloned = new HistoryManager(this.maxTokens, this.contextWindowSize);
        // Deep copy history to prevent reference sharing
        cloned.history = JSON.parse(JSON.stringify(this.history));
        // Re-link system message (it's just the first msg)
        if (cloned.history.length > 0 && cloned.history[0].role === 'system') {
            cloned.systemMessage = cloned.history[0];
        }
        return cloned;
    }

    /**
     * Create a named checkpoint of the current conversation state
     * @param {string} name - Checkpoint name
     */
    checkpoint(name) {
        this._checkpoints.set(name, {
            history: JSON.parse(JSON.stringify(this.history)),
            timestamp: Date.now()
        });
    }

    /**
     * Rollback to a named checkpoint
     * @param {string} name - Checkpoint name
     * @returns {number} Timestamp of the checkpoint
     */
    rollbackTo(name) {
        const cp = this._checkpoints.get(name);
        if (!cp) throw new Error(`Checkpoint '${name}' not found. Available: ${[...this._checkpoints.keys()].join(', ') || 'none'}`);
        this.history = JSON.parse(JSON.stringify(cp.history));
        this.systemMessage = this.history.find(m => m.role === 'system') || null;
        return cp.timestamp;
    }

    /**
     * List all checkpoints
     * @returns {Array<{name: string, timestamp: number, messageCount: number}>}
     */
    listCheckpoints() {
        return [...this._checkpoints.entries()].map(([name, cp]) => ({
            name,
            timestamp: cp.timestamp,
            messageCount: cp.history.length
        }));
    }

    /**
     * Delete a checkpoint
     * @param {string} name
     * @returns {boolean}
     */
    deleteCheckpoint(name) {
        return this._checkpoints.delete(name);
    }
}
