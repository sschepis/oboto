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

        // ── Chime-in: Drain queued user messages ──
        // If the user sent messages while the agent was working (between turns),
        // inject them into the conversation history so the agent sees them as
        // updates to the current task — NOT as separate requests.
        if (ctx.chimeInQueue && ctx.chimeInQueue.length > 0) {
            const historyManager = services.get('historyManager');
            const queued = ctx.chimeInQueue.splice(0); // drain all
            for (const msg of queued) {
                const chimeMsg = `[UPDATE FROM USER (while you were working)]: ${msg}`;
                historyManager.addMessage('user', chimeMsg);
                consoleStyler.log('system', `💬 Chime-in injected: "${msg.substring(0, 80)}${msg.length > 80 ? '...' : ''}"`);
            }
            if (eventBus) eventBus.emitTyped('chime-in:injected', { count: queued.length });
        }

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
            // If a single direct-answer tool already resolved the request
            // (e.g. speak_text, evaluate_math), give the LLM one more turn
            // to produce a textual summary and then stop.  This prevents
            // the scope-violation pattern where the model invents follow-up
            // tasks that were never requested.
            if (ctx.metadata.directAnswerGiven && ctx.turnNumber >= 2) {
                consoleStyler.log('system', 'Direct-answer tool completed — stopping agent loop');
                if (!ctx.finalResponse) {
                    ctx.finalResponse = 'Done.';
                }
                break;
            }
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
