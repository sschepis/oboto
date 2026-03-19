import { emitStatus, emitCommentary, describeToolCall, buildToolRoundNarrative } from './status-reporter.mjs';
import { isCancellationError } from './ai-provider.mjs';
import { sanitizeDirectMarkdown } from '../lib/sanitize-markdown.mjs';
import { hasToolError, evaluateToolResults } from './agent-loop-helpers.mjs';

/**
 * Execute tool calls from the AI response and return results.
 *
 * Handles:
 * - JSON argument parsing (with error reporting back to the AI)
 * - Dynamic task tools (add_tasks, complete_current_task, fail_current_task)
 * - Regular tool execution via engine.tools
 * - __directMarkdown support for visual widgets
 * - Cancellation via signal
 *
 * @param {object} ctx - Agent loop context
 * @param {object} payload - { toolCalls, input, signal, stream, onChunk }
 * @param {Function} log - Logging function
 * @param {Function} dispatch - Eventic dispatch function
 * @param {object} engine - Engine reference (with tools, ai, etc.)
 * @returns {Promise<object>} - Dispatch result from ACTOR_CRITIC_LOOP
 */
export async function executeTools(ctx, payload, log, dispatch, engine) {
    const { toolCalls, input, signal, stream, onChunk } = payload;
    
    const toolNames = toolCalls.map(tc => tc.function.name);
    const toolNamesStr = toolNames.join(', ');
    emitStatus(`Executing ${toolCalls.length} tool(s): ${toolNamesStr}`);
    
    const results = [];
    
    for (let i = 0; i < toolCalls.length; i++) {
        const toolCall = toolCalls[i];
        // Check cancellation before starting each tool
        if (signal && signal.aborted) {
            log('Execution aborted by user signal');
            break;
        }

        const functionName = toolCall.function.name;
        let toolResultText = '';
        let toolFailed = false;
        
        let args = toolCall.function.arguments;
        let argParseError = null;
        if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch (e) {
                argParseError = e;
                args = {}; // Prevent downstream crashes from string destructuring
            }
        }
        
        // If JSON.parse failed, report a tool error immediately so the AI
        // can see exactly what went wrong and retry with valid JSON.
        // Previously the silent catch left `args` as a raw string, causing
        // confusing downstream crashes (e.g. "Expected ',' or '}' ..." from
        // a secondary JSON.parse in tool-executor.mjs).
        if (argParseError) {
            toolFailed = true;
            const rawSnippet = typeof toolCall.function.arguments === 'string'
                ? toolCall.function.arguments.substring(0, 200) : '(non-string)';
            toolResultText = `Error: Malformed JSON in tool arguments — ${argParseError.message}. ` +
                `The arguments string could not be parsed as valid JSON. ` +
                `Raw arguments (first 200 chars): ${rawSnippet}... ` +
                `Please retry the tool call with properly escaped JSON arguments.`;
            log(`JSON parse error for tool ${functionName}: ${argParseError.message}`);
            
            emitStatus(`Tool ${functionName} failed (malformed arguments)`);
            
            results.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                name: functionName,
                content: toolResultText
            });
            continue;
        }

        // Handle dynamic task tools internally
        if (functionName === 'add_tasks') {
            const tasksToAdd = Array.isArray(args.tasks) ? args.tasks : [args.tasks];
            ctx.tasks = [...ctx.tasks, ...tasksToAdd.map(t => ({ description: t, status: 'pending' }))];
            toolResultText = `Added ${tasksToAdd.length} tasks to the plan.`;
            if (ctx.eventBus) {
                ctx.eventBus.emit('agent:tasks-updated', {
                    tasks: ctx.tasks.map(t => ({ description: typeof t === 'string' ? t : t.description, status: typeof t === 'string' ? 'pending' : t.status })),
                    completedTasks: ctx.completedTasks,
                    requestId: ctx.requestId,
                });
            }
        } else if (functionName === 'complete_current_task') {
            if (ctx.tasks.length > 0) {
                const completed = ctx.tasks.shift();
                completed.status = 'completed';
                completed.result = args.result || 'Task completed successfully.';
                ctx.completedTasks.push(completed);
                toolResultText = `Task marked as completed. Moved to completed list.`;
                if (ctx.eventBus) {
                    ctx.eventBus.emit('agent:task-completed', {
                        task: completed,
                        remainingTasks: ctx.tasks.length,
                        completedTasks: ctx.completedTasks.length,
                        requestId: ctx.requestId,
                    });
                }
            } else {
                toolResultText = `Error: No current task to complete.`;
                toolFailed = true;
            }
        } else if (functionName === 'fail_current_task') {
             if (ctx.tasks.length > 0) {
                const failed = ctx.tasks.shift();
                failed.status = 'failed';
                failed.result = args.reason || 'Task failed.';
                ctx.completedTasks.push(failed);
                toolResultText = `Task marked as failed. Moved to completed list.`;
                if (ctx.eventBus) {
                    ctx.eventBus.emit('agent:task-failed', {
                        task: failed,
                        remainingTasks: ctx.tasks.length,
                        completedTasks: ctx.completedTasks.length,
                        requestId: ctx.requestId,
                    });
                }
            } else {
                toolResultText = `Error: No current task to fail.`;
                toolFailed = true;
            }
        } else {
            // Regular tool execution
            const toolFunction = engine.tools.get(functionName);
            
            // Emit per-tool start status with description
            const toolDesc = describeToolCall(functionName, args || {});
            if (toolCalls.length > 1) {
                emitStatus(`Running tool ${i + 1}/${toolCalls.length}: ${toolDesc}`);
            } else {
                emitStatus(`Running tool: ${toolDesc}`);
            }
            
            if (toolFunction) {
                try {
                    // Pass signal to tool function
                    toolResultText = await toolFunction(args, { signal });
                    // Handle __directMarkdown: plugins can return { __directMarkdown: "..." }
                    // to inject markdown (e.g. code fences for tradingchart, mathanim) directly
                    // into the assistant's response instead of being shown as raw JSON.
                    if (toolResultText && typeof toolResultText === 'object' && toolResultText.__directMarkdown) {
                        const mdBlock = sanitizeDirectMarkdown(toolResultText.__directMarkdown);
                        toolResultText = mdBlock;
                        // Accumulate for appending to the AI's final text response so the
                        // UI's MarkdownRenderer can render special code fences (tradingchart, etc.)
                        // even when the AI paraphrases instead of echoing the code fence.
                        if (ctx.directMarkdownBlocks) {
                            ctx.directMarkdownBlocks.push(mdBlock);
                        }
                    }
                } catch (e) {
                    toolFailed = true;
                    if (isCancellationError(e) || (signal && signal.aborted)) {
                        toolResultText = 'Error: Tool execution cancelled by user.';
                    } else {
                        toolResultText = `Error: ${e.message}`;
                    }
                }
            } else {
                toolResultText = `Error: Unknown tool: ${functionName}`;
                toolFailed = true;
            }
        }
        
        // Emit per-tool completion status using the flag set in the
        // catch/unknown-tool branches rather than brittle text matching.
        emitStatus(`Tool ${functionName} ${toolFailed ? 'failed' : 'completed'}`);
        
        results.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: functionName,
            content: typeof toolResultText === 'string' ? toolResultText : JSON.stringify(toolResultText)
        });
    }
    
    ctx.toolCallCount = (ctx.toolCallCount || 0) + toolCalls.length;
    
    // Update running task with tool result summary
    if (ctx.tasks && ctx.tasks.length > 0) {
        // we always process the first task in the list
        let currentTask = ctx.tasks[0];
        
        // If it's just a string, convert to object to hold state
        if (typeof currentTask === 'string') {
            currentTask = { description: currentTask, status: 'running' };
            ctx.tasks[0] = currentTask;
        }
        
        currentTask.status = 'running';
        
        // We just store a summary of the latest tool execution for context
        const summaries = results.map(res => {
            const content = res.content || '';
            const isError = hasToolError(content);
            return `${isError ? '❌ Error in' : '✅'} ${res.name}: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`;
        });
        currentTask.result = summaries.join(' | ');
    }
    
    // Push tool results to AI provider history.
    // Truncate excessively large results (e.g. base64 screenshots from
    // capture_surface) before they enter history — they bloat context and
    // can cause the model to stall on the next turn with minimal output.
    if (engine.ai && typeof engine.ai.conversationHistory !== 'undefined') {
        for (const res of results) {
            const historyEntry = { ...res };
            if (typeof historyEntry.content === 'string' && historyEntry.content.length > 8000) {
                // Try to detect and strip base64 image data from JSON tool output
                // (e.g. capture_surface returns {screenshot: "<base64>..."})
                try {
                    const parsed = JSON.parse(historyEntry.content);
                    if (parsed && parsed.screenshot && typeof parsed.screenshot === 'string' && parsed.screenshot.length > 1000) {
                        parsed.screenshot = '[screenshot captured and displayed to user — image data omitted from context to save tokens]';
                        historyEntry.content = JSON.stringify(parsed);
                    }
                } catch {
                    // Not JSON — just truncate if over 12K chars
                    if (historyEntry.content.length > 12000) {
                        historyEntry.content = historyEntry.content.substring(0, 12000) +
                            '\n\n[... truncated — full result was ' + res.content.length + ' chars]';
                    }
                }
            }
            engine.ai.conversationHistory.push(historyEntry);
        }
    }

    // Track tool calls in consciousness processor
    if (ctx.consciousness) {
         ctx.consciousness.trackToolCalls(toolCalls, results);
    }

    // ── Emit narrative commentary after tool execution ──
    // Build and emit a human-readable summary so the user sees a
    // clear verbal callout of what was just done on each iteration.
    const narrative = buildToolRoundNarrative(results);
    if (narrative) {
        emitCommentary(`🔧 ${narrative} Sending results back to AI for next steps…`);
    } else {
        emitStatus(`All ${toolCalls.length} tool(s) completed — sending results back to AI`);
    }
    
    if (ctx.stateManager) {
        await ctx.stateManager.syncHistory(engine);
        await ctx.stateManager.checkpoint(ctx, engine, { phase: 'POST_TOOLS' });
    }

    // Inline tool evaluation (formerly CRITIC_EVALUATE_TOOLS handler).
    const guidance = evaluateToolResults(ctx, toolNames, results);

    if (guidance) {
        log(`Tool evaluation guidance: ${guidance}`);
        emitCommentary(`📋 ${guidance}`);
        return await dispatch('ACTOR_CRITIC_LOOP', { input, guidance, signal, stream, onChunk });
    }

    return await dispatch('ACTOR_CRITIC_LOOP', { input, signal, stream, onChunk });
}
