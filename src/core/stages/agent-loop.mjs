// Stage 5: agentLoop
// The iterative LLM/tool execution loop. This is the core of the agent.
// Runs up to maxTurns iterations, each turn: resolve model → build messages →
// call LLM → handle response (tool calls or final text).

import { consoleStyler } from '../../ui/console-styler.mjs';
import { emitStatus } from '../status-reporter.mjs';
import { resolveModelForTurn } from '../agent-loop/resolve-model.mjs';
import { buildMessages } from '../agent-loop/build-messages.mjs';
import { callLLM } from '../agent-loop/call-llm.mjs';
import { handleResponse } from '../agent-loop/handle-response.mjs';

/**
 * @param {import('../request-context.mjs').RequestContext} ctx
 * @param {import('../service-registry.mjs').ServiceRegistry} services
 * @param {Function} next
 */
export async function agentLoop(ctx, services, next) {
    const eventBus = services.optional('eventBus');

    for (let i = 0; i < ctx.maxTurns; i++) {
        ctx.throwIfAborted();
        ctx.turnNumber = i + 1;

        // Show conversation turn progress
        consoleStyler.log('progress', `Processing turn ${ctx.turnNumber}/${ctx.maxTurns}`, { timestamp: true });
        emitStatus(i === 0 ? 'Thinking…' : `Continuing work (turn ${ctx.turnNumber}/${ctx.maxTurns})…`);

        if (eventBus) eventBus.emitTyped('turn:start', { turnNumber: ctx.turnNumber, maxTurns: ctx.maxTurns });

        // Sub-stage 5a: Resolve model for this turn
        const modelConfig = resolveModelForTurn(ctx, services);

        // Sub-stage 5b: Build messages (history + memory + fact context + token budget)
        const { messages: budgetedMessages, estimatedTokens, trimmed } = await buildMessages(ctx, services, modelConfig);

        // Sub-stage 5c: Call LLM
        const responseMessage = await callLLM(ctx, services, modelConfig, budgetedMessages, estimatedTokens, trimmed);

        if (eventBus) eventBus.emitTyped('turn:end', { turnNumber: ctx.turnNumber });

        // Sub-stage 5d: Handle response — branches to tool execution or final text
        const loopDecision = await handleResponse(ctx, services, responseMessage);

        if (loopDecision === 'continue') {
            // Tool calls were executed, loop back for next turn
            continue;
        }

        if (loopDecision === 'done') {
            // Final text response is set on ctx.finalResponse
            break;
        }
    }

    // If we exhausted all turns without a response
    if (!ctx.finalResponse) {
        ctx.finalResponse = 'The assistant could not determine a final answer after multiple steps.';
    }

    await next();
}
