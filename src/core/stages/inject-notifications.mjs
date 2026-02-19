// Stage 2: injectNotifications
// Injects background task completion notifications and symbolic continuity
// message into conversation history. Only runs on non-retry requests.

import { consoleStyler } from '../../ui/console-styler.mjs';

/**
 * @param {import('../request-context.mjs').RequestContext} ctx
 * @param {import('../service-registry.mjs').ServiceRegistry} services
 * @param {Function} next
 */
export async function injectNotifications(ctx, services, next) {
    // Skip on retry — notifications were already injected on the original request
    if (ctx.isRetry) {
        await next();
        return;
    }

    const historyManager = services.get('historyManager');
    const taskManager = services.optional('taskManager');
    const symbolicContinuity = services.optional('symbolicContinuity');

    // Inject completed background task notifications
    if (taskManager) {
        const completedTasks = taskManager.getCompletedUnread();
        if (completedTasks.length > 0) {
            consoleStyler.log('system', `Injecting ${completedTasks.length} background task notification(s)`);
            for (const task of completedTasks) {
                const notification =
                    `BACKGROUND TASK COMPLETED [${task.id}]: "${task.description}"\n` +
                    `Status: ${task.status}\n` +
                    `Result Summary: ${task.result ? task.result.substring(0, 300) + '...' : task.error}`;

                historyManager.addMessage('system', notification);
                taskManager.markRead(task.id);
            }
        }
    }

    // Inject symbolic continuity message
    if (symbolicContinuity) {
        const continuityMsg = symbolicContinuity.renderInjectionMessage();
        if (continuityMsg) {
            historyManager.addMessage('system', continuityMsg);
        }
    }

    await next();
}
