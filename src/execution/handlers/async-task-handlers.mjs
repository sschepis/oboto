export class AsyncTaskHandlers {
    constructor(taskManager, aiAssistantClass, schedulerService, eventBus) {
        this.taskManager = taskManager;
        this.aiAssistantClass = aiAssistantClass;
        this.schedulerService = schedulerService;
        this.eventBus = eventBus;
    }

    async spawnBackgroundTask(args) {
        const { task_description, query, context } = args;
        
        if (!this.taskManager) {
            return "Error: Task Manager is not available. Background tasks are disabled.";
        }

        const task = this.taskManager.spawnTask(
            query, 
            task_description, 
            this.aiAssistantClass,
            { context }
        );

        return `Background task spawned successfully.\nTask ID: ${task.id}\nDescription: ${task.description}\n\nUse check_task_status(task_id) to monitor progress.`;
    }

    async checkTaskStatus(args) {
        const { task_id } = args;
        
        if (!this.taskManager) {
            return "Error: Task Manager is not available.";
        }

        const task = this.taskManager.getTask(task_id);
        if (!task) {
            return `Error: Task ID ${task_id} not found.`;
        }

        let response = `Task: ${task.description} (${task.id})\nStatus: ${task.status}\nProgress: ${task.progress || 0}%`;
        if (task.completedAt) {
            response += `\nCompleted At: ${task.completedAt}`;
        }
        if (task.result) {
            response += `\nResult Summary: ${task.result.substring(0, 200)}${task.result.length > 200 ? '...' : ''}`;
        }
        if (task.error) {
            response += `\nError: ${task.error}`;
        }

        return response;
    }

    async listBackgroundTasks(args) {
        const { status_filter = 'all' } = args;
        
        if (!this.taskManager) {
            return "Error: Task Manager is not available.";
        }

        const tasks = this.taskManager.listTasks(status_filter);
        
        if (tasks.length === 0) {
            return `No background tasks found (filter: ${status_filter}).`;
        }

        let response = `Background Tasks (${tasks.length}):\n`;
        tasks.forEach(t => {
            response += `- [${t.status}] ${t.id}: ${t.description} (${t.progress}%)\n`;
        });

        return response;
    }

    async waitForTask(args) {
        const { task_id, timeout_seconds = 300 } = args;
        
        if (!this.taskManager) {
            return "Error: Task Manager is not available.";
        }

        try {
            const task = await this.taskManager.waitForTask(task_id, timeout_seconds);
            return `Task Completed.\nID: ${task.id}\nStatus: ${task.status}\nResult: ${task.result || task.error}`;
        } catch (error) {
            return `Error: ${error.message}`;
        }
    }

    async cancelBackgroundTask(args) {
        const { task_id } = args;
        
        if (!this.taskManager) {
            return "Error: Task Manager is not available.";
        }

        const success = this.taskManager.cancelTask(task_id);
        if (success) {
            return `Task ${task_id} cancelled successfully.`;
        } else {
            return `Could not cancel task ${task_id}. It may not exist or is not in a cancellable state.`;
        }
    }

    async getTaskOutput(args) {
        const { task_id, last_n_lines = 20 } = args;
        
        if (!this.taskManager) {
            return "Error: Task Manager is not available.";
        }

        const task = this.taskManager.getTask(task_id);
        if (!task) return `Task ${task_id} not found.`;

        const logs = task.outputLog.slice(-last_n_lines);
        return `Output for task ${task_id} (last ${logs.length} lines):\n\n${logs.join('\n')}`;
    }

    async createRecurringTask(args) {
        const { name, description, query, interval_minutes, max_runs, skip_if_running } = args;
        
        if (!this.schedulerService) {
            return "Error: Scheduler Service is not available.";
        }

        try {
            const schedule = await this.schedulerService.createSchedule({
                name,
                description,
                query,
                intervalMs: interval_minutes * 60 * 1000,
                maxRuns: max_runs,
                skipIfRunning: skip_if_running !== false // default true
            });
            
            return `Recurring task created successfully.\nID: ${schedule.id}\nName: ${schedule.name}\nRuns every: ${interval_minutes} minutes`;
        } catch (error) {
            return `Error creating schedule: ${error.message}`;
        }
    }

    async listRecurringTasks(args) {
        const { status_filter = 'all' } = args;
        
        if (!this.schedulerService) {
            return "Error: Scheduler Service is not available.";
        }

        const schedules = this.schedulerService.listSchedules(status_filter);
        if (schedules.length === 0) return "No recurring tasks found.";

        let response = `Recurring Tasks (${schedules.length}):\n`;
        schedules.forEach(s => {
            response += `- [${s.status}] ${s.name} (${s.id})\n  Interval: ${s.intervalMs/1000/60}m | Runs: ${s.runCount}${s.maxRuns ? '/'+s.maxRuns : ''}\n  Next Run: ${s.nextRunAt}\n`;
        });
        return response;
    }

    async manageRecurringTask(args) {
        const { schedule_id, action } = args;
        
        if (!this.schedulerService) {
            return "Error: Scheduler Service is not available.";
        }

        let result = false;
        switch (action) {
            case 'pause':
                result = this.schedulerService.pauseSchedule(schedule_id);
                return result ? `Schedule ${schedule_id} paused.` : `Failed to pause schedule ${schedule_id}.`;
            case 'resume':
                result = this.schedulerService.resumeSchedule(schedule_id);
                return result ? `Schedule ${schedule_id} resumed.` : `Failed to resume schedule ${schedule_id}.`;
            case 'delete':
                result = this.schedulerService.deleteSchedule(schedule_id);
                return result ? `Schedule ${schedule_id} deleted.` : `Failed to delete schedule ${schedule_id}.`;
            case 'trigger_now':
                result = this.schedulerService.triggerNow(schedule_id);
                return result ? `Schedule ${schedule_id} triggered.` : `Failed to trigger schedule ${schedule_id}.`;
            default:
                return `Unknown action: ${action}`;
        }
    }

    /**
     * Ask a blocking question to the user via the main chat.
     * This pauses the agent loop and waits for the user's response.
     * @param {Object} args - { question: string }
     * @returns {Promise<string>} The user's answer
     */
    async askBlockingQuestion(args) {
        const { question } = args;

        if (!this.eventBus) {
            return "Error: Event bus is not available. Cannot ask questions.";
        }

        const questionId = `q-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;

        // Emit the question request to the agent loop controller
        this.eventBus.emitTyped('agent-loop:question-request', {
            questionId,
            question,
            taskId: null // Will be populated by context if available
        });

        // Wait for the answer (with a timeout of 24 hours — effectively indefinite for a blocking question)
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve(`Question timed out after 24 hours: "${question}"`);
            }, 24 * 60 * 60 * 1000);

            // Listen for the answer event
            const handler = (data) => {
                clearTimeout(timeout);
                resolve(`User answered: ${data.answer}`);
            };

            this.eventBus.once(`agent-loop:answer:${questionId}`, handler);
        });
    }
}
