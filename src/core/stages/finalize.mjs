// Stage 8: finalize
// Final stage — adds assistant response to history, saves conversation,
// emits UI/status events, and marks the context as complete.

import { consoleStyler } from '../../ui/console-styler.mjs';
import { emitStatus } from '../status-reporter.mjs';

/**
 * @param {import('../request-context.mjs').RequestContext} ctx
 * @param {import('../service-registry.mjs').ServiceRegistry} services
 * @param {Function} next
 */
export async function finalize(ctx, services, next) {
    const historyManager = services.get('historyManager');
    const conversationManager = services.optional('conversationManager');
    const statusAdapter = services.optional('statusAdapter');
    const eventBus = services.optional('eventBus');

    // 1. Add assistant response to conversation history
    if (ctx.finalResponse) {
        historyManager.pushMessage({
            role: 'assistant',
            content: ctx.finalResponse
        });
    }

    // 2. Save conversation to disk via ConversationManager (which knows the file path)
    try {
        if (conversationManager) {
            await conversationManager.saveActive();
        }
    } catch (err) {
        consoleStyler.log('error', `Failed to save conversation: ${err.message}`);
    }

    // 3. Emit status events
    emitStatus('Ready');

    if (statusAdapter) {
        statusAdapter.onComplete(ctx.finalResponse);
    }

    // 4. Emit response event for any listeners
    if (eventBus) {
        eventBus.emit('assistant:response', {
            requestId: ctx.id,
            input: ctx.originalInput,
            response: ctx.finalResponse,
            model: ctx.model,
            toolCallCount: ctx.toolCallCount,
            turnNumber: ctx.turnNumber,
            errors: ctx.errors
        });
    }

    // 5. Mark context as complete
    ctx.complete();

    // Call next for any post-finalize hooks
    await next();
}
