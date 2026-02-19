// Stage 3: preprocess
// Runs consciousness pre-processing, adds user message to history,
// stores in holographic memory, resets quality evaluator, and predicts reasoning.

import { consoleStyler } from '../../ui/console-styler.mjs';

/**
 * @param {import('../request-context.mjs').RequestContext} ctx
 * @param {import('../service-registry.mjs').ServiceRegistry} services
 * @param {Function} next
 */
export async function preprocess(ctx, services, next) {
    // Skip most preprocessing on retry — the history is already set up
    if (ctx.isRetry) {
        await next();
        return;
    }

    const historyManager = services.get('historyManager');
    const consciousness = services.optional('consciousness');
    const reasoningSystem = services.optional('reasoningSystem');
    const qualityEvaluator = services.optional('qualityEvaluator');
    const memoryAdapter = services.optional('memoryAdapter');

    // ── Consciousness Systems: Pre-Input Analysis ──
    if (consciousness) {
        const { messages: consciousnessMessages } = consciousness.preProcess(
            ctx.userInput,
            {
                history: historyManager.getHistory(),
                reasoningSystem,
            }
        );
        for (const msg of consciousnessMessages) {
            historyManager.addMessage(msg.role, msg.content);
        }
    }

    // Add user message to history
    historyManager.addMessage('user', ctx.userInput);

    // Store user input in holographic memory
    if (memoryAdapter && typeof memoryAdapter.store === 'function') {
        try {
            await memoryAdapter.store(ctx.userInput, { role: 'user' });
        } catch (e) {
            // Ignore store errors
        }
    }

    // Reset quality evaluator and reasoning system
    if (qualityEvaluator) qualityEvaluator.reset();
    if (reasoningSystem) {
        reasoningSystem.reset();
        consoleStyler.log('reasoning', 'Analyzing request complexity and predicting reasoning approach...');
        reasoningSystem.predictReasoningFromInput(ctx.userInput);
    }

    // Modulate reasoning based on consciousness state
    if (consciousness) {
        const hints = consciousness.getReasoningHints();
        if (hints.shouldEscalate && hints.reason) {
            consoleStyler.log('reasoning', hints.reason);
        }
    }

    await next();
}
