/**
 * ReactLoop — the core ReAct loop engine for the megacode provider.
 *
 * Implements the while(true) loop that alternates between LLM calls and
 * tool execution, following the ReAct pattern:
 *   Thought → Action → Observation → Thought → Action → …
 *
 * Uses ai-man's deps.aiProvider for LLM calls and deps.toolExecutor for
 * tool execution.  Integrates DoomDetector, CompactionAgent, MessageConverter,
 * and SystemPromptBuilder as support modules.
 *
 * Status reporting: Uses ActivityTracker for heartbeat-style elapsed time
 * updates, emitStatus/emitCommentary for narrated phase transitions, and
 * describeToolCall for rich tool descriptions. This ensures the user always
 * sees what the agent is doing during long-running operations.
 *
 * @module src/core/agentic/megacode/react-loop
 */

import { TokenBudget } from '../token-budget.mjs';
import { StreamManager } from '../stream-manager.mjs';
import { DoomDetector } from './doom-detector.mjs';
import { CompactionAgent } from './compaction-agent.mjs';
import { MessageConverter } from './message-converter.mjs';
import { SystemPromptBuilder } from './system-prompt-builder.mjs';
import { ActivityTracker } from '../../activity-tracker.mjs';
import {
    emitStatus,
    emitCommentary,
    describeToolCall,
    summarizeInput,
} from '../../status-reporter.mjs';

// Extracted helpers — parsing, abort/sleep, metadata, progress
import {
    parseAction,
    checkAbort,
    getAvailableTools,
    buildMetadata,
    emitProgress,
} from './react-loop-helpers.mjs';

// Extracted tool/LLM execution — retry, tool dispatch, compaction, synthesis
import {
    callLLMWithRetry,
    executeTool,
    handleCompaction,
    synthesizeAtLimit,
    LLMExhaustedError,
} from './react-loop-tools.mjs';

export class ReactLoop {
    /**
     * @param {Object} [options]
     * @param {number}  [options.maxIterations=25]  — max loop iterations
     * @param {Object}  [options.compaction]         — CompactionAgent config
     * @param {Object}  [options.doomDetection]      — DoomDetector config
     * @param {number}  [options.retryAttempts=3]    — LLM retry attempts for transient errors
     * @param {number}  [options.heartbeatIntervalMs=3000] — ActivityTracker heartbeat interval
     */
    constructor(options = {}) {
        this._maxIterations = options.maxIterations ?? 25;
        this._compaction = new CompactionAgent(options.compaction);
        this._doomDetector = new DoomDetector(options.doomDetection);
        this._retryAttempts = options.retryAttempts ?? 3;
        this._heartbeatIntervalMs = options.heartbeatIntervalMs ?? 3000;
    }

    /**
     * Execute the ReAct loop.
     *
     * @param {string} input — user message
     * @param {Object} deps  — shared dependencies
     * @param {Object} deps.aiProvider    — EventicAIProvider instance
     * @param {Object} deps.toolExecutor  — ToolExecutor instance
     * @param {string} [deps.workingDir]  — working directory
     * @param {Object} [deps.eventBus]    — event bus for status updates
     * @param {Object} [deps.facade]      — EventicFacade for history access
     * @param {Object} [options]
     * @param {AbortSignal}  [options.signal]  — abort signal
     * @param {boolean}      [options.stream]  — enable streaming
     * @param {Function}     [options.onToken]  — streaming token callback
     * @param {Function}     [options.onChunk]  — streaming chunk callback
     * @param {string}       [options.model]    — model override
     * @param {string}       [options.agentPrompt]     — custom agent instructions
     * @param {string}       [options.soulPrompt]      — core identity prompt
     * @param {string}       [options.customInstructions] — workspace instructions
     * @returns {Promise<{ response: string, iterations: number, toolCalls: Array, tokenUsage: Object, metadata: Object }>}
     */
    async execute(input, deps, options = {}) {
        const budget = new TokenBudget();
        const wantsStream = !!(options.stream || options.onToken || options.onChunk);
        const streamManager = wantsStream
            ? new StreamManager({
                onToken: options.onToken,
                onChunk: options.onChunk,
                signal: options.signal,
            })
            : null;

        // Create an ActivityTracker for heartbeat-style elapsed time reporting
        const tracker = new ActivityTracker({ intervalMs: this._heartbeatIntervalMs });

        // Run-level metrics for progress tracking
        const runMetrics = {
            startTime: Date.now(),
            iterations: 0,
            compactions: 0,
            doomWarnings: 0,
            toolErrors: 0,
            retries: 0,
        };

        const systemPrompt = SystemPromptBuilder.build({
            workingDir: deps.workingDir,
            tools: getAvailableTools(deps),
            agentPrompt: options.agentPrompt,
            soulPrompt: options.soulPrompt,
            customInstructions: options.customInstructions,
        });

        const conversationTurns = [];
        let iterations = 0;
        const allToolCalls = [];

        // --- Status: Announce the request ---
        emitStatus(`Analyzing request: ${summarizeInput(input)}`);

        // --- Load recent conversation history for multi-turn context ---
        try {
            const facade = deps.facade;
            const hm = facade ? facade.historyManager : deps.historyManager;
            if (hm?.getHistory) {
                const history = await hm.getHistory();
                if (Array.isArray(history) && history.length > 0) {
                    // Load up to 20 recent messages for context
                    const recentHistory = MessageConverter.toReactMessages(history.slice(-20));
                    conversationTurns.push(...recentHistory);
                    emitStatus(`Loaded ${recentHistory.length} recent messages for context`);
                }
            }
        } catch (err) {
            // Non-fatal — continue without history
            emitStatus('Could not load conversation history — starting fresh');
        }

        // Add user input as the current turn
        conversationTurns.push({ role: 'user', content: input });

        try {
            while (iterations < this._maxIterations) {
                checkAbort(options.signal);
                iterations++;
                runMetrics.iterations = iterations;

                // --- Status: Iteration start ---
                tracker.setActivity(
                    `Sending request to AI — iteration ${iterations}/${this._maxIterations}`,
                    { phase: 'llm-call' }
                );

                // Emit iteration event (machine-readable)
                if (deps.eventBus) {
                    deps.eventBus.emit('agentic:megacode-step', {
                        type: 'iteration-start',
                        iteration: iterations,
                        maxIterations: this._maxIterations,
                        timestamp: Date.now(),
                    });
                }

                // Build LLM messages from system prompt + conversation turns
                const messages = MessageConverter.buildLLMMessages(
                    systemPrompt,
                    conversationTurns
                );

                // Check for context overflow
                const overflow = this._compaction.checkOverflow(messages);
                if (overflow.needed) {
                    emitCommentary(`Context window approaching limit (${overflow.currentTokens} tokens) — compacting…`);
                    const compacted = await handleCompaction(
                        messages, conversationTurns, deps, options, tracker, this._compaction
                    );
                    if (compacted) continue; // Retry with compacted context
                }

                // Suppress streaming during LLM reasoning (we only stream final responses)
                streamManager?.suppress();

                // --- Status: LLM call ---
                tracker.setActivity('Waiting for AI response…', { phase: 'llm-call' });

                // Call LLM — pass streamManager so callLLM can forward callbacks
                // when streaming the final response
                let llmResponse;
                try {
                    llmResponse = await callLLMWithRetry(
                        messages, deps, options, budget, streamManager, runMetrics, this._retryAttempts
                    );
                } catch (err) {
                    if (err.name === 'LLMExhaustedError') {
                        tracker.stop();
                        const errorMsg = `I encountered a temporary issue communicating with the AI service (${err.message}). Please try again.`;
                        return {
                            response: errorMsg,
                            iterations,
                            toolCalls: allToolCalls,
                            tokenUsage: budget.toJSON(),
                            metadata: { ...buildMetadata(runMetrics, allToolCalls), error: err.message },
                        };
                    }
                    throw err; // Re-throw non-LLM errors
                }

                // Parse the LLM response to extract the action
                const action = parseAction(llmResponse);

                // --- Status: Surface the agent's thought/reasoning ---
                if (action.thought) {
                    emitCommentary(`💭 ${action.thought}`);
                }

                // --- Status: Announce what the agent decided ---
                if (action.type === 'tool_call') {
                    emitStatus(`AI decided to use tool: ${action.tool}`);
                } else if (action.type === 'respond') {
                    emitStatus('AI composing final response');
                }

                if (action.type === 'respond') {
                    // Final response — stream it to the user
                    tracker.stop();
                    streamManager?.resume();
                    if (streamManager) {
                        streamManager.token(action.response);
                    }

                    // Emit progress event
                    emitProgress(deps, runMetrics, allToolCalls, budget, this._maxIterations);

                    return {
                        response: action.response,
                        iterations,
                        toolCalls: allToolCalls,
                        tokenUsage: budget.toJSON(),
                        metadata: buildMetadata(runMetrics, allToolCalls),
                    };
                }

                if (action.type === 'tool_call') {
                    // Check doom loop
                    const doomCheck = this._doomDetector.check(action.tool, action.args);
                    if (doomCheck.isDoom) {
                        runMetrics.doomWarnings++;
                        const warning = `⚠️ Doom loop detected: tool "${action.tool}" called ${doomCheck.count} times with identical arguments. Try a different approach.`;

                        // --- Status: Doom warning ---
                        emitCommentary(warning);

                        // Emit doom event (machine-readable)
                        if (deps.eventBus) {
                            deps.eventBus.emit('agentic:doom-detected', {
                                toolName: action.tool,
                                count: doomCheck.count,
                                timestamp: Date.now(),
                            });
                        }

                        // Add warning to conversation so the LLM can try a different approach
                        conversationTurns.push({ role: 'assistant', content: llmResponse });
                        conversationTurns.push({ role: 'system', content: warning });
                        continue;
                    }

                    // --- Status: Tool execution ---
                    const toolDescription = describeToolCall(action.tool, action.args);
                    emitStatus(`Executing tool: ${toolDescription}`);
                    tracker.setActivity(`Running: ${toolDescription}`, { phase: 'tool-exec' });

                    // Execute the tool
                    const toolResult = await executeTool(
                        action.tool, action.args, deps, options, runMetrics
                    );
                    allToolCalls.push({
                        tool: action.tool,
                        args: action.args,
                        result: toolResult,
                    });

                    // --- Status: Tool completion ---
                    const isError = typeof toolResult === 'string' && /^Error/i.test(toolResult.trim());
                    if (isError) {
                        emitCommentary(`⚠️ Tool "${action.tool}" failed — AI will evaluate the error`);
                    } else {
                        const resultPreview = typeof toolResult === 'string'
                            ? (toolResult.length > 100 ? `${toolResult.length} chars` : 'done')
                            : 'done';
                        emitCommentary(`Tool completed: ${action.tool} (${resultPreview})`);
                    }

                    // Emit tool completion event (machine-readable)
                    if (deps.eventBus) {
                        deps.eventBus.emit('agentic:megacode-step', {
                            type: 'tool-complete',
                            iteration: iterations,
                            tool: action.tool,
                            resultLength: toolResult?.length || 0,
                            isError,
                            timestamp: Date.now(),
                        });
                    }

                    // Add to conversation — use 'user' role with a formatted prefix
                    // instead of 'tool' role to avoid OpenAI API requirement for
                    // tool_call_id matching (since we use text-based JSON actions,
                    // not native function calling).
                    conversationTurns.push({ role: 'assistant', content: llmResponse });
                    conversationTurns.push({
                        role: 'user',
                        content: `[Tool Result: ${action.tool}]\n${toolResult}`,
                    });

                    // --- Status: Sending results back ---
                    emitStatus(`Tool results received — sending back to AI (iteration ${iterations})`);
                    continue;
                }

                // Unknown action type or raw text — treat as final response
                tracker.stop();
                streamManager?.resume();
                if (streamManager) {
                    streamManager.token(llmResponse);
                }

                emitProgress(deps, runMetrics, allToolCalls, budget, this._maxIterations);

                return {
                    response: llmResponse,
                    iterations,
                    toolCalls: allToolCalls,
                    tokenUsage: budget.toJSON(),
                    metadata: buildMetadata(runMetrics, allToolCalls),
                };
            }

            // --- Max iterations reached — attempt synthesis ---
            emitCommentary(`Reached iteration limit (${this._maxIterations}) — synthesizing final response`);
            tracker.setActivity('Synthesizing response from collected results…', { phase: 'llm-call' });

            const synthesisResponse = await synthesizeAtLimit(
                systemPrompt, conversationTurns, allToolCalls, deps, options, budget, this._maxIterations
            );

            tracker.stop();
            emitProgress(deps, runMetrics, allToolCalls, budget, this._maxIterations);

            return {
                response: synthesisResponse,
                iterations,
                toolCalls: allToolCalls,
                tokenUsage: budget.toJSON(),
                metadata: {
                    ...buildMetadata(runMetrics, allToolCalls),
                    maxIterationsReached: true,
                },
            };
        } finally {
            tracker.stop();
            streamManager?.dispose();
            this._doomDetector.reset();
        }
    }

    /**
     * Reset the loop state for the next run.
     */
    reset() {
        this._doomDetector.reset();
    }
}
