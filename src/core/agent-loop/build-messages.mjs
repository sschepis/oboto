// Agent Loop Sub-stage 5b: buildMessages
// Retrieves conversation history, injects memory and fact context,
// applies token budget trimming.

import { fitToBudget } from '../prompt-router.mjs';

/**
 * Build the message array for the LLM call, applying memory injection
 * and token budgeting.
 *
 * @param {import('../request-context.mjs').RequestContext} ctx
 * @param {import('../service-registry.mjs').ServiceRegistry} services
 * @param {Object} modelConfig
 * @returns {Promise<{messages: Array, estimatedTokens: number, trimmed: boolean}>}
 */
export async function buildMessages(ctx, services, modelConfig) {
    const historyManager = services.get('historyManager');
    const memoryAdapter = services.optional('memoryAdapter');
    const consciousness = services.optional('consciousness');

    // Get recent exchanges (keep context focused)
    const rawMessages = historyManager.getLastExchanges(5);

    // Inject memory context if available (before budgeting)
    if (memoryAdapter) {
        const lastUserMsg = rawMessages.filter(m => m.role === 'user').pop();
        if (lastUserMsg && !lastUserMsg._contextInjected) {
            try {
                const memories = await memoryAdapter.retrieve(lastUserMsg.content, 5);
                if (memories && memories.length > 0) {
                    const contextBlock = memories.map(m => `[Relevant context]: ${m.text}`).join('\n');
                    const contextMsg = { role: 'system', content: `RETRIEVED CONTEXT:\n${contextBlock}` };
                    rawMessages.splice(1, 0, contextMsg);
                    lastUserMsg._contextInjected = true;
                }
            } catch (e) {
                // Ignore memory retrieval errors
            }

            // Inject fact engine context alongside holographic memory
            if (consciousness) {
                const factContext = consciousness.renderFactContext(lastUserMsg.content);
                if (factContext) {
                    rawMessages.splice(1, 0, { role: 'system', content: factContext });
                }
            }
        }
    }

    // Apply token budget
    const { messages, trimmed, estimatedTokens } = fitToBudget(
        rawMessages,
        modelConfig.contextWindow,
        modelConfig.maxOutputTokens
    );

    return { messages, estimatedTokens, trimmed };
}
