import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * EventicStatePlugin
 * 
 * Provides state persistence, checkpointing, and history management for Eventic agent loops.
 * Maps Eventic's internal context to the legacy `TaskCheckpointManager` and `HistoryManager`.
 */
export class EventicStatePlugin {
    /**
     * @param {Object} options
     * @param {import('./history-manager.mjs').HistoryManager} options.historyManager
     * @param {import('./conversation-manager.mjs').ConversationManager} options.conversationManager
     * @param {import('./task-checkpoint-manager.mjs').TaskCheckpointManager} options.taskCheckpointManager
     */
    constructor(options = {}) {
        this.historyManager = options.historyManager;
        this.conversationManager = options.conversationManager;
        this.taskCheckpointManager = options.taskCheckpointManager;
        this.type = 'state';
    }

    install(eventic) {
        // Expose state management functions on the Eventic context
        eventic.context.stateManager = this;
    }

    /**
     * Load history from HistoryManager into Eventic's AI provider
     * @param {import('./eventic.mjs').Eventic} engine
     */
    loadHistory(engine) {
        if (!this.historyManager || !engine.ai) {
            return;
        }
        
        const history = this.historyManager.getHistory();
        if (history && history.length > 0) {
            // Deep clone to avoid reference issues
            engine.ai.conversationHistory = JSON.parse(JSON.stringify(history));
        }
    }

    /**
     * Sync Eventic's AI conversation history to the HistoryManager and save to disk
     * @param {import('./eventic.mjs').Eventic} engine
     */
    async syncHistory(engine) {
        if (!this.historyManager || !engine.ai || !engine.ai.conversationHistory) {
            return;
        }
        
        // Deep clone or set history to keep HistoryManager up to date
        this.historyManager.setHistory(engine.ai.conversationHistory);
        
        // Save conversation immediately (per user requirement)
        if (this.conversationManager) {
            try {
                await this.conversationManager.saveActive();
            } catch (err) {
                consoleStyler.log('warning', `[EventicStatePlugin] Failed to save conversation: ${err.message}`);
            }
        }
        
        // Enforce context limits so we don't overflow the max tokens
        try {
            await this.historyManager.enforceContextLimits();
        } catch (err) {
            consoleStyler.log('warning', `[EventicStatePlugin] Failed to enforce context limits: ${err.message}`);
        }
    }

    /**
     * Create a checkpoint for the current request/turn
     * @param {Object} ctx - Eventic context
     * @param {import('./eventic.mjs').Eventic} engine - Eventic engine
     * @param {Object} additionalData - Extra metadata to save
     */
    async checkpoint(ctx, engine, additionalData = {}) {
        if (!this.taskCheckpointManager || !this.taskCheckpointManager.config.enabled) {
            return false;
        }

        // Map Eventic state to a RequestContext-like structure for the CheckpointManager
        const requestCtx = {
            id: ctx.requestId || `evt-${Date.now()}`,
            turnNumber: ctx.turnNumber || 0,
            toolCallCount: ctx.toolCallCount || 0,
            startedAt: ctx.startedAt || new Date().toISOString(),
            originalInput: ctx.originalInput || '',
            model: engine.ai ? engine.ai.model : 'unknown',
            dryRun: false,
            isRetry: false,
            retryCount: ctx.retryCount || 0,
            maxTurns: ctx.maxTurns || 10,
            chimeInQueue: [],
            metadata: { 
                status: ctx.status,
                currentAction: ctx.currentAction,
                ...additionalData 
            },
            triageResult: null
        };

        // Mock ServiceRegistry for historyManager access in CheckpointManager
        const services = {
            get: (name) => {
                if (name === 'historyManager') return this.historyManager;
                return null;
            },
            optional: (name) => {
                if (name === 'conversationManager') {
                    return this.conversationManager;
                }
                return null;
            }
        };

        try {
            await this.taskCheckpointManager.checkpointRequest(requestCtx, services);
            return true;
        } catch (err) {
            consoleStyler.log('error', `[EventicStatePlugin] Failed to save checkpoint: ${err.message}`);
            return false;
        }
    }

    /**
     * Mark the current request as completed and clean up its checkpoint
     * @param {Object} ctx 
     */
    async complete(ctx) {
        if (this.taskCheckpointManager && ctx.requestId) {
            await this.taskCheckpointManager.completeRequest(ctx.requestId);
        }
    }
}
