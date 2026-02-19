// AssistantPipeline — The pipeline runner that orchestrates request processing.
//
// Each stage is an async function: (ctx, services, next) => void
// Stages call next() to proceed to the next stage, or skip it to short-circuit.
// The pipeline is stateless — all per-request state lives in RequestContext.

import { consoleStyler } from '../ui/console-styler.mjs';

// Import stages
import { validate } from './stages/validate.mjs';
import { injectNotifications } from './stages/inject-notifications.mjs';
import { preprocess } from './stages/preprocess.mjs';
import { triage } from './stages/triage.mjs';
import { agentLoop } from './stages/agent-loop.mjs';
import { qualityGateStage } from './stages/quality-gate-stage.mjs';
import { postprocess } from './stages/postprocess.mjs';
import { finalize } from './stages/finalize.mjs';

/**
 * The ordered list of pipeline stages.
 * Each stage receives (ctx, services, next) and must call next() to continue.
 */
const DEFAULT_STAGES = [
    { name: 'validate', fn: validate },
    { name: 'injectNotifications', fn: injectNotifications },
    { name: 'preprocess', fn: preprocess },
    { name: 'triage', fn: triage },
    { name: 'agentLoop', fn: agentLoop },
    { name: 'qualityGate', fn: qualityGateStage },
    { name: 'postprocess', fn: postprocess },
    { name: 'finalize', fn: finalize },
];

export class AssistantPipeline {
    /**
     * @param {Array<{name: string, fn: Function}>} [stages] - Custom stage list (for testing)
     */
    constructor(stages = null) {
        this.stages = stages || DEFAULT_STAGES;
    }

    /**
     * Execute the pipeline for a given request context.
     *
     * @param {import('./request-context.mjs').RequestContext} ctx
     * @param {import('./service-registry.mjs').ServiceRegistry} services
     * @returns {Promise<string>} The final response text
     */
    async execute(ctx, services) {
        let index = 0;
        const stages = this.stages;

        const next = async () => {
            // Check abort before each stage
            ctx.throwIfAborted();

            // If we've run out of stages, return
            if (index >= stages.length) return;

            // If _skipToFinalize is set, jump to finalize stage
            if (ctx._skipToFinalize && stages[index].name !== 'finalize') {
                // Find finalize stage
                const finalizeIdx = stages.findIndex(s => s.name === 'finalize');
                if (finalizeIdx > index) {
                    index = finalizeIdx;
                }
            }

            const stage = stages[index++];
            const stageName = stage.name;

            try {
                consoleStyler.log('pipeline', `▸ ${stageName}`, { timestamp: true });
                await stage.fn(ctx, services, next);
            } catch (error) {
                // AbortError should propagate up
                if (error.name === 'AbortError') throw error;

                consoleStyler.log('error', `Pipeline stage '${stageName}' failed: ${error.message}`);
                ctx.addError(error, stageName);

                // For critical stages, the error should propagate
                // For non-critical stages, we log and continue
                const criticalStages = new Set(['validate', 'agentLoop', 'finalize']);
                if (criticalStages.has(stageName)) {
                    throw error;
                }

                // Non-critical: continue to next stage
                await next();
            }
        };

        try {
            await next();
        } catch (error) {
            // If we get an abort, let it propagate
            if (error.name === 'AbortError') throw error;

            // For other errors, set a fallback response
            consoleStyler.log('error', `Pipeline failed: ${error.message}`);
            if (!ctx.finalResponse) {
                ctx.finalResponse = `Error: ${error.message}`;
            }
        }

        ctx.complete();
        return ctx.finalResponse || 'The assistant could not determine a final answer.';
    }
}
