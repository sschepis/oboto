// Agent Loop Sub-stage 5a: resolveModel
// Determines which model to use for this turn based on reasoning effort,
// model overrides, and prompt routing.

import { consoleStyler } from '../../ui/console-styler.mjs';
import { TASK_ROLES } from '../prompt-router.mjs';
import { getModelInfo } from '../model-registry.mjs';

/**
 * Resolve the model configuration for the current turn.
 *
 * @param {import('../request-context.mjs').RequestContext} ctx
 * @param {import('../service-registry.mjs').ServiceRegistry} services
 * @returns {Object} modelConfig — { modelId, provider, contextWindow, maxOutputTokens, supportsToolCalling, supportsReasoningEffort, ... }
 */
export function resolveModelForTurn(ctx, services) {
    const promptRouter = services.get('promptRouter');
    const reasoningSystem = services.optional('reasoningSystem');
    const qualityEvaluator = services.optional('qualityEvaluator');
    const toolExecutor = services.get('toolExecutor');
    const historyManager = services.get('historyManager');

    // Determine reasoning effort
    let reasoning = 'medium';
    if (reasoningSystem) {
        const history = historyManager.getHistory();
        const context = {
            retryAttempts: qualityEvaluator?.getRetryAttempts?.() || 0,
            historyLength: history.length,
            toolCallCount: history.filter(msg => msg.tool_calls).length,
            pendingSteps: toolExecutor.getCurrentTodos()?.items?.filter(
                item => item.status !== 'completed'
            ).length || 0,
            todoCount: toolExecutor.getCurrentTodos()?.items?.length || 0,
        };
        reasoning = reasoningSystem.getSimplifiedReasoning('', context);
        consoleStyler.log('reasoning', `Selected reasoning effort: ${reasoning}`);
    }

    // Store reasoning on context metadata for downstream use
    ctx.metadata.reasoning = reasoning;

    // Determine role
    let role = TASK_ROLES.AGENTIC;
    if (reasoning === 'high') role = TASK_ROLES.REASONING_HIGH;
    if (reasoning === 'low') role = TASK_ROLES.REASONING_LOW;

    let modelConfig;

    if (ctx.model) {
        // Model override from request
        const info = getModelInfo(ctx.model);
        modelConfig = {
            modelId: info.id,
            provider: info.provider,
            contextWindow: info.contextWindow,
            maxOutputTokens: info.maxOutputTokens,
            supportsToolCalling: info.supportsToolCalling,
            supportsReasoningEffort: info.supportsReasoningEffort,
            costTier: info.costTier,
            reasoningCapability: info.reasoningCapability,
        };
        consoleStyler.log('routing', `Using manual model override: ${ctx.model}`);
    } else {
        modelConfig = promptRouter.resolveModel(role);

        // Safety check: if high reasoning model doesn't support tools, fallback to agentic
        if (!modelConfig.supportsToolCalling && role === TASK_ROLES.REASONING_HIGH) {
            consoleStyler.log('routing', `Role ${role} (${modelConfig.modelId}) lacks tool support. Falling back to AGENTIC.`);
            role = TASK_ROLES.AGENTIC;
            modelConfig = promptRouter.resolveModel(role);
        }
    }

    return modelConfig;
}
