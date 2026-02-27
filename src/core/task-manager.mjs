import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { AiManEventBus } from '../lib/event-bus.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';

/** Directories that must never be used as workspace roots. */
const FORBIDDEN_WORKSPACE_PATHS = new Set([
    '/', '/usr', '/etc', '/var', '/bin', '/sbin', '/lib', '/boot', '/dev', '/proc', '/sys',
    '/tmp', '/root',
    // macOS-specific
    '/System', '/Library', '/Applications', '/Volumes',
]);

/**
 * Sensitive subdirectories of the user's home directory that must never be
 * used as workspace roots.  These contain credentials, keys, and system
 * configuration that an LLM-driven task should never be able to overwrite.
 */
const SENSITIVE_HOME_SUBDIRS = new Set([
    '.ssh', '.gnupg', '.gpg', '.config', '.local', '.aws', '.kube',
    '.docker', '.npm', '.cargo', '.rustup', '.pyenv',
    '.oboto',  // our own global config — protect from recursive workspace tasks
    'Library', // macOS user Library
]);

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
        const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        
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
            
            const result = await new Promise((resolve, reject) => {
                const onAbort = () => reject(new Error('Task cancelled'));
                task.abortController.signal.addEventListener('abort', onAbort);
                runPromise
                    .then(resolve, reject)
                    .finally(() => task.abortController.signal.removeEventListener('abort', onAbort));
            });

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

    // ─── Workspace Tasks ──────────────────────────────────────────────────

    /**
     * Spawn a background task that operates in a different workspace directory.
     * The task gets a fully isolated EventicFacade with its own history, tools,
     * plugins, and MCP servers.  Results are reported back to the originating
     * workspace's conversation via the shared eventBus.
     *
     * @param {Object} opts
     * @param {string} opts.workspacePath — absolute or relative path to target workspace
     * @param {string} opts.description — human-readable description
     * @param {string} opts.query — the prompt / instructions
     * @param {Function} opts.aiAssistantClass — EventicFacade constructor
     * @param {AiManEventBus} opts.eventBus — shared eventBus for progress reporting
     * @param {string} [opts.context] — additional conversation context
     * @param {boolean} [opts.initGit=false] — initialise a git repo in new dirs
     * @param {string} [opts.originWorkspace] — spawning workspace path
     * @param {string} [opts.originConversation] — spawning conversation name
     * @returns {Object} The created task record
     */
    async spawnWorkspaceTask(opts) {
        const {
            workspacePath,
            description,
            query,
            aiAssistantClass,
            eventBus,
            context,
            initGit = false,
            originWorkspace = null,
            originConversation = null,
        } = opts;

        // ── Resolve & validate path ─────────────────────────────────────────
        const resolvedPath = path.resolve(workspacePath);

        // Check both exact matches and subdirectories of protected paths.
        // Also resolve symlinks where the target already exists to prevent
        // symlink-based bypasses of the blocklist.
        let realPath = resolvedPath;
        try {
            // fs.realpath resolves symlinks; if the target doesn't exist
            // yet (new workspace) we fall back to the resolved-but-unlinked path.
            realPath = await fs.realpath(resolvedPath);
        } catch {
            // Target doesn't exist yet — use the unresolved path
        }

        const isForbidden = [...FORBIDDEN_WORKSPACE_PATHS].some(fp =>
            realPath === fp || realPath.startsWith(fp + '/')
        );
        if (isForbidden) {
            throw new Error(`Cannot use "${resolvedPath}" as a workspace — path is under a protected system directory.`);
        }

        // Also block sensitive subdirectories of the user's home directory.
        // These contain credentials, keys, and system config that the AI
        // should never have write access to.
        const homeDir = os.homedir();
        const isSensitiveHome = [...SENSITIVE_HOME_SUBDIRS].some(subdir => {
            const sensitiveDir = path.join(homeDir, subdir);
            return realPath === sensitiveDir || realPath.startsWith(sensitiveDir + '/');
        });
        if (isSensitiveHome) {
            throw new Error(`Cannot use "${resolvedPath}" as a workspace — path is under a sensitive home directory.`);
        }

        // ── Create directory if needed ──────────────────────────────────────
        let dirCreated = false;
        try {
            await fs.access(resolvedPath);
        } catch {
            // Directory does not exist — create it
            await fs.mkdir(resolvedPath, { recursive: true });
            dirCreated = true;
            consoleStyler.log('system', `📁 Created workspace directory: ${resolvedPath}`);

            if (initGit) {
                try {
                    execSync('git init', { cwd: resolvedPath, stdio: 'ignore', timeout: 10_000 });
                    consoleStyler.log('system', `🔧 Initialised git repository in ${resolvedPath}`);
                } catch (gitErr) {
                    consoleStyler.log('warning', `git init failed in ${resolvedPath}: ${gitErr.message}`);
                }
            }
        }

        // ── Build task record ───────────────────────────────────────────────
        const taskId = `ws-task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

        const taskRecord = {
            id: taskId,
            description,
            query,
            status: 'queued',
            type: 'workspace',
            workspacePath: resolvedPath,
            dirCreated,
            originWorkspace,
            originConversation,
            createdAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
            result: null,
            error: null,
            read: false,
            outputLog: [],
            abortController: new AbortController(),
            progress: 0,
            metadata: { type: 'workspace', workspacePath: resolvedPath, originWorkspace }
        };

        this.tasks.set(taskId, taskRecord);

        this.eventBus.emitTyped('workspace-task:spawned', {
            taskId,
            description,
            workspacePath: resolvedPath,
            originWorkspace,
            originConversation,
            status: 'queued',
            createdAt: taskRecord.createdAt,
        });
        // Also emit the regular task:spawned so existing task lists pick it up
        this.eventBus.emitTyped('task:spawned', {
            taskId,
            description,
            status: 'queued',
            createdAt: taskRecord.createdAt,
            metadata: taskRecord.metadata
        });

        consoleStyler.log('system', `🚀 Spawned workspace task: ${description} → ${resolvedPath} (${taskId})`);

        // Start execution (async — returns immediately)
        this._executeWorkspaceTask(taskId, aiAssistantClass, query, {
            context,
            eventBus,
            workspacePath: resolvedPath,
            originWorkspace,
            originConversation
        });

        return taskRecord;
    }

    /**
     * Execute a workspace task in an isolated EventicFacade.
     * @private
     */
    async _executeWorkspaceTask(taskId, aiAssistantClass, query, options) {
        const task = this.tasks.get(taskId);
        if (!task || task.status === 'cancelled') return;

        task.status = 'running';
        task.startedAt = new Date().toISOString();
        this.eventBus.emitTyped('task:started', { taskId });

        let assistant = null;

        try {
            const { workspacePath, context, eventBus, originWorkspace, originConversation } = options;

            // Create a fully isolated EventicFacade for the target workspace.
            // Pass the shared eventBus so progress events are visible to the parent.
            assistant = new aiAssistantClass(workspacePath, {
                eventBus: eventBus || this.eventBus,
                taskManager: this,
            });

            await assistant.initializeCustomTools();
            await assistant.loadConversation();

            // Wire up output capture
            const localBus = assistant.eventBus || eventBus || this.eventBus;
            const logHandler = (data) => {
                const msg = typeof data === 'string' ? data : (data.message || '');
                if (msg) this.appendOutput(taskId, msg);
            };
            localBus.on('server:log', logHandler);

            // Build the query with context
            let finalQuery = query;
            if (context) {
                finalQuery = `CONTEXT: ${context}\n\nTASK: ${query}`;
            }

            // Race against abort signal (with proper listener cleanup)
            const runPromise = assistant.run(finalQuery);
            const result = await new Promise((resolve, reject) => {
                const onAbort = () => reject(new Error('Workspace task cancelled'));
                task.abortController.signal.addEventListener('abort', onAbort);
                runPromise
                    .then(resolve, reject)
                    .finally(() => task.abortController.signal.removeEventListener('abort', onAbort));
            });

            // Cleanup log listener
            localBus.off('server:log', logHandler);

            task.status = 'completed';
            task.completedAt = new Date().toISOString();
            task.result = result;
            task.progress = 100;

            // Emit workspace-specific completion event (for cross-workspace reporting)
            this.eventBus.emitTyped('workspace-task:completed', {
                taskId,
                description: task.description,
                workspacePath,
                originWorkspace,
                originConversation,
                result: typeof result === 'string'
                    ? result.substring(0, 500) + (result.length > 500 ? '...' : '')
                    : String(result).substring(0, 500),
            });
            // Also emit the standard task:completed
            this.eventBus.emitTyped('task:completed', {
                taskId,
                description: task.description,
                result: typeof result === 'string'
                    ? result.substring(0, 100) + '...'
                    : String(result).substring(0, 100)
            });

            consoleStyler.log('system', `🔔 Workspace task completed: ${task.description} (${taskId})`);

        } catch (error) {
            if (task.status === 'cancelled') return;

            task.status = 'failed';
            task.completedAt = new Date().toISOString();
            task.error = error.message;

            this.eventBus.emitTyped('workspace-task:failed', {
                taskId,
                description: task.description,
                workspacePath: options.workspacePath,
                originWorkspace: options.originWorkspace,
                originConversation: options.originConversation,
                error: error.message,
            });
            this.eventBus.emitTyped('task:failed', {
                taskId,
                description: task.description,
                error: error.message
            });

            consoleStyler.log('error', `Workspace task failed: ${task.description} (${taskId}) - ${error.message}`);

        } finally {
            // Dispose the isolated assistant to free MCP connections, plugins, etc.
            if (assistant) {
                try {
                    if (assistant.mcpClientManager?.clients) {
                        for (const name of assistant.mcpClientManager.clients.keys()) {
                            try { await assistant.mcpClientManager.disconnect(name); } catch { /* best-effort */ }
                        }
                    }
                    if (assistant.pluginManager) {
                        try { await assistant.pluginManager.shutdown(); } catch { /* best-effort */ }
                    }
                    if (assistant.consciousness) {
                        try { await assistant.consciousness.persist(); } catch { /* best-effort */ }
                    }
                    await assistant.saveConversation();
                } catch (disposeErr) {
                    consoleStyler.log('warning', `Workspace task cleanup error: ${disposeErr.message}`);
                }
            }
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
