/**
 * TaskCheckpointManager — Central coordinator for task state checkpointing
 * and crash recovery.
 * 
 * Responsibilities:
 * - Listen to task lifecycle events and trigger checkpoints
 * - Periodically checkpoint long-running tasks
 * - Recover tasks from checkpoints on startup
 * - Coordinate with TaskManager for task restoration
 */

import { CheckpointStore } from './checkpoint-store.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * @typedef {Object} CheckpointConfig
 * @property {boolean} [enabled=true] - Enable checkpointing
 * @property {number} [intervalMs=10000] - Checkpoint interval in ms
 * @property {number} [maxCheckpointAge=86400000] - Max age before cleanup (24h default)
 * @property {boolean} [recoverOnStartup=true] - Attempt recovery on startup
 * @property {boolean} [notifyOnRecovery=true] - Emit events when recovering tasks
 */

const DEFAULT_CONFIG = {
    enabled: true,
    intervalMs: 10000,              // Checkpoint every 10 seconds
    maxCheckpointAge: 24 * 60 * 60 * 1000,  // 24 hours
    recoverOnStartup: false,
    notifyOnRecovery: true
};

export class TaskCheckpointManager {
    /**
     * @param {Object} deps
     * @param {import('../lib/event-bus.mjs').AiManEventBus} deps.eventBus
     * @param {import('./task-manager.mjs').TaskManager} deps.taskManager
     * @param {string} deps.workingDir
     * @param {Function} [deps.aiAssistantClass] - Constructor for spawning recovered tasks
     * @param {CheckpointConfig} [config]
     */
    constructor({ eventBus, taskManager, workingDir, aiAssistantClass }, config = {}) {
        this.eventBus = eventBus;
        this.taskManager = taskManager;
        this.workingDir = workingDir;
        this.aiAssistantClass = aiAssistantClass;
        this.config = { ...DEFAULT_CONFIG, ...config };
        
        this.store = new CheckpointStore(workingDir, {
            maxCheckpointAge: this.config.maxCheckpointAge
        });
        
        // Track active checkpoint intervals per task
        this._checkpointIntervals = new Map();
        
        // Track tasks pending recovery
        this._pendingRecovery = new Map();
        
        // Recovery stats
        this._recoveryStats = {
            lastRecoveryAt: null,
            tasksRecovered: 0,
            tasksFailed: 0
        };
        
        this._initialized = false;
    }

    /**
     * Initialize the checkpoint manager.
     * Should be called on server startup BEFORE accepting new requests.
     */
    async initialize() {
        if (this._initialized) return;
        
        if (!this.config.enabled) {
            consoleStyler.log('system', '⚠️ Task checkpointing is disabled');
            this._initialized = true;
            return;
        }
        
        consoleStyler.log('system', '💾 Initializing task checkpoint manager...');
        
        // Replay any incomplete WAL operations
        const walResult = await this.store.replayWAL();
        if (walResult.replayed > 0) {
            consoleStyler.log('system', `  ↳ Replayed ${walResult.replayed} WAL operations`);
        }
        
        // Clean up old checkpoints
        await this.store.cleanupOldCheckpoints();
        
        // Set up event listeners
        this._setupEventListeners();
        
        // Attempt crash recovery if enabled
        if (this.config.recoverOnStartup) {
            await this.recoverFromCrash();
        }
        
        this._initialized = true;
        consoleStyler.log('system', '✓ Task checkpoint manager ready');
    }

    /**
     * Set up event listeners for task lifecycle events.
     */
    _setupEventListeners() {
        if (!this.eventBus) return;
        
        // Task started — begin periodic checkpointing
        this.eventBus.on('task:started', (data) => {
            if (!this.config.enabled) return;
            this._startPeriodicCheckpoint(data.taskId);
        });
        
        // Task completed — final checkpoint and cleanup
        this.eventBus.on('task:completed', async (data) => {
            if (!this.config.enabled) return;
            await this._onTaskCompleted(data.taskId);
        });
        
        // Task failed — checkpoint final state for debugging
        this.eventBus.on('task:failed', async (data) => {
            if (!this.config.enabled) return;
            await this._onTaskFailed(data.taskId);
        });
        
        // Task cancelled — cleanup checkpoint
        this.eventBus.on('task:cancelled', async (data) => {
            if (!this.config.enabled) return;
            await this._onTaskCancelled(data.taskId);
        });
        
        // Manual checkpoint request
        this.eventBus.on('task:checkpoint-request', async (data) => {
            await this.checkpointTask(data.taskId);
        });
    }

    /**
     * Start periodic checkpointing for a task.
     * @param {string} taskId 
     */
    _startPeriodicCheckpoint(taskId) {
        // Clear any existing interval
        this._stopPeriodicCheckpoint(taskId);
        
        // Set up new interval
        const interval = setInterval(async () => {
            const task = this.taskManager.getTask(taskId);
            if (!task || task.status !== 'running') {
                this._stopPeriodicCheckpoint(taskId);
                return;
            }
            
            await this.checkpointTask(taskId);
        }, this.config.intervalMs);
        
        this._checkpointIntervals.set(taskId, interval);
        
        // Take immediate first checkpoint
        this.checkpointTask(taskId);
    }

    /**
     * Stop periodic checkpointing for a task.
     * @param {string} taskId 
     */
    _stopPeriodicCheckpoint(taskId) {
        const interval = this._checkpointIntervals.get(taskId);
        if (interval) {
            clearInterval(interval);
            this._checkpointIntervals.delete(taskId);
        }
    }

    // ─── Task Lifecycle Handlers ───────────────────────────────────────

    /**
     * Handle task completion.
     * @param {string} taskId 
     */
    async _onTaskCompleted(taskId) {
        this._stopPeriodicCheckpoint(taskId);
        
        // Mark as completed (removes checkpoint)
        await this.store.markCompleted(taskId, false);
        
        consoleStyler.log('checkpoint', `✓ Task ${taskId} completed, checkpoint cleared`);
    }

    /**
     * Handle task failure.
     * @param {string} taskId 
     */
    async _onTaskFailed(taskId) {
        this._stopPeriodicCheckpoint(taskId);
        
        // Take final checkpoint for debugging, but mark as failed
        await this.checkpointTask(taskId);
        await this.store.markCompleted(taskId, true); // Keep for debugging
        
        consoleStyler.log('checkpoint', `✗ Task ${taskId} failed, checkpoint preserved for debugging`);
    }

    /**
     * Handle task cancellation.
     * @param {string} taskId 
     */
    async _onTaskCancelled(taskId) {
        this._stopPeriodicCheckpoint(taskId);
        
        // Remove checkpoint for cancelled tasks
        await this.store.deleteCheckpoint(taskId);
        
        consoleStyler.log('checkpoint', `⊘ Task ${taskId} cancelled, checkpoint cleared`);
    }

    // ─── Checkpoint Operations ─────────────────────────────────────────

    /**
     * Create a checkpoint for a task.
     * @param {string} taskId 
     * @returns {Promise<boolean>}
     */
    async checkpointTask(taskId) {
        const task = this.taskManager.getTask(taskId);
        if (!task) {
            consoleStyler.log('warning', `Cannot checkpoint unknown task: ${taskId}`);
            return false;
        }
        
        const checkpoint = this._serializeTask(task);
        const success = await this.store.saveCheckpoint(taskId, checkpoint);
        
        if (success) {
            consoleStyler.log('checkpoint', `💾 Checkpointed task ${taskId} (turn ${checkpoint.turnNumber || 0})`);
        }
        
        return success;
    }

    /**
     * Serialize a task to a checkpoint format.
     * @param {Object} task - TaskManager task record
     * @returns {Object}
     */
    _serializeTask(task) {
        return {
            // Identity
            taskId: task.id,
            type: task.metadata?.type || 'background',
            
            // Execution State
            status: task.status,
            progress: task.progress || 0,
            turnNumber: task.metadata?.turnNumber || 0,
            
            // Timing
            createdAt: task.createdAt,
            startedAt: task.startedAt,
            lastCheckpointAt: new Date().toISOString(),
            
            // Task Configuration
            description: task.description,
            query: task.query,
            
            // Context
            workingDir: this.workingDir,
            
            // Output Log (for replay/debugging)
            outputLog: task.outputLog || [],
            
            // Metadata
            metadata: task.metadata || {},
            
            // We can't serialize the actual assistant state or conversation history
            // from TaskManager since it doesn't track that. For full restoration,
            // we'd need to integrate with ConversationManager.
            // This provides "best effort" recovery - restart the task from the beginning
            // but with context about what was happening.
            recoveryStrategy: 'restart'
        };
    }

    /**
     * Checkpoint a pipeline request context.
     * Called from agent-loop stage.
     * 
     * @param {import('./request-context.mjs').RequestContext} ctx 
     * @param {import('./service-registry.mjs').ServiceRegistry} services 
     */
    async checkpointRequest(ctx, services) {
        if (!this.config.enabled) return;
        
        const historyManager = services.get('historyManager');
        const conversationName = services.optional('conversationManager')?.getActiveConversationName() || 'default';
        
        const checkpoint = {
            // Identity
            taskId: `request-${ctx.id}`,
            type: 'request',
            
            // Execution State
            status: 'running',
            turnNumber: ctx.turnNumber,
            toolCallCount: ctx.toolCallCount,
            
            // Timing
            startedAt: new Date(ctx.startedAt).toISOString(),
            lastCheckpointAt: new Date().toISOString(),
            
            // Context
            workingDir: this.workingDir,
            conversationName,
            
            // Request Configuration
            userInput: ctx.originalInput,
            model: ctx.model,
            dryRun: ctx.dryRun,
            isRetry: ctx.isRetry,
            retryCount: ctx.retryCount,
            maxTurns: ctx.maxTurns,
            
            // Queue
            chimeInQueue: ctx.chimeInQueue || [],
            
            // Metadata
            metadata: ctx.metadata || {},
            triageResult: ctx.triageResult,
            
            // History snapshot (critical for resumption)
            historySnapshot: historyManager ? historyManager.getHistory() : [],
            
            // Recovery strategy
            recoveryStrategy: 'resume'
        };
        
        const success = await this.store.saveCheckpoint(checkpoint.taskId, checkpoint);
        
        if (success) {
            consoleStyler.log('checkpoint', `💾 Checkpointed request ${ctx.id} (turn ${ctx.turnNumber})`);
        }
        
        return success;
    }

    /**
     * Mark a request as completed (removes checkpoint).
     * @param {string} requestId 
     */
    async completeRequest(requestId) {
        if (!this.config.enabled) return;
        await this.store.markCompleted(`request-${requestId}`, false);
    }

    // ─── Recovery Operations ───────────────────────────────────────────

    /**
     * Attempt to recover tasks from a previous crash.
     * @returns {Promise<{recovered: number, failed: number, pending: Array}>}
     */
    async recoverFromCrash() {
        consoleStyler.log('system', '🔍 Checking for recoverable tasks...');
        
        const recoverable = await this.store.listRecoverableCheckpoints();
        
        if (recoverable.length === 0) {
            consoleStyler.log('system', '  ↳ No tasks to recover');
            return { recovered: 0, failed: 0, pending: [] };
        }
        
        consoleStyler.log('system', `  ↳ Found ${recoverable.length} recoverable task(s)`);
        
        const results = {
            recovered: 0,
            failed: 0,
            pending: []
        };
        
        for (const { taskId, checkpoint } of recoverable) {
            try {
                const result = await this._recoverTask(taskId, checkpoint);
                
                if (result.status === 'recovered') {
                    results.recovered++;
                } else if (result.status === 'pending') {
                    results.pending.push({ taskId, checkpoint, ...result });
                } else {
                    results.failed++;
                }
            } catch (error) {
                consoleStyler.log('error', `  ✗ Failed to recover ${taskId}: ${error.message}`);
                results.failed++;
            }
        }
        
        this._recoveryStats.lastRecoveryAt = new Date().toISOString();
        this._recoveryStats.tasksRecovered = results.recovered;
        this._recoveryStats.tasksFailed = results.failed;
        
        if (results.recovered > 0) {
            consoleStyler.log('system', `✓ Recovered ${results.recovered} task(s)`);
        }
        
        if (results.pending.length > 0) {
            consoleStyler.log('system', `⏳ ${results.pending.length} task(s) pending user action`);
            
            // Emit recovery event for UI notification
            if (this.config.notifyOnRecovery && this.eventBus) {
                this.eventBus.emitTyped('checkpoint:recovery-pending', {
                    tasks: results.pending.map(p => ({
                        taskId: p.taskId,
                        type: p.checkpoint.type,
                        description: p.checkpoint.description,
                        turnNumber: p.checkpoint.turnNumber,
                        lastCheckpointAt: p.checkpoint.lastCheckpointAt
                    }))
                });
            }
        }
        
        return results;
    }

    /**
     * Attempt to recover a single task from checkpoint.
     * @param {string} taskId 
     * @param {Object} checkpoint 
     * @returns {Promise<{status: string, newTaskId?: string, reason?: string}>}
     */
    async _recoverTask(taskId, checkpoint) {
        const type = checkpoint.type || 'background';
        
        // Request-type checkpoints can't be auto-recovered (user may have left)
        if (type === 'request') {
            // Store as pending for user action
            this._pendingRecovery.set(taskId, checkpoint);
            await this.store.markRecovered(taskId);
            
            return { 
                status: 'pending', 
                reason: 'Request requires user confirmation to resume' 
            };
        }
        
        // Background tasks - attempt automatic recovery
        if (type === 'background' || type === 'agent-loop' || type === 'recurring') {
            if (!this.aiAssistantClass) {
                return { 
                    status: 'failed', 
                    reason: 'No AI assistant class available for task recovery' 
                };
            }
            
            // Build recovery context
            const recoveryContext = this._buildRecoveryContext(checkpoint);
            
            // Spawn a new task with recovery context
            const newTask = this.taskManager.spawnTask(
                recoveryContext.query,
                `[RECOVERED] ${checkpoint.description}`,
                this.aiAssistantClass,
                {
                    workingDir: checkpoint.workingDir || this.workingDir,
                    metadata: {
                        ...checkpoint.metadata,
                        recoveredFrom: taskId,
                        recoveredAt: new Date().toISOString(),
                        originalQuery: checkpoint.query
                    }
                }
            );
            
            // Mark original checkpoint as recovered
            await this.store.markRecovered(taskId);
            
            consoleStyler.log('system', `  ✓ Recovered task ${taskId} → ${newTask.id}`);
            
            return { status: 'recovered', newTaskId: newTask.id };
        }
        
        return { status: 'failed', reason: `Unknown task type: ${type}` };
    }

    /**
     * Build recovery context/prompt for a checkpointed task.
     * @param {Object} checkpoint 
     * @returns {Object}
     */
    _buildRecoveryContext(checkpoint) {
        const outputSummary = (checkpoint.outputLog || [])
            .slice(-10)
            .join('\n');
        
        const recoveryPrompt = `[TASK RECOVERY]
This task was interrupted due to a server restart. Please continue from where you left off.

Original Task: ${checkpoint.description}
Original Query: ${checkpoint.query}

Progress at interruption:
- Turn: ${checkpoint.turnNumber || 0}
- Progress: ${checkpoint.progress || 0}%
- Last checkpoint: ${checkpoint.lastCheckpointAt}

Recent output (last 10 lines):
${outputSummary || '(no output captured)'}

Please assess the situation and continue the task. If you cannot determine the previous state, start fresh but acknowledge the recovery.`;
        
        return {
            query: recoveryPrompt,
            originalQuery: checkpoint.query
        };
    }

    // ─── Manual Recovery API ───────────────────────────────────────────

    /**
     * Get list of tasks pending user recovery action.
     * @returns {Array<{taskId: string, checkpoint: Object}>}
     */
    getPendingRecovery() {
        return Array.from(this._pendingRecovery.entries()).map(([taskId, checkpoint]) => ({
            taskId,
            type: checkpoint.type,
            description: checkpoint.description || checkpoint.userInput?.substring(0, 100),
            turnNumber: checkpoint.turnNumber,
            lastCheckpointAt: checkpoint.lastCheckpointAt,
            historyLength: checkpoint.historySnapshot?.length || 0
        }));
    }

    /**
     * Resume a pending recovery request.
     * This is called when the user confirms they want to continue a recovered request.
     * 
     * @param {string} taskId 
     * @param {import('./eventic-facade.mjs').EventicFacade} assistant 
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async resumePendingRecovery(taskId, assistant) {
        const checkpoint = this._pendingRecovery.get(taskId);
        if (!checkpoint) {
            return { success: false, error: `No pending recovery for ${taskId}` };
        }
        
        try {
            // Restore conversation history
            if (checkpoint.historySnapshot && checkpoint.historySnapshot.length > 0) {
                assistant.historyManager.setHistory(checkpoint.historySnapshot);
            }
            
            // Inject recovery message
            const recoveryMessage = `[System: Resuming from checkpoint. Turn ${checkpoint.turnNumber}, ${checkpoint.historySnapshot?.length || 0} messages recovered.]`;
            assistant.historyManager.addMessage('system', recoveryMessage);
            
            // Clear from pending
            this._pendingRecovery.delete(taskId);
            await this.store.markRecovered(taskId);
            
            // Emit recovery event
            if (this.eventBus) {
                this.eventBus.emitTyped('checkpoint:resumed', {
                    taskId,
                    turnNumber: checkpoint.turnNumber
                });
            }
            
            consoleStyler.log('system', `✓ Resumed request from checkpoint: ${taskId}`);
            
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Discard a pending recovery (user chooses not to resume).
     * @param {string} taskId 
     */
    async discardPendingRecovery(taskId) {
        this._pendingRecovery.delete(taskId);
        await this.store.deleteCheckpoint(taskId);
        
        consoleStyler.log('system', `⊘ Discarded pending recovery: ${taskId}`);
    }

    // ─── Admin / Debug ─────────────────────────────────────────────────

    /**
     * Get recovery statistics.
     */
    getStats() {
        return {
            enabled: this.config.enabled,
            intervalMs: this.config.intervalMs,
            activeCheckpoints: this._checkpointIntervals.size,
            pendingRecovery: this._pendingRecovery.size,
            ...this._recoveryStats
        };
    }

    /**
     * List all checkpoints (for admin/debug).
     */
    async listAllCheckpoints() {
        return await this.store.listAllCheckpoints();
    }

    /**
     * Load a specific checkpoint (for inspection).
     * @param {string} taskId 
     */
    async inspectCheckpoint(taskId) {
        return await this.store.loadCheckpoint(taskId);
    }

    /**
     * Force cleanup of old checkpoints.
     */
    async forceCleanup() {
        return await this.store.cleanupOldCheckpoints();
    }

    /**
     * Switch to a new workspace.
     * @param {string} newWorkingDir 
     */
    async switchWorkspace(newWorkingDir) {
        // Stop all active checkpoint intervals
        for (const [taskId] of this._checkpointIntervals) {
            this._stopPeriodicCheckpoint(taskId);
        }
        
        // Clear pending recovery from old workspace
        this._pendingRecovery.clear();
        
        // Update working directory and store
        this.workingDir = newWorkingDir;
        this.store.switchWorkspace(newWorkingDir);
        
        // Attempt recovery in new workspace
        if (this.config.recoverOnStartup) {
            await this.recoverFromCrash();
        }
    }

    /**
     * Shutdown the checkpoint manager.
     */
    async shutdown() {
        // Stop all periodic checkpoints
        for (const [taskId] of this._checkpointIntervals) {
            this._stopPeriodicCheckpoint(taskId);
        }
        
        // Clear WAL
        await this.store._clearWAL();
        
        consoleStyler.log('system', '💾 Task checkpoint manager shut down');
    }
}
