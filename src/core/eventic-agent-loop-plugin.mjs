import { emitStatus } from './status-reporter.mjs';

function setupErrorListener(ctx) {
    if (ctx.eventBus && !ctx.errorListener) {
        ctx.pendingErrors = [];
        ctx.errorListener = (err) => {
            if (err.type === 'unhandledRejection' || err.type === 'uncaughtException') {
                const msg = `[SYSTEM ERROR] Unhandled background error: ${err.message}`;
                ctx.pendingErrors.push(msg);
                // Force status update
                emitStatus(`⚠️ Error detected: ${err.message.substring(0, 50)}...`);
            }
        };
        ctx.eventBus.on('system:error', ctx.errorListener);
    }
}

function cleanupErrorListener(ctx) {
    if (ctx.eventBus && ctx.errorListener) {
        ctx.eventBus.off('system:error', ctx.errorListener);
        ctx.errorListener = null;
    }
}

const CRITIC_PRECHECK_PROMPT = `You are a request classifier. Classify into ONE category:

**FAST_PATH** — Simple query you can answer immediately (greetings, general knowledge, short code).
**CLARIFY** — Too vague. Ask ONE clarifying question.
**PROCEED** — Requires tools, file access, or deep reasoning.

Return JSON:
{
  "status": "FAST_PATH" | "CLARIFY" | "PROCEED",
  "response": "answer if FAST_PATH",
  "question": "clarifying question if CLARIFY",
  "reasoning": "one sentence"
}`;

export const EventicAgentLoopPlugin = {
    install(eventic) {
        eventic.registerHandler("AGENT_START", async (ctx, payload, log, dispatch, engine) => {
            const { input, signal, stream, onChunk } = payload;
            
            if (ctx.consciousness && !ctx.consciousness.initialized) {
                await ctx.consciousness.initialize();
                ctx.consciousness.initialized = true;
            }

            // Pre-process with consciousness (somatic/fact tracking)
            if (ctx.consciousness) {
                const history = engine.ai ? engine.ai.conversationHistory || [] : [];
                ctx.consciousness.preProcess(input, { history });
            }

            ctx.turnNumber = 0;
            ctx.maxTurns = 30;
            ctx.toolCallCount = 0;
            ctx.retryCount = 0;
            ctx.startedAt = new Date().toISOString();
            ctx.originalInput = input;
            ctx.requestId = `evt-${Date.now()}`;
            
            // Task context: accumulates across the entire request lifecycle
            ctx.completedActions = []; // { tool, status, result_summary }
            ctx.errors = []; // errors encountered
            
            if (ctx.stateManager) {
                ctx.stateManager.loadHistory(engine);
                await ctx.stateManager.syncHistory(engine);
                await ctx.stateManager.checkpoint(ctx, engine, { phase: 'AGENT_START' });
            }

            // Setup error listener for background tasks (floating promises)
            setupErrorListener(ctx);

            log("Running critic pre-check...");
            
            // We use Eventic AI plugin's ask function.
            try {
                const preCheckAnalysis = await engine.ai.ask(CRITIC_PRECHECK_PROMPT + `\n\nInput: ${input}`, {
                    format: 'json',
                    recordHistory: false,
                    schema: {
                        type: "object",
                        properties: {
                            status: { type: "string" },
                            response: { type: "string" },
                            question: { type: "string" },
                            reasoning: { type: "string" }
                        },
                        required: ["status"]
                    }
                });

                if (preCheckAnalysis.status === 'FAST_PATH' && preCheckAnalysis.response) {
                    log("Critic: Fast-path response");
                    if (ctx.stateManager) {
                        await ctx.stateManager.syncHistory(engine);
                        await ctx.stateManager.complete(ctx);
                    }
                    cleanupErrorListener(ctx);
                    return { completed: true, response: preCheckAnalysis.response };
                }

                if (preCheckAnalysis.status === 'CLARIFY' && preCheckAnalysis.question) {
                    log("Critic: Needs clarification");
                    if (ctx.stateManager) {
                        await ctx.stateManager.syncHistory(engine);
                        await ctx.stateManager.complete(ctx);
                    }
                    cleanupErrorListener(ctx);
                    return { completed: true, response: preCheckAnalysis.question };
                }

                log("Critic: Proceeding to actor-critic loop");
            } catch (e) {
                log(`Critic pre-check failed or skipped: ${e.message}`);
            }

            return await dispatch('ACTOR_CRITIC_LOOP', { input, signal, stream, onChunk });
        });

        eventic.registerHandler("ACTOR_CRITIC_LOOP", async (ctx, payload, log, dispatch, engine) => {
            const { input, guidance, signal, stream, onChunk } = payload;
            ctx.turnNumber++;

            if (ctx.turnNumber > ctx.maxTurns) {
                if (ctx.stateManager) {
                    await ctx.stateManager.syncHistory(engine);
                    await ctx.stateManager.complete(ctx);
                }
                cleanupErrorListener(ctx);
                return { completed: true, response: "Could not complete the task within the allowed turns." };
            }

            if (ctx.stateManager) {
                await ctx.stateManager.syncHistory(engine);
                await ctx.stateManager.checkpoint(ctx, engine, { phase: 'ACTOR_CRITIC_LOOP', guidance });
            }

            emitStatus(ctx.turnNumber === 1 ? 'Analyzing request…' : `Working (turn ${ctx.turnNumber})…`);
            log(`Turn ${ctx.turnNumber}/${ctx.maxTurns}`);

            let tools = [];
            if (typeof engine.getAvailableTools === 'function') {
                tools = engine.getAvailableTools();
            }

            let prompt;
            if (ctx.turnNumber === 1) {
                prompt = input;
            } else {
                // Build context-aware continuation prompt with full task awareness
                const parts = [];
                
                // Always remind the AI of the original task
                parts.push(`[ORIGINAL TASK]: ${ctx.originalInput}`);
                parts.push(`[TURN ${ctx.turnNumber}/${ctx.maxTurns}]`);
                parts.push('');
                
                // Show errors first (most important — the AI MUST see these)
                if (ctx.errors.length > 0) {
                    parts.push(`⚠️ [ERRORS FROM PREVIOUS ACTIONS — YOU MUST ADDRESS THESE]:`);
                    for (const err of ctx.errors) {
                        parts.push(`  ❌ ${err.tool}: ${err.error}`);
                    }
                    parts.push('');
                    ctx.errors = [];
                }
                
                // Show recent completed actions for context
                if (ctx.completedActions.length > 0) {
                    const recent = ctx.completedActions.slice(-5);
                    parts.push(`[COMPLETED ACTIONS (${ctx.completedActions.length} total)]:`);
                    for (const action of recent) {
                        const icon = action.status === 'error' ? '❌' : '✅';
                        parts.push(`  ${icon} ${action.tool}: ${action.summary}`);
                    }
                    parts.push('');
                }
                
                parts.push('Review the tool results in your conversation history above. If there were errors, fix them before proceeding. Continue working on the original task.');
                prompt = parts.join('\n');
            }
            
            if (guidance) {
                prompt = `[GUIDANCE]: ${guidance}\n\n${prompt}`;
            }

            // Inject pending background errors if any
            if (ctx.pendingErrors && ctx.pendingErrors.length > 0) {
                const uniqueErrors = [...new Set(ctx.pendingErrors)];
                const errorBlock = uniqueErrors.join('\n');
                prompt += `\n\n[SYSTEM WARNING]: Background errors detected:\n${errorBlock}`;
                ctx.pendingErrors = [];
                log(`Injected ${uniqueErrors.length} pending error(s) into context`);
            }

            const response = await engine.ai.ask(prompt, { tools, signal, stream, onChunk });

            if (response && response.toolCalls && response.toolCalls.length > 0) {
                return await dispatch('EXECUTE_TOOLS', { toolCalls: response.toolCalls, input, signal, stream, onChunk });
            } else if (typeof response === 'string' || (response && response.content)) {
                return await dispatch('EVALUATE_TEXT_RESPONSE', { 
                    content: typeof response === 'string' ? response : response.content, 
                    input, signal, stream, onChunk 
                });
            } else {
                // Failsafe
                return { completed: true, response: "No valid action generated by AI." };
            }
        });

        eventic.registerHandler("EXECUTE_TOOLS", async (ctx, payload, log, dispatch, engine) => {
            const { toolCalls, input, signal, stream, onChunk } = payload;
            
            const toolNames = toolCalls.map(tc => tc.function.name).join(', ');
            emitStatus(`Executing: ${toolNames}`);
            log(`Executing ${toolCalls.length} tool(s): ${toolNames}`);
            
            const results = [];
            
            for (const toolCall of toolCalls) {
                // Check cancellation before starting each tool
                if (signal && signal.aborted) {
                    log('Execution aborted by user signal');
                    break; 
                }

                const functionName = toolCall.function.name;
                const toolFunction = engine.tools.get(functionName);
                
                let toolResultText = '';
                if (toolFunction) {
                    try {
                        let args = toolCall.function.arguments;
                        if (typeof args === 'string') {
                            try { args = JSON.parse(args); } catch (e) {}
                        }
                        // Pass signal to tool function
                        toolResultText = await toolFunction(args, { signal });
                    } catch (e) {
                        if (e.name === 'AbortError' || (signal && signal.aborted)) {
                            toolResultText = 'Error: Tool execution cancelled by user.';
                        } else {
                            toolResultText = `Error: ${e.message}`;
                        }
                    }
                } else {
                    toolResultText = `Error: Unknown tool: ${functionName}`;
                }
                
                results.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    name: functionName,
                    content: typeof toolResultText === 'string' ? toolResultText : JSON.stringify(toolResultText)
                });
            }
            
            ctx.toolCallCount = (ctx.toolCallCount || 0) + toolCalls.length;
            
            // Record results in task context for subsequent turns
            for (const res of results) {
                const content = res.content || '';
                // Use structured detection: check for explicit error prefix pattern
                // (tools return "Error: ..." as their convention)
                const isError = /^error:/i.test(content.trim());
                const summary = content.substring(0, 150) + (content.length > 150 ? '...' : '');
                
                const action = {
                    tool: res.name,
                    status: isError ? 'error' : 'success',
                    summary
                };
                ctx.completedActions.push(action);
                
                if (isError) {
                    ctx.errors.push({ tool: res.name, error: summary });
                }
            }
            
            // Push tool results to AI provider history
            if (engine.ai && typeof engine.ai.conversationHistory !== 'undefined') {
                for (const res of results) {
                    engine.ai.conversationHistory.push(res);
                }
            }

            // Track tool calls in consciousness processor
            if (ctx.consciousness) {
                 ctx.consciousness.trackToolCalls(toolCalls, results);
            }

            emitStatus(`Completed ${toolCalls.length} tool(s), evaluating…`);
            
            if (ctx.stateManager) {
                await ctx.stateManager.syncHistory(engine);
                await ctx.stateManager.checkpoint(ctx, engine, { phase: 'POST_TOOLS' });
            }

            // Critic Evaluate Tools
            return await dispatch('CRITIC_EVALUATE_TOOLS', { toolCalls, results, input, signal, stream, onChunk });
        });

        eventic.registerHandler("CRITIC_EVALUATE_TOOLS", async (ctx, payload, log, dispatch, engine) => {
            const { toolCalls, results, input, signal, stream, onChunk } = payload;
            
            const toolNames = toolCalls.map(tc => tc.function.name);
            const completionTools = [
                'speak_text', 'evaluate_math', 'web_search', 'generate_image',
                'update_surface_component', 'create_surface', 'attempt_completion',
                'write_file', 'create_file', 'execute_command'
            ];
            
            const hasCompletionTool = toolNames.some(name => completionTools.includes(name));
            // Use the structured error tracking from EXECUTE_TOOLS rather than
            // re-parsing content strings (which can false-positive on words like "failed")
            const allSucceeded = ctx.errors.length === 0;

            let action = 'continue';
            let guidance = '';

            if (hasCompletionTool && allSucceeded) {
                if (toolNames.includes('update_surface_component') || 
                    toolNames.includes('create_surface') ||
                    toolNames.includes('attempt_completion')) {
                    action = 'wrapup';
                    guidance = 'Tool completed successfully. Provide a brief summary response to the user.';
                }
            }

            if (ctx.toolCallCount > 25) {
                action = 'correct';
                guidance = 'You have made many tool calls. Focus on completing the original request. Provide your response now.';
            } else if (ctx.turnNumber >= (ctx.maxTurns - 2) && action === 'continue') {
                action = 'correct';
                guidance = `You are approaching the turn limit (${ctx.maxTurns}). Summarize what you have done and provide your final response.`;
            }

            if (action === 'wrapup' || action === 'correct') {
                log(`Critic Guidance: ${guidance}`);
                return await dispatch('ACTOR_CRITIC_LOOP', { input, guidance, signal, stream, onChunk });
            }

            return await dispatch('ACTOR_CRITIC_LOOP', { input, signal, stream, onChunk });
        });

        eventic.registerHandler("EVALUATE_TEXT_RESPONSE", async (ctx, payload, log, dispatch, engine) => {
            const { content, input, signal, stream, onChunk } = payload;
            
            let action = 'accept';
            let guidance = '';

            if (input.trim().length < 50 && content.length > 20) {
                action = 'accept';
            // Heuristic: only flag extremely terse responses (< 30 chars) to long inputs (> 200 chars).
            // A higher threshold (e.g. 100) caused false-positive retries for valid short answers
            // to verbose questions. 30 chars catches truly empty/broken responses without penalising
            // legitimately concise replies.
            } else if (input.length > 200 && content.length < 30) {
                action = 'retry';
                guidance = 'Response is too brief for the complexity of the question. Provide more detail.';
            } else if (content.toLowerCase().includes("i can't") || content.toLowerCase().includes("i cannot")) {
                if (!content.toLowerCase().includes('because') && !content.toLowerCase().includes('however')) {
                    action = 'retry';
                    guidance = 'You said you cannot do something. Explain why, or attempt an alternative approach.';
                }
            }

            if (action === 'retry' && ctx.retryCount < 2) {
                ctx.retryCount++;
                log(`Critic Guidance (Retry): ${guidance}`);
                return await dispatch('ACTOR_CRITIC_LOOP', { input, guidance: `[QUALITY CHECK FAILED]: ${guidance}\nPlease try again with the above guidance.`, signal, stream, onChunk });
            }

            emitStatus('Response ready');

            // Post process with consciousness
            if (ctx.consciousness) {
                await ctx.consciousness.postProcess(content);
            }

            if (ctx.stateManager) {
                await ctx.stateManager.syncHistory(engine);
                await ctx.stateManager.complete(ctx);
            }
            
            cleanupErrorListener(ctx);
            return { completed: true, response: content };
        });
        
        // Ensure legacy synthetic support
        eventic.registerHandler("SYNTHESIZE_RESPONSE", async (ctx, payload, log, dispatch, engine) => {
             return { completed: true, response: payload.message || "Done" };
        });
    }
};
