import { wsSend, wsSendError } from '../../lib/ws-utils.mjs';

/**
 * Handles: get-tasks, get-task-output, cancel-task,
 *          get-schedules, pause-schedule, resume-schedule, delete-schedule, trigger-schedule
 */

async function handleGetTasks(data, ctx) {
    const { ws, assistant } = ctx;
    if (assistant.taskManager) {
        const { status_filter } = data.payload || {};
        const tasks = assistant.taskManager.listTasks(status_filter);
        const simplified = tasks.map(t => ({
            ...t,
            outputLog: undefined,
            abortController: undefined
        }));
        wsSend(ws, 'task-list', simplified);
    }
}

async function handleGetTaskOutput(data, ctx) {
    const { ws, assistant } = ctx;
    if (assistant.taskManager) {
        const { task_id, since_index } = data.payload;
        const logs = assistant.taskManager.getTaskOutput(task_id, since_index || 0);
        wsSend(ws, 'task-output-history', { taskId: task_id, logs });
    }
}

async function handleCancelTask(data, ctx) {
    const { ws, assistant } = ctx;
    if (assistant.taskManager) {
        const { task_id } = data.payload;
        const success = assistant.taskManager.cancelTask(task_id);
        if (!success) {
            wsSendError(ws, `Failed to cancel task ${task_id}`);
        }
    }
}

async function handleGetSchedules(data, ctx) {
    const { ws, schedulerService } = ctx;
    if (schedulerService) {
        const schedules = schedulerService.listSchedules(data.payload?.status_filter);
        wsSend(ws, 'schedule-list', schedules);
    }
}

async function handlePauseSchedule(data, ctx) {
    const { schedulerService } = ctx;
    if (schedulerService) {
        schedulerService.pauseSchedule(data.payload.schedule_id);
    }
}

async function handleResumeSchedule(data, ctx) {
    const { schedulerService } = ctx;
    if (schedulerService) {
        schedulerService.resumeSchedule(data.payload.schedule_id);
    }
}

async function handleDeleteSchedule(data, ctx) {
    const { schedulerService } = ctx;
    if (schedulerService) {
        schedulerService.deleteSchedule(data.payload.schedule_id);
    }
}

async function handleTriggerSchedule(data, ctx) {
    const { schedulerService } = ctx;
    if (schedulerService) {
        schedulerService.triggerNow(data.payload.schedule_id);
    }
}

export const handlers = {
    'get-tasks': handleGetTasks,
    'get-task-output': handleGetTaskOutput,
    'cancel-task': handleCancelTask,
    'get-schedules': handleGetSchedules,
    'pause-schedule': handlePauseSchedule,
    'resume-schedule': handleResumeSchedule,
    'delete-schedule': handleDeleteSchedule,
    'trigger-schedule': handleTriggerSchedule
};
