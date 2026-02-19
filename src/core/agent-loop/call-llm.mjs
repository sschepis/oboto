// Agent Loop Sub-stage 5c: callLLM
// Sends the prepared messages to the LLM provider and handles errors.

import { consoleStyler } from '../../ui/console-styler.mjs';
import { emitStatus } from '../status-reporter.mjs';
import { getProviderLabel } from '../ai-provider.mjs';

/**
 * Call the LLM with prepared messages and return the response message.
 *
 * @param {import('../request-context.mjs').RequestContext} ctx
 * @param {import('../service-registry.mjs').ServiceRegistry} services
 * @param {Object} modelConfig
 * @param {Array} budgetedMessages
 * @param {number} estimatedTokens
 * @param {boolean} trimmed
 * @returns {Promise<Object>} The response message object
 */
export async function callLLM(ctx, services, modelConfig, budgetedMessages, estimatedTokens, trimmed) {
    const llmAdapter = services.get('llmAdapter');
    const middleware = services.optional('middleware');
    const reasoningSystem = services.optional('reasoningSystem');
    const toolLoader = services.get('toolLoader');
    const allTools = toolLoader.getTools();
    const config = services.get('config');
    const transcriptLogger = services.optional('transcriptLogger');

    const reasoning = ctx.metadata.reasoning || 'medium';

    try {
        const providerLabel = getProviderLabel(modelConfig.modelId);
        emitStatus(`Sending request to ${providerLabel}…`);
        consoleStyler.log('ai', `Sending request to ${providerLabel}...`, { timestamp: true });
        consoleStyler.log('ai', `Context: ${budgetedMessages.length} messages, ~${estimatedTokens} tokens${trimmed ? ' (trimmed)' : ''}`, { indent: true });

        let requestData = {
            model: modelConfig.modelId,
            messages: budgetedMessages,
            tools: allTools,
            tool_choice: 'auto',
            temperature: config.temperature,
            reasoning_effort: modelConfig.supportsReasoningEffort ? reasoning : undefined,
            response_format: ctx.responseFormat,
        };

        if (middleware) {
            requestData = await middleware.execute('pre-request', requestData);
        }

        // Log transcript
        if (transcriptLogger) {
            transcriptLogger.log('REQUEST', modelConfig.modelId, {
                messages: budgetedMessages,
                tools_count: allTools.length,
                params: { temperature: config.temperature, reasoning_effort: reasoning },
            });
        }

        // Call the LLM
        const result = await llmAdapter.generateContent(requestData, { signal: ctx.signal });

        // Log response
        if (transcriptLogger) {
            transcriptLogger.log('RESPONSE', modelConfig.modelId, result);
        }

        if (!result.choices || result.choices.length === 0) {
            throw new Error('Invalid response structure from AI provider.');
        }

        let message = result.choices[0].message;

        // Post-response middleware
        if (middleware) {
            const responseData = await middleware.execute('post-response', { message });
            message = responseData.message;
        }

        return message;

    } catch (error) {
        consoleStyler.log('error', `AI provider communication failed: ${error.message}`, { box: true });

        // Track errors for reasoning system
        if (reasoningSystem) reasoningSystem.addError(error);
        ctx.addError(error, 'callLLM');

        // If it's a fetch error, try to continue with a recovery message
        if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
            consoleStyler.log('recovery', 'API connection failed, attempting to continue task execution');
            return {
                content: 'API connection temporarily failed. Continuing with task execution.',
                tool_calls: [],
            };
        }

        return { content: `Error: ${error.message}.` };
    }
}
