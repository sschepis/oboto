// Stage 6: qualityGateStage
// Evaluates response quality and triggers retry if needed.
// Uses the existing QualityGate class for evaluation logic.

import { consoleStyler } from '../../ui/console-styler.mjs';

/**
 * @param {import('../request-context.mjs').RequestContext} ctx
 * @param {import('../service-registry.mjs').ServiceRegistry} services
 * @param {Function} next
 */
export async function qualityGateStage(ctx, services, next) {
    // Skip quality gate on retries to avoid infinite retry loops
    if (ctx.isRetry) {
        await next();
        return;
    }

    const qualityGate = services.optional('qualityGate');
    const qualityEvaluator = services.optional('qualityEvaluator');

    // If no quality gate configured, skip
    if (!qualityGate || !qualityEvaluator) {
        await next();
        return;
    }

    // If no quality evaluator retry in progress, check quality
    if (!qualityEvaluator.isRetrying()) {
        const retryConfig = await qualityGate.evaluateAndCheckRetry(ctx.originalInput, ctx.finalResponse);

        if (retryConfig) {
            const historyManager = services.get('historyManager');
            historyManager.setHistory(retryConfig.preservedHistory);
            consoleStyler.log('recovery', 'Preserving tool call history and retrying with improved prompt...');
            const stats = historyManager.getStats();
            consoleStyler.log('recovery', `Session memory preserved: ${stats.messageCount} messages`, { indent: true });

            // Create a retry context and re-execute the pipeline
            const pipeline = services.get('pipeline');
            const retryCtx = ctx.createRetryContext(retryConfig.improvedPrompt);
            ctx.finalResponse = await pipeline.execute(retryCtx);

            // Skip remaining stages — the retry pipeline already ran finalize
            return;
        }
    }

    await next();
}
