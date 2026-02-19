// Agent Loop Sub-stage 5d: handleResponse
// Branches on the LLM response: if tool calls present, execute them and
// signal "continue" for the next loop iteration. If text response, signal "done".

import { consoleStyler } from '../../ui/console-styler.mjs';
import { emitStatus } from '../status-reporter.mjs';

/**
 * Check if a set of tool calls can be parallelized safely.
 * Read-only tools can always parallelize. Write tools with
 * overlapping file paths cannot.
 */
function canParallelizeTools(toolCalls) {
    const readOnlyTools = new Set(['read_file', 'list_files', 'search_web', 'read_manifest']);
    const writeTools = new Set();

    for (const tc of toolCalls) {
        if (readOnlyTools.has(tc.function.name)) continue;
        try {
            const args = JSON.parse(tc.function.arguments);
            if (args.path && writeTools.has(args.path)) return false;
            if (args.path) writeTools.add(args.path);
        } catch {
            return false;
        }
    }
    return true;
}

/**
 * Handle the LLM response message.
 *
 * @param {import('../request-context.mjs').RequestContext} ctx
 * @param {import('../service-registry.mjs').ServiceRegistry} services
 * @param {Object} responseMessage - The LLM response message
 * @returns {Promise<'continue'|'done'>} Loop control signal
 */
export async function handleResponse(ctx, services, responseMessage) {
    const historyManager = services.get('historyManager');
    const toolExecutor = services.get('toolExecutor');
    const consciousness = services.optional('consciousness');
    const statusAdapter = services.optional('statusAdapter');

    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        // ── Tool Call Branch ──
        const toolNames = responseMessage.tool_calls.map(tc => tc.function.name).join(', ');

        // Diagnostic log
        if (responseMessage.content && responseMessage.content.length > 0) {
            consoleStyler.log('debug', `[DIAGNOSTIC] Assistant content with tool call: "${responseMessage.content.substring(0, 100)}..."`);
        }

        consoleStyler.log('tools', `Initiating ${responseMessage.tool_calls.length} tool call(s): ${toolNames}`);
        emitStatus(`Executing ${responseMessage.tool_calls.length} tool(s)…`);

        historyManager.pushMessage(responseMessage);

        const toolCalls = responseMessage.tool_calls;
        const parallel = canParallelizeTools(toolCalls);

        if (parallel && toolCalls.length > 1) {
            // Parallel execution
            consoleStyler.log('tools', `Running ${toolCalls.length} tools in parallel`);

            for (const toolCall of toolCalls) {
                consoleStyler.log('working', `Executing tool (parallel): ${toolCall.function.name}`);
                if (statusAdapter) statusAdapter.onToolStart(toolCall.function.name, toolCall.function.arguments);
            }

            const results = await Promise.all(
                toolCalls.map(async (toolCall) => {
                    const result = await toolExecutor.executeTool(toolCall, { signal: ctx.signal });
                    if (statusAdapter) statusAdapter.onToolEnd(toolCall.function.name, result);
                    return result;
                })
            );

            for (const result of results) {
                historyManager.pushMessage(result);
            }

            // Track tool calls in consciousness processor
            if (consciousness) consciousness.trackToolCalls(toolCalls, results);
        } else {
            // Sequential execution
            for (const toolCall of toolCalls) {
                consoleStyler.log('working', `Executing tool: ${toolCall.function.name}`);

                const toolResult = await toolExecutor.executeTool(toolCall, { signal: ctx.signal });

                const success = !toolResult.content.startsWith('Error:');
                if (success) {
                    consoleStyler.log('tools', `✓ Tool completed: ${toolCall.function.name}`);
                } else {
                    consoleStyler.log('error', `✗ Tool failed: ${toolCall.function.name} - ${toolResult.content.substring(0, 50)}...`);
                }

                historyManager.pushMessage(toolResult);

                // Track in consciousness processor
                if (consciousness) consciousness.trackToolCalls([toolCall], [toolResult]);
            }
        }

        ctx.toolCallCount += toolCalls.length;
        consoleStyler.log('tools', 'All tool calls completed. Continuing conversation...');
        return 'continue';

    } else {
        // ── Text Response Branch ──
        ctx.finalResponse = responseMessage.content;

        // If streaming, emit the response chunk
        if (ctx.stream && ctx.onChunk) {
            ctx.onChunk(ctx.finalResponse);
        }

        return 'done';
    }
}
