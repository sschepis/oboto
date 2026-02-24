import { emitStatus } from './status-reporter.mjs';
import { isCancellationError } from './ai-provider.mjs';

/**
 * Gracefully clean up error listeners and persist state on early exit
 * (cancellation, fatal error, etc.).
 * Wrapped in try/catch so cleanup failures never mask the original error.
 */
async function gracefulCleanup(ctx, engine) {
    cleanupErrorListener(ctx);
    if (ctx.stateManager) {
        try {
            await ctx.stateManager.syncHistory(engine);
            await ctx.stateManager.complete(ctx);
        } catch (e) {
            // Best-effort cleanup — don't mask the original error
            console.error('[gracefulCleanup] State persistence failed:', e.message);
        }
    }
}

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

// Direct-answer precheck: the model answers immediately or signals it needs tools.
// No classification envelope — if it can answer, it just answers.
const PROCEED_SENTINEL = '___AGENT_PROCEED___';
const PRECHECK_PROMPT = `Answer the following directly if you can. If the request is too vague, ask one clarifying question. If it requires tools, file access, or multi-step reasoning, respond with exactly: ${PROCEED_SENTINEL}`;

// Tools that signal the agent should wrap up with a summary when they succeed
const WRAPUP_TOOLS = new Set([
    'update_surface_component', 'create_surface', 'attempt_completion'
]);

/**
 * Evaluate a text response inline — returns { action, guidance } without dispatching.
 * Replaces the former EVALUATE_TEXT_RESPONSE handler.
 */
function evaluateTextResponse(content, input, retryCount) {
    // Short input + non-trivial response → accept
    if (input.trim().length < 50 && content.length > 20) {
        return { action: 'accept', guidance: '' };
    }
    // Extremely terse response to a long/complex input → retry
    // Threshold of 30 chars avoids false-positives on legitimately concise replies
    if (input.length > 200 && content.length < 30 && retryCount < 2) {
        return {
            action: 'retry',
            guidance: 'Response is too brief for the complexity of the question. Provide more detail.'
        };
    }
    // Bare refusal without explanation → retry
    const lower = content.toLowerCase();
    if ((lower.includes("i can't") || lower.includes("i cannot")) &&
        !lower.includes('because') && !lower.includes('however') &&
        retryCount < 2) {
        return {
            action: 'retry',
            guidance: 'You said you cannot do something. Explain why, or attempt an alternative approach.'
        };
    }
    return { action: 'accept', guidance: '' };
}

/**
 * Evaluate tool results inline — returns guidance string or null.
 * Replaces the former CRITIC_EVALUATE_TOOLS handler.
 */
function evaluateToolResults(ctx, toolNames) {
    const allSucceeded = ctx.errors.length === 0;

    // Wrap-up tool succeeded → ask the model for a brief summary
    if (allSucceeded && toolNames.some(name => WRAPUP_TOOLS.has(name))) {
        return 'Tool completed successfully. Provide a brief summary response to the user.';
    }

    // Too many tool calls → force completion
    if (ctx.toolCallCount > 25) {
        return 'You have made many tool calls. Focus on completing the original request. Provide your response now.';
    }

    // Approaching turn limit → force completion
    if (ctx.turnNumber >= (ctx.maxTurns - 2)) {
        return `You are approaching the turn limit (${ctx.maxTurns}). Summarize what you have done and provide your final response.`;
    }

    // Tools produced errors but no other trigger fired → nudge the model to address them
    if (!allSucceeded) {
        return 'Some tools encountered errors. Review the errors and fix them before continuing.';
    }

    // No guidance — continue normally
    return null;
}

export const EventicAgentLoopPlugin = {
    install(eventic) {
        eventic.registerHandler("AGENT_START", async (ctx, payload, log, dispatch, engine) => {
            const { input, signal, stream, onChunk } = payload;
            
            if (ctx.consciousness && !ctx.consciousness.initialized) {
                await ctx.consciousness.initialize();
                ctx.consciousness.initialized = true;
            }

            // Pre-process with consciousness (somatic/fact tracking).
            // preProcess returns system messages (e.g. somatic self-awareness) that
            // should be injected into the conversation history so the AI can see them.
            // Wrapped in try/catch because consciousness is non-critical — a crash
            // here must not prevent the agent loop from running.
            if (ctx.consciousness) {
                try {
                    const history = engine.ai ? engine.ai.conversationHistory || [] : [];
                    const { messages: consciousnessMessages } = ctx.consciousness.preProcess(input, { history });
                    if (consciousnessMessages?.length > 0 && engine.ai?.conversationHistory) {
                        for (const msg of consciousnessMessages) {
                            engine.ai.conversationHistory.push(msg);
                        }
                    }
                } catch (e) {
                    console.error('[AGENT_START] Consciousness preProcess failed:', e);
                }
            }

            ctx.turnNumber = 0;
            ctx.maxTurns = 30;
            ctx.toolCallCount = 0;
            ctx.retryCount = 0;
            ctx.aiRetryCount = 0;
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

            log("Running pre-check...");
            
            // Direct-answer precheck: model answers immediately or signals __PROCEED__
            try {
                const preCheckResponse = await engine.ai.ask(
                    PRECHECK_PROMPT + `\n\nInput: ${input}`,
                    { recordHistory: false }
                );

                const responseText = (typeof preCheckResponse === 'string'
                    ? preCheckResponse
                    : preCheckResponse?.content || '').trim();

                // If the model can answer directly, return its answer without going through the agent loop.
                // Use .includes() rather than strict equality so that a response containing the
                // sentinel anywhere (e.g. "___AGENT_PROCEED___ but here's some text") is still
                // routed to the agent loop instead of being returned as a direct answer.
                if (responseText && !responseText.includes(PROCEED_SENTINEL)) {
                    // Validate the direct answer against quality heuristics before accepting.
                    // retryCount=0: we're only testing quality here, not consuming the retry budget;
                    // if the heuristic says 'retry' we fall through to the agent loop instead.
                    const { action } = evaluateTextResponse(responseText, input, 0);
                    if (action !== 'retry') {
                        log("Pre-check: direct answer");
                        if (ctx.stateManager) {
                            await ctx.stateManager.syncHistory(engine);
                            await ctx.stateManager.complete(ctx);
                        }
                        cleanupErrorListener(ctx);
                        return { completed: true, response: responseText };
                    }
                    log("Pre-check: direct answer failed quality check, entering agent loop");
                } else {
                    log("Pre-check: proceeding to agent loop");
                }
            } catch (e) {
                // If the pre-check itself was cancelled, propagate immediately
                if (isCancellationError(e) || (signal && signal.aborted)) {
                    await gracefulCleanup(ctx, engine);
                    return { completed: true, response: '🛑 Task cancelled.' };
                }
                log(`Pre-check failed or skipped: ${e.message}`);
            }

            try {
                return await dispatch('ACTOR_CRITIC_LOOP', { input, signal, stream, onChunk });
            } catch (err) {
                await gracefulCleanup(ctx, engine);
                if (isCancellationError(err) || (signal && signal.aborted)) {
                    return { completed: true, response: '🛑 Task cancelled.' };
                }
                throw err;
            }
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

                // Inject relevant facts from the inference engine into the first turn
                // so the model benefits from previously inferred knowledge.
                if (ctx.consciousness) {
                    try {
                        const factContext = ctx.consciousness.renderFactContext(input);
                        if (factContext) {
                            prompt += `\n\n${factContext}`;
                        }
                    } catch (e) {
                        console.error('[ACTOR_CRITIC_LOOP] renderFactContext failed:', e);
                    }
                }
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

            let response;
            try {
                response = await engine.ai.ask(prompt, { tools, signal, stream, onChunk });
            } catch (err) {
                // Cancellation: clean up and return gracefully
                if (isCancellationError(err) || (signal && signal.aborted)) {
                    await gracefulCleanup(ctx, engine);
                    return { completed: true, response: '🛑 Task cancelled.' };
                }
                // Transient AI errors: log and attempt retry via next turn.
                // Uses a dedicated counter so quality-check retries (ctx.retryCount)
                // and AI-error retries don't interfere with each other.
                // Note: the error pushed here will be shown to the AI on the next turn
                // (via ctx.errors prompt injection at line ~248) and then cleared,
                // so it won't affect evaluateToolResults on the recovery turn.
                ctx.errors.push({ tool: 'ai_provider', error: err.message });
                log(`AI provider error: ${err.message}`);
                ctx.aiRetryCount = (ctx.aiRetryCount || 0) + 1;
                if (ctx.aiRetryCount > 3) {
                    await gracefulCleanup(ctx, engine);
                    return { completed: true, response: `Error: AI provider failed after ${ctx.aiRetryCount} attempts — ${err.message}` };
                }
                // Note: each AI retry dispatches a new ACTOR_CRITIC_LOOP turn,
                // so retries count against the maxTurns limit as well.
                return await dispatch('ACTOR_CRITIC_LOOP', { input, guidance: `Previous AI call failed with: ${err.message}. Retry the request.`, signal, stream, onChunk });
            }

            // ── Branch: tool calls → execute tools ──
            if (response && response.toolCalls && response.toolCalls.length > 0) {
                return await dispatch('EXECUTE_TOOLS', { toolCalls: response.toolCalls, input, signal, stream, onChunk });
            }

            // ── Branch: text response → inline quality check (formerly EVALUATE_TEXT_RESPONSE) ──
            const content = typeof response === 'string' ? response : response?.content;
            if (content) {
                const { action, guidance: retryGuidance } = evaluateTextResponse(content, input, ctx.retryCount);

                if (action === 'retry') {
                    ctx.retryCount++;
                    log(`Inline quality check (retry): ${retryGuidance}`);
                    return await dispatch('ACTOR_CRITIC_LOOP', {
                        input,
                        guidance: `[QUALITY CHECK FAILED]: ${retryGuidance}\nPlease try again with the above guidance.`,
                        signal, stream, onChunk
                    });
                }

                // Accept the response
                emitStatus('Response ready');

                if (ctx.consciousness) {
                    await ctx.consciousness.postProcess(content);
                }

                if (ctx.stateManager) {
                    await ctx.stateManager.syncHistory(engine);
                    await ctx.stateManager.complete(ctx);
                }

                cleanupErrorListener(ctx);
                return { completed: true, response: content };
            }

            // Failsafe
            return { completed: true, response: "No valid action generated by AI." };
        });

        eventic.registerHandler("EXECUTE_TOOLS", async (ctx, payload, log, dispatch, engine) => {
            const { toolCalls, input, signal, stream, onChunk } = payload;
            
            const toolNames = toolCalls.map(tc => tc.function.name);
            const toolNamesStr = toolNames.join(', ');
            emitStatus(`Executing: ${toolNamesStr}`);
            log(`Executing ${toolCalls.length} tool(s): ${toolNamesStr}`);
            
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
                        if (isCancellationError(e) || (signal && signal.aborted)) {
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

            emitStatus(`Completed ${toolCalls.length} tool(s), continuing…`);
            
            if (ctx.stateManager) {
                await ctx.stateManager.syncHistory(engine);
                await ctx.stateManager.checkpoint(ctx, engine, { phase: 'POST_TOOLS' });
            }

            // Inline tool evaluation (formerly CRITIC_EVALUATE_TOOLS handler).
            // ctx.errors here contains only errors from this EXECUTE_TOOLS turn;
            // prior-turn errors were already cleared in ACTOR_CRITIC_LOOP (line ~258).
            const guidance = evaluateToolResults(ctx, toolNames);

            if (guidance) {
                log(`Tool evaluation guidance: ${guidance}`);
                return await dispatch('ACTOR_CRITIC_LOOP', { input, guidance, signal, stream, onChunk });
            }

            return await dispatch('ACTOR_CRITIC_LOOP', { input, signal, stream, onChunk });
        });
        
        // Ensure legacy synthetic support
        eventic.registerHandler("SYNTHESIZE_RESPONSE", async (ctx, payload, log, dispatch, engine) => {
             return { completed: true, response: payload.message || "Done" };
        });
    }
};
