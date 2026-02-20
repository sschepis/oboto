// Agent Loop Sub-stage 5d: handleResponse
// Branches on the LLM response: if tool calls present, execute them and
// signal "continue" for the next loop iteration. If text response, signal "done".

import { consoleStyler } from '../../ui/console-styler.mjs';
import { emitStatus } from '../status-reporter.mjs';

// Tools that share mutable state and must execute sequentially
const STATEFUL_TOOL_GROUPS = [
    new Set(['browse_open', 'browse_act', 'browse_screenshot', 'browse_close']),
    new Set(['create_surface', 'update_surface_component', 'delete_surface', 'capture_surface', 'list_surfaces']),
];

/**
 * Check if a set of tool calls can be parallelized safely.
 * Read-only tools can always parallelize. Write tools with
 * overlapping file paths cannot. Tools in the same stateful
 * group (e.g. browser tools) must run sequentially.
 */
function canParallelizeTools(toolCalls) {
    const readOnlyTools = new Set(['read_file', 'list_files', 'search_web', 'read_manifest',
        'read_conversation_history', 'query_global_memory', 'evaluate_math']);
    const toolNames = toolCalls.map(tc => tc.function.name);

    // Stateful group check: serialize if 2+ tools are in the same group
    for (const group of STATEFUL_TOOL_GROUPS) {
        if (toolNames.filter(n => group.has(n)).length > 1) return false;
    }

    // Path-conflict check for write tools
    const writePaths = new Set();
    for (const tc of toolCalls) {
        if (readOnlyTools.has(tc.function.name)) continue;
        try {
            const args = JSON.parse(tc.function.arguments);
            if (args.path && writePaths.has(args.path)) return false;
            if (args.path) writePaths.add(args.path);
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
            let lastFailedGroup = null; // Track failed stateful group for short-circuit
            
            for (const toolCall of toolCalls) {
                const toolName = toolCall.function.name;
                
                // Short-circuit: if a previous tool in the same stateful group failed,
                // skip subsequent tools in that group with an informative error
                if (lastFailedGroup) {
                    const inFailedGroup = lastFailedGroup.has(toolName);
                    if (inFailedGroup) {
                        consoleStyler.log('warning', `Skipping ${toolName} — previous tool in group failed`);
                        const skipResult = {
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: `Error: Skipped because a prior tool in the same group failed. The browser session is not available.`,
                        };
                        historyManager.pushMessage(skipResult);
                        continue;
                    }
                }
                
                consoleStyler.log('working', `Executing tool: ${toolName}`);
                if (statusAdapter) statusAdapter.onToolStart(toolName, toolCall.function.arguments);

                const toolResult = await toolExecutor.executeTool(toolCall, { signal: ctx.signal });
                if (statusAdapter) statusAdapter.onToolEnd(toolName, toolResult);

                const success = !toolResult.content.startsWith('Error:');
                if (success) {
                    consoleStyler.log('tools', `✓ Tool completed: ${toolName}`);
                } else {
                    consoleStyler.log('error', `✗ Tool failed: ${toolName} - ${toolResult.content.substring(0, 80)}...`);
                    
                    // Check if this tool belongs to a stateful group — if so, mark group as failed
                    for (const group of STATEFUL_TOOL_GROUPS) {
                        if (group.has(toolName)) {
                            lastFailedGroup = group;
                            break;
                        }
                    }
                }

                historyManager.pushMessage(toolResult);

                // Track in consciousness processor
                if (consciousness) consciousness.trackToolCalls([toolCall], [toolResult]);
            }
        }

        ctx.toolCallCount += toolCalls.length;

        // Track if a single direct-answer tool resolved the request.
        // Used by the agent loop to prevent unrequested follow-up tool calls.
        if (toolCalls.length === 1) {
            const name = toolCalls[0].function.name;
            const directAnswerTools = new Set([
                'speak_text', 'evaluate_math', 'unit_conversion',
                'search_web', 'query_global_memory',
            ]);
            if (directAnswerTools.has(name)) {
                ctx.metadata.directAnswerGiven = true;
            }
        }

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
