// Stage 1: validate
// Checks abort signal, validates input, ensures custom tools are loaded.

import { emitStatus } from '../status-reporter.mjs';
import { consoleStyler } from '../../ui/console-styler.mjs';

/**
 * @param {import('../request-context.mjs').RequestContext} ctx
 * @param {import('../service-registry.mjs').ServiceRegistry} services
 * @param {Function} next
 */
export async function validate(ctx, services, next) {
    ctx.throwIfAborted();

    if (!ctx.userInput || ctx.userInput.trim().length === 0) {
        ctx.finalResponse = 'Please provide a message.';
        ctx._skipToFinalize = true;
        await next();
        return;
    }

    // Ensure custom tools and subsystems are initialized
    const toolLoader = services.get('toolLoader');
    await toolLoader.ensureLoaded();

    // Update dry run state on the tool executor
    const toolExecutor = services.get('toolExecutor');
    toolExecutor.setDryRun(ctx.dryRun);

    if (!ctx.isRetry) {
        emitStatus('Analyzing your request…');
        consoleStyler.log('ai', 'Processing new user request...', { timestamp: true });
    } else {
        consoleStyler.log('recovery', `Retry attempt #${ctx.retryCount} initiated`, { timestamp: true });
    }

    await next();
}
