import fs from 'fs';
import path from 'path';
import { AiManEventBus } from '../lib/event-bus.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * Manages recurring task schedules.
 */
export class SchedulerService {
    /** Maximum consecutive failures before auto-pausing a schedule */
    static CIRCUIT_BREAKER_THRESHOLD = 5;

    /** Maximum number of recent task IDs tracked per schedule for
     *  matching completion/failure events. Larger values tolerate
     *  faster trigger rates relative to task completion times. */
    static RECENT_TASK_BUFFER_SIZE = 10;

    /**
     * @param {AiManEventBus} eventBus
     * @param {TaskManager} taskManager
     * @param {string} workingDir
     */
    constructor(eventBus, taskManager, workingDir, aiAssistantClass) {
        this.eventBus = eventBus || new AiManEventBus();
        this.taskManager = taskManager;
        this.workingDir = workingDir;
        this.aiAssistantClass = aiAssistantClass;
        
        this.schedules = new Map(); // scheduleId -> ScheduleRecord
        this.intervals = new Map(); // scheduleId -> NodeJS.Timeout
        
        this.persistenceFile = path.join(workingDir, '.oboto', 'schedules.json');
        
        // Ensure .oboto directory exists
        const configDir = path.dirname(this.persistenceFile);
        if (!fs.existsSync(configDir)) {
            try {
                fs.mkdirSync(configDir, { recursive: true });
            } catch (e) {
                // Ignore if exists
            }
        }

        // Listen for task completions to track consecutive failures per schedule.
        // Store bound references so they can be removed in destroy().
        this._onCompletedBound = (data) => this._onTaskCompleted(data);
        this._onFailedBound = (data) => this._onTaskFailed(data);
        this.eventBus.on('task:completed', this._onCompletedBound);
        this.eventBus.on('task:failed', this._onFailedBound);
    }

    /**
     * Load persisted schedules and start them.
     */
    async restore() {
        if (fs.existsSync(this.persistenceFile)) {
            try {
                const content = await fs.promises.readFile(this.persistenceFile, 'utf8');
                const data = JSON.parse(content);
                
                for (const schedule of data) {
                    // Reset transient state if needed, but keep stats.
                    // Ensure ring buffer is bounded after deserialization
                    // (guards against manual edits or legacy data).
                    if (schedule.recentTaskIds && schedule.recentTaskIds.length > SchedulerService.RECENT_TASK_BUFFER_SIZE) {
                        schedule.recentTaskIds = schedule.recentTaskIds.slice(-SchedulerService.RECENT_TASK_BUFFER_SIZE);
                    }
                    this.schedules.set(schedule.id, schedule);
                    
                    if (schedule.status === 'active') {
                        this._startScheduleTimer(schedule.id);
                    }
                }
                
                consoleStyler.log('system', `⏰ Restored ${this.schedules.size} schedules`);
            } catch (error) {
                consoleStyler.log('error', `Failed to restore schedules: ${error.message}`);
            }
        }
    }

    /**
     * Persist schedules to disk.
     */
    async _persist() {
        try {
            const data = Array.from(this.schedules.values());
            await fs.promises.writeFile(this.persistenceFile, JSON.stringify(data, null, 2));
        } catch (error) {
            consoleStyler.log('error', `Failed to persist schedules: ${error.message}`);
        }
    }

    /**
     * Create a new recurring task schedule.
     */
    async createSchedule(config) {
        const { 
            name, 
            description, 
            query, 
            intervalMs, // e.g. 60000 for 1 min
            maxRuns = null,
            skipIfRunning = true,
            tags = []
        } = config;

        if (!intervalMs || intervalMs < 1000) {
            throw new Error('Interval must be at least 1000ms');
        }

        const id = `schedule-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
        
        const schedule = {
            id,
            name,
            description,
            query,
            intervalMs,
            status: 'active',
            createdAt: new Date().toISOString(),
            lastRunAt: null,
            nextRunAt: new Date(Date.now() + intervalMs).toISOString(),
            runCount: 0,
            maxRuns,
            lastTaskId: null,
            /** Ring buffer of recent task IDs for matching completion/failure events
             *  even when a new task overwrites lastTaskId before the prior one reports. */
            recentTaskIds: [],
            lastResult: null,
            skipIfRunning,
            tags,
            consecutiveFailures: 0
        };

        this.schedules.set(id, schedule);
        this._startScheduleTimer(id);
        await this._persist();
        
        this.eventBus.emitTyped('schedule:created', schedule);
        return schedule;
    }

    _startScheduleTimer(scheduleId) {
        // Clear existing if any
        if (this.intervals.has(scheduleId)) {
            clearInterval(this.intervals.get(scheduleId));
        }

        const schedule = this.schedules.get(scheduleId);
        if (!schedule || schedule.status !== 'active') return;

        // Simple interval for now
        const timer = setInterval(() => {
            this._trigger(scheduleId);
        }, schedule.intervalMs);
        
        this.intervals.set(scheduleId, timer);
    }

    async _trigger(scheduleId) {
        const schedule = this.schedules.get(scheduleId);
        if (!schedule || schedule.status !== 'active') return;

        // Check max runs
        if (schedule.maxRuns !== null && schedule.runCount >= schedule.maxRuns) {
            this.pauseSchedule(scheduleId);
            return;
        }

        // Check skipIfRunning
        if (schedule.skipIfRunning && schedule.lastTaskId) {
            const lastTask = this.taskManager.getTask(schedule.lastTaskId);
            if (lastTask && (lastTask.status === 'running' || lastTask.status === 'queued')) {
                consoleStyler.log('system', `⚠️ Skipping schedule ${schedule.name}: previous task still running`);
                return;
            }
        }

        // Spawn task
        try {
            const task = this.taskManager.spawnTask(
                schedule.query,
                `[Recurring] ${schedule.name}`, // Prefix description
                this.aiAssistantClass,
                {
                    workingDir: this.workingDir,
                    metadata: {
                        type: 'recurring',
                        scheduleId: schedule.id,
                        runNumber: schedule.runCount + 1,
                        tags: schedule.tags
                    }
                }
            );

            // Update schedule stats
            schedule.lastRunAt = new Date().toISOString();
            schedule.nextRunAt = new Date(Date.now() + schedule.intervalMs).toISOString();
            schedule.runCount++;
            schedule.lastTaskId = task.id;

            // Track in ring buffer so completion/failure events still match even
            // if a subsequent trigger overwrites lastTaskId before this task reports.
            if (!schedule.recentTaskIds) schedule.recentTaskIds = [];
            schedule.recentTaskIds.push(task.id);
            if (schedule.recentTaskIds.length > SchedulerService.RECENT_TASK_BUFFER_SIZE) schedule.recentTaskIds.shift();
            
            await this._persist();
            
            this.eventBus.emitTyped('schedule:fired', { 
                scheduleId, 
                taskId: task.id,
                runCount: schedule.runCount
            });

        } catch (error) {
            consoleStyler.log('error', `Failed to trigger schedule ${schedule.name}: ${error.message}`);
            this._recordFailure(scheduleId, error.message);
        }
    }

    /**
     * Record a successful run — resets the consecutive failure counter.
     */
    _onTaskCompleted(data) {
        if (!data?.taskId) return;
        for (const schedule of this.schedules.values()) {
            const ids = schedule.recentTaskIds || [];
            if (schedule.lastTaskId === data.taskId || ids.includes(data.taskId)) {
                schedule.consecutiveFailures = 0;
                schedule.lastResult = 'success';
                // Remove matched ID from ring buffer to avoid stale matches
                const idx = ids.indexOf(data.taskId);
                if (idx !== -1) ids.splice(idx, 1);
                this._persist().catch(() => {}); // errors already logged inside _persist
                break;
            }
        }
    }

    /**
     * Record a failed run — increments the consecutive failure counter
     * and auto-pauses the schedule if the circuit breaker threshold is reached.
     */
    _onTaskFailed(data) {
        if (!data?.taskId) return;
        for (const [scheduleId, schedule] of this.schedules.entries()) {
            const ids = schedule.recentTaskIds || [];
            if (schedule.lastTaskId === data.taskId || ids.includes(data.taskId)) {
                // Remove matched ID from ring buffer
                const idx = ids.indexOf(data.taskId);
                if (idx !== -1) ids.splice(idx, 1);
                this._recordFailure(scheduleId, data.error || 'Task failed');
                break;
            }
        }
    }

    /**
     * Increment failure count and auto-pause if circuit breaker threshold is reached.
     */
    _recordFailure(scheduleId, errorMessage) {
        const schedule = this.schedules.get(scheduleId);
        if (!schedule) return;

        schedule.consecutiveFailures = (schedule.consecutiveFailures || 0) + 1;
        schedule.lastResult = `error: ${errorMessage}`;

        if (schedule.consecutiveFailures >= SchedulerService.CIRCUIT_BREAKER_THRESHOLD) {
            consoleStyler.log('warning',
                `⚠️ Circuit breaker: Auto-pausing schedule "${schedule.name}" after ${schedule.consecutiveFailures} consecutive failures. ` +
                `Last error: ${errorMessage}`
            );
            // pauseSchedule will persist for us — skip the redundant write below
            this.pauseSchedule(scheduleId);
            this.eventBus.emitTyped('schedule:circuit-breaker', {
                scheduleId,
                name: schedule.name,
                consecutiveFailures: schedule.consecutiveFailures,
                lastError: errorMessage
            });
            return;
        }

        this._persist().catch(() => {}); // errors already logged inside _persist
    }

    pauseSchedule(scheduleId) {
        const schedule = this.schedules.get(scheduleId);
        if (schedule) {
            schedule.status = 'paused';
            if (this.intervals.has(scheduleId)) {
                clearInterval(this.intervals.get(scheduleId));
                this.intervals.delete(scheduleId);
            }
            this._persist();
            this.eventBus.emitTyped('schedule:paused', { scheduleId });
            return true;
        }
        return false;
    }

    resumeSchedule(scheduleId) {
        const schedule = this.schedules.get(scheduleId);
        if (schedule) {
            schedule.status = 'active';
            schedule.nextRunAt = new Date(Date.now() + schedule.intervalMs).toISOString();
            this._startScheduleTimer(scheduleId);
            this._persist();
            this.eventBus.emitTyped('schedule:resumed', { scheduleId });
            return true;
        }
        return false;
    }

    deleteSchedule(scheduleId) {
        if (this.schedules.has(scheduleId)) {
            if (this.intervals.has(scheduleId)) {
                clearInterval(this.intervals.get(scheduleId));
                this.intervals.delete(scheduleId);
            }
            this.schedules.delete(scheduleId);
            this._persist();
            this.eventBus.emitTyped('schedule:deleted', { scheduleId });
            return true;
        }
        return false;
    }
    
    listSchedules(statusFilter = 'all') {
        const all = Array.from(this.schedules.values());
        if (statusFilter === 'all') return all;
        return all.filter(s => s.status === statusFilter);
    }
    
    getSchedule(scheduleId) {
        return this.schedules.get(scheduleId) || null;
    }
    
    triggerNow(scheduleId) {
        const schedule = this.schedules.get(scheduleId);
        if (schedule) {
            this._trigger(scheduleId);
            return true;
        }
        return false;
    }

    /**
     * Switch to a new workspace directory.
     * Stops all running schedule timers, persists current schedules,
     * clears in-memory state, updates workingDir + persistence path,
     * and restores schedules from the new workspace's .oboto/schedules.json.
     */
    async switchWorkspace(newWorkingDir) {
        // 1. Persist current schedules before leaving
        await this._persist();

        // 2. Stop all running timers
        for (const [id, timer] of this.intervals) {
            clearInterval(timer);
        }
        this.intervals.clear();

        // 3. Clear in-memory schedule state
        this.schedules.clear();

        // 4. Update working dir and persistence path
        this.workingDir = newWorkingDir;
        this.persistenceFile = path.join(newWorkingDir, '.oboto', 'schedules.json');

        // Ensure .oboto directory exists in new workspace
        const configDir = path.dirname(this.persistenceFile);
        if (!fs.existsSync(configDir)) {
            try {
                fs.mkdirSync(configDir, { recursive: true });
            } catch (e) {
                // Ignore if exists
            }
        }

        // 5. Restore schedules from new workspace
        await this.restore();

        consoleStyler.log('system', `⏰ Scheduler switched to workspace: ${newWorkingDir}`);
    }

    /**
     * Tear down this instance: remove event listeners and stop all timers.
     * Call before discarding a SchedulerService to avoid ghost listeners
     * on the shared eventBus.
     */
    destroy() {
        if (this._onCompletedBound) {
            this.eventBus.off('task:completed', this._onCompletedBound);
        }
        if (this._onFailedBound) {
            this.eventBus.off('task:failed', this._onFailedBound);
        }
        for (const timer of this.intervals.values()) {
            clearInterval(timer);
        }
        this.intervals.clear();
    }
}
