import { emitStatus, emitCommentary, summarizeInput } from './status-reporter.mjs';
import { isCancellationError } from './ai-provider.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';
import { formatGuidanceBlock } from './guidance-formatter.mjs';
import { isIncompleteResponse } from './agentic/response-patterns.mjs';

// ── Extracted modules ──────────────────────────────────────────────────
import {
    purgeTransientMessages,
    setupErrorListener,
    cleanupErrorListener,
    gracefulCleanup,
    evaluateTextResponse,
    classifyInputComplexity,
    PROCEED_SENTINEL,
    PRECHECK_PROMPT,
    TASK_TOOLS,
} from './agent-loop-helpers.mjs';

import {
    preRouteFiles,
    detectSurfaceUpdateIntent,
    preRouteSurfaces,
} from './agent-loop-preroute.mjs';

import { executeTools } from './agent-loop-tool-handler.mjs';

// Re-export TASK_TOOLS for any external consumers
export { TASK_TOOLS };

export const EventicAgentLoopPlugin = {
    install(eventic) {
        // ── AGENT_START ────────────────────────────────────────────────
        eventic.registerHandler("AGENT_START", async (ctx, payload, log, dispatch, engine) => {
            const { input, signal, stream, onChunk, model } = payload;
            // Store per-request model override on ctx so downstream handlers
            // (ACTOR_CRITIC_LOOP, etc.) can thread it into engine.ai.ask()
            // without mutating the shared aiProvider.model.
            ctx._requestModel = model || undefined;
            
            if (ctx.consciousness && !ctx.consciousness.initialized) {
                await ctx.consciousness.initialize();
                ctx.consciousness.initialized = true;
            }

            // Pre-process with consciousness (somatic/fact tracking).
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
                    consoleStyler.logError('error', 'Consciousness preProcess failed', e);
                }
            }

            ctx.turnNumber = 0;
            ctx.maxTurns = 30;
            ctx.toolCallCount = 0;
            ctx.retryCount = 0;
            ctx.incompleteRetryCount = 0;
            ctx.aiRetryCount = 0;
            ctx.errors = [];
            ctx.startedAt = new Date().toISOString();
            ctx.originalInput = input;
            ctx.requestId = `evt-${Date.now()}`;
            ctx.facade = engine?.context?.facade || ctx.facade || null;
            
            // Task context: accumulates across the entire request lifecycle
            ctx.tasks = [];
            ctx.completedTasks = [];
            ctx.directMarkdownBlocks = [];
            
            if (ctx.stateManager) {
                ctx.stateManager.loadHistory(engine);
                await ctx.stateManager.syncHistory(engine);
                await ctx.stateManager.checkpoint(ctx, engine, { phase: 'AGENT_START' });
            }

            // Setup error listener for background tasks (floating promises)
            setupErrorListener(ctx);

            // Pre-route: auto-fetch files mentioned in the user's input
            const preRouted = engine.tools ? await preRouteFiles(input, engine.tools) : [];
            if (preRouted.length > 0 && engine.ai?.conversationHistory) {
                const fileContext = preRouted.map(r => {
                    if (r.content) return `[FILE CONTENT: ${r.path}]\n\`\`\`\n${r.content}\n\`\`\``;
                    if (r.error) return `[FILE ERROR: ${r.path}]: ${r.error}`;
                    return '';
                }).filter(Boolean).join('\n\n');
                
                if (fileContext) {
                    engine.ai.conversationHistory.push({
                        role: 'system',
                        content: `The following files were automatically retrieved based on the user's request. Use this data to answer accurately.\n\n${fileContext}`,
                        _transient: true,
                    });
                    emitCommentary(`📂 Pre-fetched ${preRouted.length} file(s) mentioned in your request`);
                }
            }

            // Pre-route: auto-fetch surface context for update/fix requests.
            const surfaceIntent = detectSurfaceUpdateIntent(input);
            ctx._isSurfaceUpdate = surfaceIntent.isSurfaceUpdate;
            if (surfaceIntent.isSurfaceUpdate && engine.tools) {
                try {
                    const surfaceContext = await preRouteSurfaces(input, engine.tools, surfaceIntent);
                    if (surfaceContext && engine.ai?.conversationHistory) {
                        engine.ai.conversationHistory.push({
                            role: 'system',
                            content: surfaceContext,
                            _transient: true,
                        });
                        emitCommentary('🎨 Surface update detected — pre-fetched surface data to speed up the fix');
                    }
                } catch (e) {
                    log(`Surface pre-route failed: ${e.message}`);
                }
            }

            // Skip precheck for likely follow-up messages that reference prior context.
            const isLikelyFollowUp = (() => {
                const history = engine.ai?.conversationHistory || [];
                if (history.length < 2) return false;
                
                const lower = input.trim().toLowerCase();
                const wordCount = lower.split(/\s+/).length;
                if (wordCount <= 3 && /^(yes|yeah|yep|sure|ok|okay|do it|go ahead|please|run it|try it)/.test(lower)) return true;
                if (wordCount <= 12 && /\b(that|this|it|those|these|the same|above|previous|last|you (said|mentioned|suggested|proposed|offered))\b/i.test(lower)) return true;
                if (wordCount <= 8 && /^(yes|yeah|sure|ok|please|go)\b/i.test(lower)) return true;
                if (wordCount <= 12 && /^(start|begin|run|try|use|show|give|pick|choose|select|execute|launch|apply|do|set\s+up|switch|open|skip|stop|cancel|pause|resume|let'?s)\b/i.test(lower)) return true;
                return false;
            })();
            
            if (isLikelyFollowUp || ctx._isSurfaceUpdate) {
                emitCommentary(ctx._isSurfaceUpdate
                    ? '🎨 Surface update request — routing directly to agent loop with tools.'
                    : '🧠 Follow-up message detected — using full conversation context.');
                try {
                    return await dispatch('ACTOR_CRITIC_LOOP', { input, signal, stream, onChunk });
                } catch (err) {
                    await gracefulCleanup(ctx, engine);
                    if (isCancellationError(err) || (signal && signal.aborted)) {
                        return { completed: true, response: '🛑 Task cancelled.' };
                    }
                    throw err;
                }
            }

            emitCommentary(`🔍 Analyzing request: ${summarizeInput(input)} — checking if I can answer directly…`);
            
            // Direct-answer precheck
            try {
                let precheckInput = PRECHECK_PROMPT + `\n\nInput: ${input}`;
                if (engine.ai?.systemPrompt) {
                    const personaHint = engine.ai.systemPrompt.substring(0, 200);
                    if (personaHint.toLowerCase().includes('persona') || personaHint.toLowerCase().includes('you are') || personaHint.toLowerCase().includes('your name')) {
                        precheckInput = `Remember your persona identity as described in your system prompt. ` + precheckInput;
                    }
                }
                const preCheckResponse = await engine.ai.ask(precheckInput, { recordHistory: false, model: ctx._requestModel, stream, onChunk });

                const responseText = (typeof preCheckResponse === 'string'
                    ? preCheckResponse
                    : preCheckResponse?.content || '').trim();

                if (responseText && !responseText.includes(PROCEED_SENTINEL)) {
                    const { action } = evaluateTextResponse(responseText, input, 0);
                    if (action !== 'retry') {
                        emitCommentary('✅ Answered directly — no tools needed.');
                        if (ctx.stateManager) {
                            await ctx.stateManager.syncHistory(engine);
                            await ctx.stateManager.complete(ctx);
                        }
                        cleanupErrorListener(ctx);
                        purgeTransientMessages(engine);
                        return { completed: true, response: responseText };
                    }
                    emitCommentary('🔄 Direct answer didn\'t meet quality bar — entering the agent loop for a deeper response.');
                } else {
                    emitCommentary('🧠 This requires tools and deeper reasoning — entering the agent loop.');
                }
            } catch (e) {
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

        // ── ACTOR_CRITIC_LOOP ──────────────────────────────────────────
        eventic.registerHandler("ACTOR_CRITIC_LOOP", async (ctx, payload, log, dispatch, engine) => {
            const { input, guidance, signal, stream, onChunk } = payload;
            ctx.turnNumber++;

            if (ctx.turnNumber > ctx.maxTurns) {
                if (ctx.stateManager) {
                    await ctx.stateManager.syncHistory(engine);
                    await ctx.stateManager.complete(ctx);
                }
                cleanupErrorListener(ctx);
                purgeTransientMessages(engine);
                return { completed: true, response: "Could not complete the task within the allowed turns." };
            }

            if (ctx.stateManager) {
                await ctx.stateManager.syncHistory(engine);
                await ctx.stateManager.checkpoint(ctx, engine, { phase: 'ACTOR_CRITIC_LOOP', guidance });
            }

            if (ctx.turnNumber === 1) {
                emitCommentary(`🚀 Turn 1/${ctx.maxTurns}: Analyzing request — ${summarizeInput(input)}`);
            } else {
                emitCommentary(`🔄 Turn ${ctx.turnNumber}/${ctx.maxTurns}: Continuing work` +
                    (ctx.toolCallCount > 0 ? ` — ${ctx.toolCallCount} tools called so far` : '') +
                    '. Sending context to AI…');
            }

            let tools = [];
            if (typeof engine.getAvailableTools === 'function') {
                tools = engine.getAvailableTools();
            }
            
            // Add dynamic task tools only when useful
            if (ctx.turnNumber <= 1 || ctx.tasks.length > 0) {
                tools = [...tools, ...TASK_TOOLS];
            }

            let prompt;
            if (ctx.turnNumber === 1) {
                prompt = input;

                if (classifyInputComplexity(input) === 'complex') {
                    prompt += '\n\n[PLANNING HINT]: This is a complex multi-step request. Start by using the add_tasks tool to create a structured plan before executing. Break the work into clear, sequential tasks.';
                }

                if (ctx._isSurfaceUpdate) {
                    prompt += `\n\n[SURFACE UPDATE INSTRUCTIONS]:
You are modifying an EXISTING surface. Follow this workflow strictly:
1. The surface context has been pre-fetched in system messages above — READ IT FIRST.
2. DO NOT call list_surfaces or read_surface unless the pre-fetched data is missing.
3. Identify the component(s) that need changes by reviewing the existing source code.
4. Modify the existing source — do NOT rewrite from scratch unless explicitly asked to.
5. Call update_surface_component with the COMPLETE modified jsx_source (full file, not a diff).
6. Preserve ALL existing functionality — only change what was requested.
7. If there are multiple components that need updating, update them one at a time.
8. After calling update_surface_component, provide a brief summary of what you changed.`;
                }

                // Inject relevant facts from the inference engine
                if (ctx.consciousness) {
                    try {
                        const factContext = ctx.consciousness.renderFactContext(input);
                        if (factContext && engine.ai?.conversationHistory) {
                            engine.ai.conversationHistory.push({
                                role: 'system',
                                content: factContext,
                                _transient: true,
                            });
                        }
                    } catch (e) {
                        consoleStyler.logError('error', 'renderFactContext failed', e);
                    }
                }
            } else {
                // Build context-aware continuation prompt with full task awareness
                const parts = [];
                
                parts.push(`[ORIGINAL TASK]: ${ctx.originalInput}`);
                parts.push(`[TURN ${ctx.turnNumber}/${ctx.maxTurns}]`);
                parts.push('');

                // Remind the model of its persona identity on continuation turns
                if (engine.ai?.systemPrompt) {
                    const sysPrompt = engine.ai.systemPrompt;
                    if (sysPrompt.toLowerCase().includes('persona') || sysPrompt.toLowerCase().includes('you are') || sysPrompt.toLowerCase().includes('your name')) {
                        parts.push('[PERSONA]: Stay in character as defined in your system prompt.');
                        parts.push('');
                    }
                }

                // Show completed tasks for context
                if (ctx.completedTasks.length > 0) {
                    parts.push(`[COMPLETED TASKS]:`);
                    for (const task of ctx.completedTasks) {
                        const icon = task.status === 'failed' ? '❌' : '✅';
                        parts.push(`  ${icon} ${task.description}: ${task.result || 'No result recorded'}`);
                    }
                    parts.push('');
                }
                
                // Show pending/running tasks
                if (ctx.tasks.length > 0) {
                    parts.push(`[CURRENT TASKS]:`);
                    for (const task of ctx.tasks) {
                        const desc = typeof task === 'string' ? task : task.description;
                        const status = typeof task === 'string' ? 'pending' : task.status;
                        const icon = status === 'running' ? '⏳' : '⏳';
                        parts.push(`  ${icon} ${desc} (${status})`);
                    }
                    parts.push('');
                    
                    const currentTask = ctx.tasks[0];
                    if (currentTask) {
                        const desc = typeof currentTask === 'string' ? currentTask : currentTask.description;
                        const result = typeof currentTask === 'string' ? null : currentTask.result;
                        parts.push(`Please focus on completing the next pending task: "${desc}".`);
                        if (result) {
                            parts.push(`Recent result for this task: ${result}`);
                        }
                    }
                } else {
                    parts.push('Review the tool results in your conversation history above. If there are no pending tasks, formulate a plan by creating a list of tasks. Otherwise, continue working on the original task.');
                }
                
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

            // Drain user guidance queue
            const facade = engine?.context?.facade || ctx.facade;
            if (facade && typeof facade.drainGuidanceQueue === 'function') {
                const guidanceEntries = facade.drainGuidanceQueue();
                if (guidanceEntries.length > 0) {
                    const guidanceBlock = formatGuidanceBlock(guidanceEntries);
                    prompt += guidanceBlock;
                    log(`Injected ${guidanceEntries.length} user guidance message(s) into prompt`);
                }
            } else if (!ctx._guidanceFacadeWarned) {
                log('Warning: facade not available for guidance queue drain — guidance injection disabled for this session');
                ctx._guidanceFacadeWarned = true;
            }

            let response;
            try {
                response = await engine.ai.ask(prompt, { tools, signal, stream, onChunk, model: ctx._requestModel });
            } catch (err) {
                if (isCancellationError(err) || (signal && signal.aborted)) {
                    await gracefulCleanup(ctx, engine);
                    return { completed: true, response: '🛑 Task cancelled.' };
                }
                ctx.errors.push({ tool: 'ai_provider', error: err.message });
                log(`AI provider error: ${err.message}`);
                ctx.aiRetryCount = (ctx.aiRetryCount || 0) + 1;
                if (ctx.aiRetryCount > 3) {
                    await gracefulCleanup(ctx, engine);
                    return { completed: true, response: `Error: AI provider failed after ${ctx.aiRetryCount} attempts — ${err.message}` };
                }
                return await dispatch('ACTOR_CRITIC_LOOP', { input, guidance: `Previous AI call failed with: ${err.message}. Retry the request.`, signal, stream, onChunk });
            }

            // ── Branch: tool calls → execute tools ──
            if (response && response.toolCalls && response.toolCalls.length > 0) {
                const aiText = typeof response === 'string' ? '' : (response.content || '');
                if (aiText.trim()) {
                    emitCommentary(`🤖 ${aiText.trim().substring(0, 300)}`);
                }
                emitStatus(`AI requested ${response.toolCalls.length} tool call(s) — executing…`);
                return await dispatch('EXECUTE_TOOLS', { toolCalls: response.toolCalls, input, signal, stream, onChunk });
            }

            // ── Branch: text response → inline quality check ──
            const content = typeof response === 'string' ? response : response?.content;
            if (content) {
                emitCommentary('📝 AI provided a text response — checking quality…');

                // Check for intent-announcement responses FIRST — these are
                // truncated fragments like "I'll" or "Let me" where the model
                // announced intent but didn't act.  Must run before the general
                // quality evaluator, which would give wrong guidance ("provide
                // more detail" instead of "use tools").
                //
                // Uses a dedicated counter so quality-check retries don't
                // consume the incomplete-response budget and vice versa.
                if (isIncompleteResponse(content) && ctx.incompleteRetryCount < 3) {
                    ctx.incompleteRetryCount++;
                    log(`Incomplete response detected (intent announcement: "${content.trim().substring(0, 40)}") — nudging to take action (attempt ${ctx.incompleteRetryCount})`);
                    emitCommentary(`🤖 AI announced intent without acting — nudging to take action (retry ${ctx.incompleteRetryCount})`);

                    // Remove the poisoned "I'll" from conversation history so
                    // the model doesn't see its own truncated response and
                    // repeat it on the next turn.
                    // ask() pushes [user, assistant] — pop both entries.
                    if (engine.ai?.conversationHistory) {
                        const hist = engine.ai.conversationHistory;
                        // Pop the incomplete assistant message
                        if (hist.length > 0 && hist[hist.length - 1].role === 'assistant') {
                            hist.pop();
                        }
                        // Pop the user prompt that produced it (will be re-sent)
                        if (hist.length > 0 && hist[hist.length - 1].role === 'user') {
                            hist.pop();
                        }
                    }

                    return await dispatch('ACTOR_CRITIC_LOOP', {
                        input,
                        guidance: `You just described what you intend to do but did NOT actually do it. You MUST now take action by calling the appropriate tools to complete the task. Do NOT just describe what you will do — actually do it now using tool calls.`,
                        signal, stream, onChunk
                    });
                }

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
                purgeTransientMessages(engine);

                let finalResponse = content;
                if (ctx.directMarkdownBlocks && ctx.directMarkdownBlocks.length > 0) {
                    finalResponse = content + '\n\n' + ctx.directMarkdownBlocks.join('\n\n');
                    ctx.directMarkdownBlocks = [];
                }

                return { completed: true, response: finalResponse };
            }

            // Failsafe
            purgeTransientMessages(engine);
            return { completed: true, response: "No valid action generated by AI." };
        });

        // ── EXECUTE_TOOLS ──────────────────────────────────────────────
        eventic.registerHandler("EXECUTE_TOOLS", async (ctx, payload, log, dispatch, engine) => {
            return await executeTools(ctx, payload, log, dispatch, engine);
        });
        
        // ── SYNTHESIZE_RESPONSE (legacy) ───────────────────────────────
        eventic.registerHandler("SYNTHESIZE_RESPONSE", async (ctx, payload, log, dispatch, engine) => {
             return { completed: true, response: payload.message || "Done" };
        });
    }
};
