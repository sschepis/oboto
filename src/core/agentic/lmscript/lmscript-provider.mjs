/**
 * LMScriptProvider — CLI-style agentic provider with dual holographic memory,
 * piping, dynamic tool creation, and persona injection.
 *
 * Prompt construction: ./lmscript-provider-prompts.mjs
 * Pure helpers:        ./lmscript-provider-helpers.mjs
 *
 * @module src/core/agentic/lmscript/lmscript-provider
 */

import { AgenticProvider } from '../base-provider.mjs';
import { TokenBudget } from '../token-budget.mjs';
import { StreamManager } from '../stream-manager.mjs';
import { HolographicMemoryAdapter } from './holographic-memory.mjs';
import { CLIExecutor } from './cli-executor.mjs';
import { consoleStyler } from '../../../ui/console-styler.mjs';
import { emitStatus } from '../../status-reporter.mjs';
import { CancellationError } from '../../../lib/cancellation-error.mjs';
import { wsSend } from '../../../lib/ws-utils.mjs';
import { formatGuidanceBlock } from '../../guidance-formatter.mjs';

// Extracted modules
import {
    ACTION_SCHEMA_DESCRIPTION,
    buildSystemPromptBase,
    assembleSystemPrompt,
    buildUserPrompt,
    getRecentHistory,
} from './lmscript-provider-prompts.mjs';

import {
    extractResponseIfTerminal,
    isIncompleteResponse,
    shouldSkipPrecheck,
    parseLLMAction,
    checkAbort,
    pushCommandHistory,
} from './lmscript-provider-helpers.mjs';

export class LMScriptProvider extends AgenticProvider {
    get id() { return 'lmscript'; }
    get name() { return 'LMScript Agent Loop'; }
    get description() {
        return 'CLI-style agent loop with piping, dual holographic memory (associative + on-demand), and dynamic tool creation.';
    }

    async initialize(deps) {
        await super.initialize(deps);
        this._memory = new HolographicMemoryAdapter({
            resoLangService: deps.facade?.resoLangService || null,
            maxAssociativeResults: 5,
            maxRecallResults: 10,
            primeCount: 64,
            initTicks: 10
        });
        await this._memory.initialize();
        this._executor = new CLIExecutor({
            memory: this._memory,
            toolExecutor: deps.toolExecutor,
            workingDir: deps.workingDir,
            eventBus: deps.eventBus || null
        });
        this._state = {
            persona: deps.facade?.personaManager?.getActivePersona?.()?.prompt || 
                     'You are a precise, efficient autonomous agent.',
            lastObservation: 'Agent initialized. Awaiting first input.',
            commandHistory: [],
            iterationCount: 0
        };
        this._config = {
            maxIterations: 10,
            maxContinuations: 3,
            streamingEnabled: true,
            maxHistoryMessages: 10,
        };
        this._turnBudget = new TokenBudget();
        this._cachedSystemPromptBase = null;
        this._cachedSystemPromptKey = null;

        consoleStyler.log('agentic', `LMScript provider initialized — commands: ${this._executor.getAvailableCommands().join(', ')}`);
    }

    /** Main entry point — process user input through the CLI agent loop. */
    async run(input, options = {}) {
        if (!this._deps) {
            throw new Error('LMScriptProvider not initialized. Call initialize() first.');
        }

        checkAbort(options.signal);

        return this._deduplicatedRun(input, options, async () => {
            const { historyManager, eventBus } = this._deps;
            const facade = this._deps.facade;
            const hm = facade ? facade.historyManager : historyManager;

            emitStatus('Starting LMScript agent processing');
            this._turnBudget.reset();

            // Precheck: can the model answer directly?
            if (this._config.precheckEnabled !== false) {
                const skipPrecheck = shouldSkipPrecheck(input);
                if (!skipPrecheck) {
                    try {
                        const { aiProvider } = this._deps;
                        const precheckResult = await aiProvider.ask(
                            `Answer the following directly if you can. If it requires tools, file access, or multi-step work, respond with exactly: ___AGENT_PROCEED___\n\n${input}`,
                            { signal: options.signal, temperature: 0.3, recordHistory: false, model: options.model, stream: !!options.onChunk, onChunk: options.onChunk }
                        );
                        const precheckText = (typeof precheckResult === 'string' ? precheckResult : precheckResult?.content || '').trim();

                        if (precheckText && !precheckText.includes('___AGENT_PROCEED___')) {
                            if (hm) {
                                hm.addMessage('user', input);
                                hm.addMessage('assistant', precheckText);
                            }
                            this._memory.processInput(input);
                            this._memory.rememberInteraction(input, precheckText);
                            emitStatus('Answered directly — no agent loop needed');
                            return { response: precheckText, streamed: false, tokenUsage: null };
                        }
                    } catch (e) {
                        if (e instanceof CancellationError || e.name === 'AbortError' || options.signal?.aborted) {
                            return { response: 'Agent processing was cancelled.', tokenUsage: null };
                        }
                    }
                }
            }

            // ── StreamManager: create per-run, auto-dispose on exit ─────────
            const streamManager = new StreamManager({
                onToken: options.onToken,
                onChunk: options.onChunk,
                signal: options.signal,
            });

            try {
                if (hm) hm.addMessage('user', input);
                this._memory.processInput(input);
                this._memory.storeAssociativeMemories([input], 'user', { signal: options.signal })
                    .catch(err => consoleStyler.log('warning', `Memory storage failed: ${err.message}`));

                const { response, streamed } = await this._agentLoop(input, options, streamManager);

                this._memory.rememberInteraction(input, response);
                if (hm) hm.addMessage('assistant', response);

                if (eventBus) {
                    eventBus.emit('agentic:lmscript-iteration', {
                        type: 'complete',
                        iterationCount: this._state.iterationCount,
                        responseLength: response.length,
                        tokenUsage: this._turnBudget.hasData ? this._turnBudget.toJSON() : null,
                        timestamp: Date.now()
                    });
                }

                emitStatus('LMScript processing complete');
                return { response, streamed, tokenUsage: this._turnBudget.hasData ? this._turnBudget.toJSON() : null };
            } catch (err) {
                if (err instanceof CancellationError ||
                    err.name === 'AbortError' ||
                    err.name === 'CancellationError' ||
                    options.signal?.aborted) {
                    const abortMsg = 'Agent processing was cancelled.';
                    if (hm) hm.addMessage('assistant', abortMsg);
                    return { response: abortMsg, tokenUsage: null };
                }
                throw err;
            } finally {
                streamManager.dispose();
            }
        });
    }

    /** The core agent loop — OODA-style with CLI command execution. */
    async _agentLoop(input, options = {}, streamManager = null) {
        let observation = input;
        let commandResult = '';
        let finalResponse = null;
        let iterations = 0;
        let continuations = 0;
        let streamed = false;
        const maxIter = this._config.maxIterations;
        const maxContinuations = this._config.maxContinuations;
        const eventBus = this._deps.eventBus;
        const ws = options.ws || this._deps.ws;

        let consecutiveNoops = 0;
        const maxConsecutiveNoops = this._config.maxConsecutiveNoops ?? 2;

        while (iterations < maxIter) {
            iterations++;
            this._state.iterationCount++;

            checkAbort(options.signal);

            // Drain user guidance queue
            const facade = this._deps?.facade;
            if (facade && typeof facade.drainGuidanceQueue === 'function') {
                const guidanceEntries = facade.drainGuidanceQueue();
                if (guidanceEntries.length > 0) {
                    const guidanceBlock = formatGuidanceBlock(guidanceEntries);
                    observation = `${guidanceBlock}\n\nPrevious context: ${observation}`;
                    consoleStyler.log('info', `Injected ${guidanceEntries.length} user guidance message(s)`);
                }
            }

            // 1. Fetch associative memory context (passive/auto-injected)
            emitStatus(`Agent loop iteration ${iterations}/${maxIter}`);
            const associativeContext = await this._memory.fetchAssociativeContext(
                observation, { signal: options.signal }
            );

            // 2. Tick physics
            this._memory.tick();

            // 3. Call LLM for next action
            const action = await this._callLLMForAction(
                observation, commandResult, associativeContext, options, streamManager
            );

            // Emit iteration event with diagnostics
            if (eventBus) {
                eventBus.emit('agentic:lmscript-iteration', {
                    type: 'iteration',
                    iteration: iterations,
                    maxIterations: maxIter,
                    command: action?.cli_command?.substring(0, 100) || null,
                    hasMonologue: !!action?.internal_monologue,
                    memoryCount: action?.memories_to_store?.length || 0,
                    cognitiveState: this._memory.getCognitiveStateSummary(),
                    timestamp: Date.now()
                });
            }

            if (!action) {
                finalResponse = commandResult || observation;
                break;
            }

            // 4. Store passive memories (fire-and-forget)
            if (action.memories_to_store?.length > 0) {
                this._memory.storeAssociativeMemories(
                    action.memories_to_store, 'assistant', { signal: options.signal }
                ).catch(err => consoleStyler.log('warning', `Memory storage failed: ${err.message}`));
            }

            // 5. Check if this is a terminal action (ECHO or NOOP)
            const responseText = extractResponseIfTerminal(action);

            // Track NOOP / empty command iterations for early exit
            if (responseText === null) {
                if (!action.cli_command || /^COMMAND\s+NOOP/i.test(action.cli_command.trim())) {
                    consecutiveNoops++;
                    if (consecutiveNoops >= maxConsecutiveNoops) {
                        finalResponse = action.internal_monologue || commandResult || 'Agent completed without explicit response.';
                        break;
                    }
                } else {
                    consecutiveNoops = 0;
                }
            }

            if (responseText !== null) {
                // Stream the final response text
                if (streamManager?.isActive && this._config.streamingEnabled) {
                    streamManager.chunk(responseText);
                    streamed = true;
                } else if (options.onChunk && this._config.streamingEnabled) {
                    options.onChunk(responseText);
                    streamed = true;
                }

                if (ws) {
                    try {
                        wsSend(ws, 'status', {
                            type: 'lmscript-response',
                            iteration: iterations,
                            timestamp: Date.now()
                        });
                    } catch (_e) { /* ignore ws errors */ }
                }

                // Check for incomplete response — allow continuations
                if (isIncompleteResponse(responseText) && continuations < maxContinuations) {
                    continuations++;
                    observation = `Your previous response was:\n${responseText}\n\nThis appears to be incomplete. Please continue or provide a complete response.`;
                    commandResult = responseText;
                    finalResponse = responseText;
                    continue;
                }

                finalResponse = responseText;
                break;
            }

            // 6. Execute CLI command
            if (action.cli_command) {
                pushCommandHistory(this._state.commandHistory, action.cli_command);

                streamManager?.suppress();
                try {
                    commandResult = await this._executor.execute(action.cli_command, {
                        signal: options.signal
                    });
                } catch (err) {
                    commandResult = `Command execution error: ${err.message}`;
                    consoleStyler.log('warning', `LMScript command error: ${err.message}`);
                } finally {
                    streamManager?.resume();
                }
            } else {
                finalResponse = action.internal_monologue || commandResult || observation;
                break;
            }

            // 7. Update observation for next iteration
            observation = commandResult;
        }

        if (!finalResponse) {
            finalResponse = commandResult || 'Agent loop completed without explicit response.';
        }

        return { response: finalResponse, streamed };
    }

    /** Call the LLM for a structured action; retry once on failure. */
    async _callLLMForAction(observation, commandResult, associativeContext, options, streamManager = null) {
        const { aiProvider } = this._deps;
        const systemPrompt = this._getSystemPrompt();
        const history = getRecentHistory(this._deps, this._config.maxHistoryMessages);
        const userPrompt = buildUserPrompt(
            observation, commandResult, associativeContext,
            this._state.commandHistory, history
        );

        // First attempt
        try {
            checkAbort(options.signal);
            return await this._executeLLMCall(aiProvider, userPrompt, systemPrompt, options, streamManager);
        } catch (err) {
            if (err instanceof CancellationError ||
                err.name === 'AbortError' ||
                err.name === 'CancellationError' ||
                options.signal?.aborted) {
                throw err;
            }

            consoleStyler.log('warning', `LMScript LLM call failed (attempt 1): ${err.message}`);

            // Retry once with a simpler prompt
            try {
                checkAbort(options.signal);
                const simplerPrompt = `Given this input:\n${observation}\n\nRespond with a JSON object: ${ACTION_SCHEMA_DESCRIPTION}\n\nUse COMMAND ECHO <your response> if you want to reply directly.`;
                return await this._executeLLMCall(aiProvider, simplerPrompt, systemPrompt, options, streamManager);
            } catch (retryErr) {
                consoleStyler.log('error', `LMScript LLM retry also failed: ${retryErr.message}`);
                return null;
            }
        }
    }

    /** Execute a single LLM call and parse the result. */
    async _executeLLMCall(aiProvider, userPrompt, systemPrompt, options, streamManager = null) {
        const askOptions = {
            system: systemPrompt,
            format: 'json',
            signal: options.signal,
            temperature: 0.7,
            recordHistory: false
        };
        if (options.model) {
            askOptions.model = options.model;
        }
        if (streamManager && !streamManager.isSuppressed && streamManager.isActive) {
            const callbacks = streamManager.getCallbacks();
            if (callbacks.onChunk) {
                askOptions.stream = true;
                askOptions.onChunk = callbacks.onChunk;
            }
            if (callbacks.onToken) {
                askOptions.stream = true;
                askOptions.onToken = callbacks.onToken;
            }
        }
        const rawResponse = await aiProvider.ask(userPrompt, askOptions);

        if (rawResponse?.usage) {
            this._turnBudget.add(rawResponse.usage);
        }

        const content = typeof rawResponse === 'string'
            ? rawResponse
            : (rawResponse?.content || rawResponse);

        return parseLLMAction(content);
    }

    /** Get the system prompt, using a two-tier cache. */
    _getSystemPrompt() {
        const commands = this._executor.getAvailableCommands();
        const staticKey = `${this._state.persona}|${commands.join(',')}`;

        if (this._cachedSystemPromptKey !== staticKey) {
            this._cachedSystemPromptBase = buildSystemPromptBase(this._state.persona, commands);
            this._cachedSystemPromptKey = staticKey;
        }

        const cognitiveState = this._memory.getCognitiveStateContext();
        return assembleSystemPrompt(this._cachedSystemPromptBase, cognitiveState, this._state.iterationCount);
    }

    /** Get the underlying memory adapter for diagnostics. */
    getMemory() { return this._memory || null; }

    /** Get the CLI executor for diagnostics. */
    getExecutor() { return this._executor || null; }

    /** Get provider diagnostics. */
    getDiagnostics() {
        return {
            iterationCount: this._state?.iterationCount || 0,
            commandHistory: this._state?.commandHistory?.slice(-10) || [],
            dynamicTools: this._executor?.listDynamicTools() || [],
            memory: this._memory?.getDiagnostics() || null,
            config: { ...this._config },
            tokenUsage: this._turnBudget?.hasData ? this._turnBudget.toJSON() : null
        };
    }

    async dispose() {
        if (this._memory) {
            this._memory.reset();
            this._memory = null;
        }
        this._executor = null;
        this._state = null;
        this._cachedSystemPromptBase = null;
        this._cachedSystemPromptKey = null;
        this._turnBudget = null;
        await super.dispose();
    }
}
