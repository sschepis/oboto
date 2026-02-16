// History management and token estimation
// Handles context limits and conversation history optimization

import { consoleStyler } from '../ui/console-styler.mjs';
import { config } from '../config.mjs';

// Average characters per token (approximate for English text)
const CHARS_PER_TOKEN = 4;

/**
 * Manages conversation history, token estimation, and context limits.
 */
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
    }

    /**
     * Initialize history with a system message
     * @param {string} systemPrompt 
     */
    initialize(systemPrompt) {
        this.systemMessage = { 
            role: 'system', 
            content: systemPrompt 
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
        const message = { role, content };
        
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
        
        // Check context limits and optimize if needed
        this.enforceContextLimits();
    }

    /**
     * Add a complete message object directly
     * @param {Object} message 
     */
    pushMessage(message) {
        this.history.push(message);
        this.enforceContextLimits();
    }

    /**
     * Get the full history
     * @returns {Array<Object>}
     */
    getHistory() {
        return this.history;
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
    }

    /**
     * Set history to a specific set of messages (e.g. for retries)
     * @param {Array<Object>} messages 
     */
    setHistory(messages) {
        this.history = [...messages];
        // Ensure system message is tracked
        if (this.history.length > 0 && this.history[0].role === 'system') {
            this.systemMessage = this.history[0];
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
    enforceContextLimits() {
        const currentTokens = this.getTotalTokens();
        
        // If we're approaching the limit (90% capacity)
        if (currentTokens > this.contextWindowSize * 0.9) {
            consoleStyler.log('system', `⚠️ Context limit approaching (${currentTokens}/${this.contextWindowSize} tokens). Optimizing history...`);
            
            // Calculate how many tokens we need to free up (aim for 70% capacity)
            const targetTokens = Math.floor(this.contextWindowSize * 0.7);
            
            // Simple strategy: Remove oldest exchanges (after system prompt)
            // A smarter strategy would be to summarize, but that requires an LLM call
            
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
            const fs = await import('fs');
            const data = {
                timestamp: new Date().toISOString(),
                history: this.history,
                systemMessage: this.systemMessage
            };
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
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
            const fs = await import('fs');
            if (!fs.existsSync(filePath)) {
                return false;
            }
            
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            
            if (data.history && Array.isArray(data.history)) {
                this.history = data.history;
                this.systemMessage = data.systemMessage || this.history.find(msg => msg.role === 'system');
                return true;
            }
            return false;
        } catch (error) {
            consoleStyler.log('error', `Failed to load history: ${error.message}`);
            return false;
        }
    }
}
