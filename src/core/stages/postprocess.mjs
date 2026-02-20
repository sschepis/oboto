// Stage 7: postprocess
// Runs after the agent loop and quality gate. Handles consciousness
// post-processing, holographic memory storage, and symbolic continuity
// signature generation.

import { consoleStyler } from '../../ui/console-styler.mjs';

/**
 * @param {import('../request-context.mjs').RequestContext} ctx
 * @param {import('../service-registry.mjs').ServiceRegistry} services
 * @param {Function} next
 */
export async function postprocess(ctx, services, next) {
    const consciousness = services.optional('consciousness');
    const symbolicContinuity = services.optional('symbolicContinuity');
    const historyManager = services.get('historyManager');

    // 1. Consciousness post-processing
    if (consciousness && ctx.finalResponse) {
        try {
            const postResult = await consciousness.postProcess(
                ctx.originalInput,
                ctx.finalResponse
            );

            if (postResult?.somatic?.description) {
                consoleStyler.log('debug', `Somatic state: ${postResult.somatic.description}`);
            }
        } catch (err) {
            consoleStyler.log('error', `Consciousness post-processing error: ${err.message}`);
        }
    }

    // 2. Generate symbolic continuity signature
    if (symbolicContinuity && ctx.finalResponse) {
        try {
            await symbolicContinuity.generateSignature(
                ctx.originalInput,
                ctx.finalResponse,
                ctx.toolCallCount || 0
            );
        } catch (err) {
            consoleStyler.log('error', `Symbolic continuity error: ${err.message}`);
        }
    }

    await next();
}
