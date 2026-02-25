import fs from 'fs';
import path from 'path';
import { AiManEventBus } from '../lib/event-bus.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * Manages recurring task schedules.
 */
export class SchedulerService {
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
                    // Reset transient state if needed, but keep stats
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
            lastResult: null,
            skipIfRunning,
            tags
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
            
            await this._persist();
            
            this.eventBus.emitTyped('schedule:fired', { 
                scheduleId, 
                taskId: task.id,
                runCount: schedule.runCount
            });

        } catch (error) {
            consoleStyler.log('error', `Failed to trigger schedule ${schedule.name}: ${error.message}`);
        }
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
}
