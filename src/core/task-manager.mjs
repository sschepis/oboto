import { AiManEventBus } from '../lib/event-bus.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * Manages background task lifecycle, tracking, and completion reporting.
 */
export class TaskManager {
    constructor(eventBus, maxConcurrent = 3) {
        this.tasks = new Map(); // taskId -> TaskRecord
        this.eventBus = eventBus || new AiManEventBus();
        this.maxConcurrent = maxConcurrent;
    }

    /**
     * Spawns a background task.
     * @param {string} query - The prompt/instructions for the task
     * @param {string} description - Human-readable description
     * @param {Class} aiAssistantClass - The MiniAIAssistant class constructor
     * @param {Object} options - Additional options (context, etc.)
     * @returns {Object} The created task record
     */
    spawnTask(query, description, aiAssistantClass, options = {}) {
        const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
        
        const taskRecord = {
            id: taskId,
            description,
            query,
            status: 'queued',
            createdAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
            result: null,
            error: null,
            read: false,
            
            // New fields
            outputLog: [],
            abortController: new AbortController(),
            progress: 0,
            metadata: options.metadata || { type: 'one-shot' }
        };

        this.tasks.set(taskId, taskRecord);
        this.eventBus.emitTyped('task:spawned', { 
            taskId, 
            description, 
            status: 'queued',
            createdAt: taskRecord.createdAt,
            metadata: taskRecord.metadata 
        });
        consoleStyler.log('system', `🚀 Spawned background task: ${description} (${taskId})`);

        // Start execution (async)
        // In a real system with concurrency limits, we might queue this instead
        this._executeTask(taskId, aiAssistantClass, query, options);

        return taskRecord;
    }

    /**
     * Cancel a running task.
     * @param {string} taskId 
     * @returns {boolean} True if task was running and cancelled
     */
    cancelTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) return false;

        if (task.status === 'running' || task.status === 'queued') {
            task.status = 'cancelled';
            task.completedAt = new Date().toISOString();
            task.abortController.abort();
            
            this.eventBus.emitTyped('task:cancelled', { taskId });
            consoleStyler.log('system', `🛑 Cancelled background task: ${task.description} (${taskId})`);
            return true;
        }
        return false;
    }

    /**
     * Append a line to the task's output log.
     * @param {string} taskId 
     * @param {string} line 
     */
    appendOutput(taskId, line) {
        const task = this.tasks.get(taskId);
        if (!task) return;

        // Add timestamp if not present (simple check)
        const timestampedLine = `[${new Date().toLocaleTimeString()}] ${line}`;
        task.outputLog.push(timestampedLine);
        
        // Keep log size reasonable (e.g., last 1000 lines)
        if (task.outputLog.length > 1000) {
            task.outputLog.shift();
        }

        this.eventBus.emitTyped('task:output', { 
            taskId, 
            line: timestampedLine, 
            index: task.outputLog.length - 1 
        });
    }

    /**
     * Update task progress.
     * @param {string} taskId 
     * @param {number} progress (0-100)
     */
    updateProgress(taskId, progress) {
        const task = this.tasks.get(taskId);
        if (!task) return;

        task.progress = Math.min(100, Math.max(0, progress));
        this.eventBus.emitTyped('task:progress', { 
            taskId, 
            progress: task.progress,
            status: task.status
        });
    }

    /**
     * Get task output log, optionally starting from an index.
     * @param {string} taskId 
     * @param {number} sinceIndex 
     * @returns {string[]}
     */
    getTaskOutput(taskId, sinceIndex = 0) {
        const task = this.tasks.get(taskId);
        if (!task) return [];
        return task.outputLog.slice(sinceIndex);
    }

    /**
     * Internal execution method.
     */
    async _executeTask(taskId, aiAssistantClass, query, options) {
        const task = this.tasks.get(taskId);
        if (!task) return;

        if (task.status === 'cancelled') return;

        task.status = 'running';
        task.startedAt = new Date().toISOString();
        this.eventBus.emitTyped('task:started', { taskId });

        try {
            const workingDir = options.workingDir || process.cwd();
            
            const assistant = new aiAssistantClass(workingDir);
            
            // Hook up assistant events to capture output/progress
            // We need a way to listen to the assistant's internal events
            // Assuming the assistant uses the same event bus or we can inject one
            // Since we can't easily modify the assistant instance to use a different bus
            // without changing its constructor signature in a way that might break things,
            // we'll rely on the global event bus but filter by some context if possible.
            // OR, we can pass a 'logger' or 'reporter' in options if supported.
            
            // Looking at the codebase, the assistant emits to its own event bus.
            // But we don't have access to the assistant instance's internal bus easily unless it exposes it.
            // Wait, the assistant constructor takes `options` which can include `taskManager`.
            // If we pass `this` (TaskManager) to the assistant, the assistant *could* report back.
            // But for now, let's assume standard execution.
            
            // We can try to monkey-patch consoleStyler or inject a custom event bus if supported.
            // The `MiniAIAssistant` likely uses `this.eventBus`.
            
            // Ideally, we'd do:
            // assistant.eventBus.on('server:log', (data) => this.appendOutput(taskId, data.message));
            // assistant.eventBus.on('server:progress', (data) => this.updateProgress(taskId, data.progress));
            
            // Let's check how the assistant is initialized.
            // It seems it creates its own internal bus if not provided, or uses the one passed.
            // We can try to pass a local bus that proxies to us.
            
            const localBus = new AiManEventBus();
            localBus.on('server:log', (data) => {
                 // Format: { message: string, level: string }
                 const msg = typeof data === 'string' ? data : (data.message || JSON.stringify(data));
                 this.appendOutput(taskId, msg);
            });
            localBus.on('server:progress', (data) => {
                // Format: { progress: number, status: string }
                if (data.progress !== undefined) {
                    this.updateProgress(taskId, data.progress);
                }
            });

            // If the assistant class supports injecting an event bus via options or constructor, we should use that.
            // But `aiAssistantClass` constructor signature is `(workingDir)`.
            // However, `initializeCustomTools` might be an entry point, or we can look at `options`.
            // The `aiAssistantClass` seems to be `MiniAIAssistant` which likely extends `AIAssistant`.
            
            // Let's assume for now we can't easily hook into the inner events without modifying `MiniAIAssistant`.
            // But wait, `_executeTask` in the original code didn't pass an event bus.
            // It just ran `assistant.run()`.
            
            // If we want detailed logs, we might need to rely on the assistant using `consoleStyler` 
            // and maybe we can intercept that? No, that's global.
            
            // Let's proceed with just running it, but wrap it in our AbortSignal check if possible.
            // `assistant.run` usually doesn't take an abort signal in this codebase yet.
            // We'll have to rely on the fact that if we cancel, we just ignore the result, 
            // unless we can update the assistant to support cancellation.
            
            await assistant.initializeCustomTools();
            
            // Inject ourselves into the assistant if possible for reporting
            if (assistant.setTaskManager) {
                assistant.setTaskManager(this);
            }
            
            // Add context if provided
            let finalQuery = query;
            if (options.context) {
                finalQuery = `CONTEXT: ${options.context}\n\nTASK: ${query}`;
            }

            // Run the task
            // We race the run against the abort signal
            const runPromise = assistant.run(finalQuery);
            
            const abortPromise = new Promise((_, reject) => {
                task.abortController.signal.addEventListener('abort', () => {
                    reject(new Error('Task cancelled'));
                });
            });

            const result = await Promise.race([runPromise, abortPromise]);

            task.status = 'completed';
            task.completedAt = new Date().toISOString();
            task.result = result;
            task.progress = 100;
            
            this.eventBus.emitTyped('task:completed', { 
                taskId, 
                description: task.description, 
                result: result.substring(0, 100) + '...' 
            });
            
            consoleStyler.log('system', `🔔 Background task completed: ${task.description} (${taskId})`);

        } catch (error) {
            if (task.status === 'cancelled') {
                // Already handled cancellation logic in cancelTask
                return;
            }

            task.status = 'failed';
            task.completedAt = new Date().toISOString();
            task.error = error.message;
            
            this.eventBus.emitTyped('task:failed', { 
                taskId, 
                description: task.description, 
                error: error.message 
            });
            
            consoleStyler.log('error', `Background task failed: ${task.description} (${taskId}) - ${error.message}`);
        }
    }

    /**
     * Get a task by ID.
     * @param {string} taskId 
     * @returns {Object|null}
     */
    getTask(taskId) {
        return this.tasks.get(taskId) || null;
    }

    /**
     * List all tasks, optionally filtered by status.
     * @param {string} statusFilter - 'all', 'running', 'completed', 'failed', 'cancelled', 'queued'
     * @returns {Array}
     */
    listTasks(statusFilter = 'all') {
        const allTasks = Array.from(this.tasks.values());
        if (!statusFilter || statusFilter === 'all') {
            return allTasks;
        }
        return allTasks.filter(t => t.status === statusFilter);
    }

    /**
     * Wait for a specific task to complete.
     * @param {string} taskId 
     * @param {number} timeoutSeconds 
     * @returns {Promise<Object>} The task record
     */
    async waitForTask(taskId, timeoutSeconds = 300) {
        const task = this.getTask(taskId);
        if (!task) throw new Error(`Task ${taskId} not found`);

        if (['completed', 'failed', 'cancelled'].includes(task.status)) {
            return task;
        }

        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                if (['completed', 'failed', 'cancelled'].includes(task.status)) {
                    clearInterval(checkInterval);
                    resolve(task);
                }
            }, 1000);

            setTimeout(() => {
                clearInterval(checkInterval);
                reject(new Error(`Timeout waiting for task ${taskId}`));
            }, timeoutSeconds * 1000);
        });
    }

    /**
     * Get completed tasks that haven't been acknowledged (read) yet.
     * @returns {Array}
     */
    getCompletedUnread() {
        return Array.from(this.tasks.values()).filter(t => 
            (t.status === 'completed' || t.status === 'failed') && !t.read
        );
    }

    /**
     * Mark a task as read/acknowledged.
     * @param {string} taskId 
     */
    markRead(taskId) {
        const task = this.getTask(taskId);
        if (task) {
            task.read = true;
        }
    }

    /**
     * Clean up old tasks.
     * @param {number} maxAgeMs - Max age in milliseconds (default 24h)
     */
    cleanupOld(maxAgeMs = 24 * 60 * 60 * 1000) {
        const now = Date.now();
        for (const [id, task] of this.tasks) {
            if (['completed', 'failed', 'cancelled'].includes(task.status) && task.completedAt) {
                const completedTime = new Date(task.completedAt).getTime();
                if (now - completedTime > maxAgeMs) {
                    this.tasks.delete(id);
                }
            }
        }
    }
}
