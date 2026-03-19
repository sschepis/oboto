/**
 * CognitiveProvider — alternate agentic provider that uses the tinyaleph
 * cognitive agent loop with prime-resonant cognitive middleware.
 *
 * Implements the 11-step cognitive loop:
 *  PERCEIVE → ENCODE → ORIENT → ATTEND → GUARD → RECALL →
 *  THINK → EXECUTE → VALIDATE → REMEMBER → EVOLVE
 *
 * Uses ai-man's AI provider for LLM calls and ToolExecutor for tools,
 * so it benefits from all configured backends (Gemini, OpenAI, LMStudio, etc.)
 * and the full ai-man tool ecosystem.
 *
 * When lmscript is available, creates a full LScriptRuntime with:
 *  - AiManLLMProvider (bridges ai-man's callProvider to lmscript's LLMProvider)
 *  - ToolBridge (converts ToolExecutor tools to lmscript ToolDefinition format)
 *  - CognitiveMiddleware (bridges CognitiveCore into lmscript middleware hooks)
 *  - EventBusTransport (bridges lmscript Logger to ai-man eventBus)
 *
 * @module src/core/agentic/cognitive-provider
 */

import { AgenticProvider } from './base-provider.mjs';
import { CognitiveAgent } from './cognitive/agent.mjs';
import { isPathWithinRoot } from '../../lib/path-validation.mjs';
import { consoleStyler } from '../../ui/console-styler.mjs';
import { emitStatus } from '../status-reporter.mjs';
import { classifyInput, generatePlan, executePlan, synthesizeResponse } from './cognitive/task-planner.mjs';
import { wsSend, wsSendUpdate } from '../../lib/ws-utils.mjs';

// lmscript runtime — required dependency
import { LScriptRuntime, MiddlewareManager, Logger } from '@sschepis/lmscript';
import { AiManLLMProvider } from './cognitive/lmscript-provider.mjs';
import { ToolBridge } from './cognitive/tool-bridge.mjs';
import { createCognitiveMiddleware } from './cognitive/cognitive-middleware.mjs';
import { createEventBusTransport } from './cognitive/eventbus-transport.mjs';

export class CognitiveProvider extends AgenticProvider {
    get id() { return 'cognitive'; }
    get name() { return 'Cognitive Agent (TinyAleph)'; }
    get description() {
        return '11-step cognitive loop with prime-resonant middleware, holographic memory, semantic field tracking, and objectivity gating.';
    }

    async initialize(deps) {
        // Guard: lmscript is a required dependency (static import).
        // If the package is missing, the import at the top of this module
        // throws ERR_MODULE_NOT_FOUND; this guard catches the subtler case
        // where the package is installed but exports are broken/undefined.
        if (!LScriptRuntime || !MiddlewareManager || !Logger) {
            throw new Error(
                'CognitiveProvider requires @sschepis/lmscript but its exports are unavailable. '
                + 'Install it with: npm install @sschepis/lmscript'
            );
        }

        await super.initialize(deps);

        // ── Load workspace-level sentient config override ────────────────
        let cognitiveConfig = deps.cognitiveConfig || {};
        if (deps.workingDir) {
            cognitiveConfig = await this._loadWorkspaceSentientOverride(
                cognitiveConfig, deps.workingDir
            );
        }

        // Create the cognitive agent with ai-man's dependencies
        this._agent = new CognitiveAgent(
            {
                aiProvider: deps.aiProvider,
                toolExecutor: deps.toolExecutor,
                historyManager: deps.historyManager,
                workingDir: deps.workingDir,
                facade: deps.facade
            },
            cognitiveConfig
        );

        // Initialize the cognitive state with a few physics ticks
        const initTicks = cognitiveConfig?.initTicks ?? 10;
        for (let i = 0; i < initTicks; i++) {
            this._agent.cognitive.tick();
        }

        consoleStyler.log('agentic', `Initialized cognitive provider — coherence=${this._agent.cognitive.coherence.toFixed(3)}, entropy=${this._agent.cognitive.entropy.toFixed(3)}`);

        // ── Initialize SentientCognitiveCore if sentient mode is enabled ──
        if (this._agent.isSentientPending()) {
            const sentientOk = await this._agent.initSentientCore({
                eventBus: deps.eventBus,
                workingDir: deps.workingDir,
            });

            if (sentientOk) {
                // Re-run init ticks on the new sentient core
                const sentientInitTicks = cognitiveConfig?.sentient?.initTicks ?? initTicks;
                for (let i = 0; i < sentientInitTicks; i++) {
                    this._agent.cognitive.tick();
                }

                consoleStyler.log('agentic',
                    `SentientCognitiveCore active — coherence=${this._agent.cognitive.coherence.toFixed(3)}`
                );

                // Start background tick loop if enabled (default: true)
                const bgTick = cognitiveConfig?.sentient?.backgroundTick !== false;
                if (bgTick && this._agent.cognitive.startBackground) {
                    this._agent.cognitive.startBackground();
                    this._sentientBackgroundActive = true;
                    consoleStyler.log('agentic', 'Sentient background tick loop started');
                }
            }
        }

        // --- lmscript runtime setup (required) ---
        const lmConfig = this._agent.config.lmscript || {};

        // 1. Create LLM provider adapter
        const llmProvider = new AiManLLMProvider({
            model: this._agent.config.agent?.model,
            providerSettings: deps.providerSettings || {},
            circuitBreakerConfig: lmConfig.circuitBreaker
        });

        // 2. Create tool bridge
        const toolBridge = new ToolBridge(deps.toolExecutor, {
            workingDir: deps.workingDir,
            ws: deps.ws,
            facade: deps.facade
        });

        // 3. Create cognitive middleware (wraps tinyaleph CognitiveCore)
        // Disable guard/recall/memory/evolution features by default because
        // CognitiveAgent.turn() already handles these phases directly.
        // Enabling them here would cause double-processing of the cognitive
        // state (processInput, checkSafety, recall, remember, tick).
        const cognitiveMiddleware = createCognitiveMiddleware(
            this._agent.cognitive,  // CognitiveCore instance
            {
                enableGuard: false,
                enableRecall: false,
                enableMemory: false,
                enableEvolution: false,
                ...(lmConfig.middleware || {})
            }
        );

        // 4. Create event bus transport
        const eventBusTransport = createEventBusTransport(
            deps.eventBus,
            lmConfig.logger || {}
        );

        // 5. Build MiddlewareManager and register cognitive hooks
        const middlewareManager = new MiddlewareManager();
        middlewareManager.use(cognitiveMiddleware.toHooks());

        // 6. Build Logger with event bus transport
        const logger = new Logger({
            transports: [eventBusTransport]
        });

        // 7. Create LScriptRuntime with full feature stack
        const runtime = new LScriptRuntime({
            provider: llmProvider,
            middleware: middlewareManager,
            logger
        });

        // 8. Wire into agent
        this._agent.initRuntime({
            runtime,
            toolBridge,
            cognitiveMiddleware,
            eventBusTransport
        });

        // Store references for dispose/diagnostics
        this._runtime = runtime;
        this._llmProvider = llmProvider;

        consoleStyler.log('agentic', 'lmscript runtime initialized successfully');
    }

    /**
     * Process input through the cognitive agent loop.
     *
     * @param {string} input
     * @param {Object} options
     * @returns {Promise<string>}
     */
    async run(input, options = {}) {
        if (!this._agent || !this._deps) {
            throw new Error('CognitiveProvider not initialized. Call initialize() first.');
        }

        return this._deduplicatedRun(input, options, async () => {
            emitStatus('Starting cognitive processing');

            // Use the facade's CURRENT historyManager (not the stale captured reference)
            // because loadConversation() replaces facade.historyManager after provider init.
            const facade = this._deps.facade;
            const getHistoryManager = () => facade ? facade.historyManager : this._deps.historyManager;

            try {
                // 1. Save user message to history IMMEDIATELY before processing
                const hm = getHistoryManager();
                if (hm) {
                    hm.addMessage('user', input);
                }

                // ── 2. Task Decomposition: classify input and possibly plan ─────
                const plannerConfig = this._agent.config.planner || {};
                const ws = options?.ws || this._deps.ws;
                let responseText;

                const useTaskPlanner = plannerConfig.enabled !== false
                    && classifyInput(input, plannerConfig) === 'complex';

                if (useTaskPlanner) {
                    consoleStyler.log('agentic', 'Task classified as complex — generating plan');
                    responseText = await this._runWithPlan(input, options, ws, plannerConfig);
                } else {
                    // Simple / planner-disabled path — direct turn
                    // Forward model, signal, and onChunk so the agent can use per-request
                    // model override (via options threading) instead of mutating aiProvider.model
                    const turnOpts = { signal: options.signal };
                    if (options.model) {
                        turnOpts.model = options.model;
                    }
                    if (options.onChunk) {
                        turnOpts.onChunk = options.onChunk;
                    }
                    const result = await this._agent.turn(input, turnOpts);
                    responseText = result.response;
                    // Capture token usage from cognitive agent for the response message
                    if (result.tokenUsage) {
                        this._lastTokenUsage = result.tokenUsage;
                    }

                    if (this._deps?.eventBus) {
                        this._deps.eventBus.emitTyped('agentic:cognitive-metadata', result.diagnostics);
                    }
                }

                // 3. Save assistant response to history IMMEDIATELY after receiving it
                emitStatus('Saving conversation history');
                const hmAfter = getHistoryManager();
                if (hmAfter) {
                    hmAfter.addMessage('assistant', responseText);
                }

                return { response: responseText, tokenUsage: this._lastTokenUsage || null };
            } finally {
                // Ensure the tracker is stopped even if an error occurs
                if (this._agent?.stopTracking) {
                    this._agent.stopTracking();
                }
            }
        });
    }

    /**
     * Execute a complex request via the task planner.
     *
     * 1. Generate a plan via LLM call
     * 2. Stream the plan to the UI
     * 3. Execute each step via agent.turn()
     * 4. Update the UI after each step
     * 5. Synthesize a final response
     *
     * Falls back to a direct turn() if plan generation fails.
     *
     * @param {string} input - Original user input
     * @param {Object} options - Turn options (signal, model, etc.)
     * @param {import('ws').WebSocket} ws - WebSocket for UI updates
     * @param {Object} plannerConfig - Planner configuration
     * @returns {Promise<string>} Final response text
     * @private
     */
    async _runWithPlan(input, options, ws, plannerConfig) {
        // Non-streaming callLLM for plan generation (returns JSON — streaming
        // raw JSON tokens would confuse the parser and pollute the UI)
        const callLLM = async (messages, tools, opts) => {
            const { onChunk: _, ...noStreamOptions } = options;
            return this._agent.callLLM(messages, tools, { ...noStreamOptions, ...opts });
        };

        // Streaming callLLM for synthesis (user-facing prose response)
        const callLLMStream = async (messages, tools, opts) => {
            return this._agent.callLLM(messages, tools, { ...options, ...opts });
        };

        const plan = await generatePlan(input, callLLM, {
            maxSteps: plannerConfig.maxSteps || 8,
            signal: options.signal,
        });

        // If plan generation failed, fall back to direct turn
        if (!plan) {
            consoleStyler.log('agentic', 'Plan generation failed — falling back to direct turn');
            const result = await this._agent.turn(input, {
                signal: options.signal,
                onChunk: options.onChunk,
                model: options.model,
            });
            if (this._deps?.eventBus) {
                this._deps.eventBus.emitTyped('agentic:cognitive-metadata', result.diagnostics);
            }
            return result.response;
        }

        // Send initial plan to UI as a task-plan message
        const planMessageId = plan.id;
        if (ws) {
            wsSend(ws, 'message', {
                id: planMessageId,
                role: 'ai',
                type: 'task-plan',
                title: plan.title,
                steps: plan.toUISteps(),
                planStatus: plan.status,
                timestamp: new Date().toLocaleString(),
                _pending: true,
            });
        }

        // Execute plan steps
        // Per-step iteration budget: sub-steps get a tighter iteration limit
        // and no continuations (the plan itself provides sequential progression).
        const stepIterLimit = plannerConfig.stepMaxIterations || 5;
        const { stepResults } = await executePlan(plan, {
            executeTurn: async (instruction, opts) => {
                return this._agent.turn(instruction, {
                    ...options,
                    ...opts,
                    maxIterations: stepIterLimit,
                    maxContinuations: 0,
                });
            },
            onUpdate: (updatedPlan) => {
                // Stream step updates to the UI
                if (ws) {
                    wsSendUpdate(ws, planMessageId, {
                        steps: updatedPlan.toUISteps(),
                        planStatus: updatedPlan.status,
                    });
                }
            },
            signal: options.signal,
            skipDependentOnFailure: plannerConfig.skipDependentOnFailure !== false, // default true per config
        });

        // Synthesize final response (use streaming callLLM for user-facing prose)
        const finalResponse = await synthesizeResponse(plan, stepResults, callLLMStream, {
            signal: options.signal,
        });

        // Finalize the plan message (remove _pending flag)
        if (ws) {
            wsSendUpdate(ws, planMessageId, {
                steps: plan.toUISteps(),
                planStatus: plan.status,
                _pending: false,
            });
        }

        return finalResponse;
    }

    /**
     * Get the underlying CognitiveAgent for diagnostics.
     * @returns {CognitiveAgent|null}
     */
    getAgent() {
        return this._agent || null;
    }

    /**
     * Get cognitive and runtime diagnostics.
     * @returns {Object}
     */
    getDiagnostics() {
        return {
            hasRuntime: !!this._runtime,
            circuitState: this._llmProvider?.getCircuitState?.() || 'unknown',
            agentStats: this._agent?.getStats?.() || {},
            cognitiveState: this._agent?.cognitive?.getDiagnostics?.() || {}
        };
    }

    /**
     * Load workspace-level sentient configuration override from
     * `{workingDir}/.ai-man/sentient.json`.  Merges into the provided
     * cognitiveConfig, allowing per-workspace enable/disable of sentient
     * mode and background ticking.
     *
     * @param {Object} cognitiveConfig - Base config from deps
     * @param {string} workingDir - Workspace directory
     * @returns {Promise<Object>} Merged config
     * @private
     */
    async _loadWorkspaceSentientOverride(cognitiveConfig, workingDir) {
        // Allowed keys with expected types — prevents prototype pollution,
        // unexpected overrides, and malformed value types.
        const ALLOWED_SENTIENT_KEYS = {
            enabled: 'boolean',
            primeCount: 'number',
            tickRate: 'number',
            backgroundTick: 'boolean',
            coherenceThreshold: 'number',
            objectivityThreshold: 'number',
            adaptiveProcessing: 'boolean',
            adaptiveMaxSteps: 'number',
            adaptiveCoherenceThreshold: 'number',
            name: 'string',
            memoryPath: 'string',
            initTicks: 'number',
            statePersistence: 'boolean',
            statePath: 'string',
            settleTicksPerInput: 'number',
        };

        try {
            const { resolve } = await import('path');
            const { readFile } = await import('fs/promises');
            const overridePath = resolve(workingDir, '.ai-man', 'sentient.json');
            const data = await readFile(overridePath, 'utf-8');
            const raw = JSON.parse(data);

            // Only pick recognised keys to prevent __proto__ pollution
            // and injection of unexpected config paths
            const override = Object.create(null);
            for (const [key, expectedType] of Object.entries(ALLOWED_SENTIENT_KEYS)) {
                if (key in raw && typeof raw[key] === expectedType) {
                    override[key] = raw[key];
                }
            }

            // Validate path-type keys stay within the workspace to prevent
            // path traversal attacks via malicious sentient.json files.
            // Delegates to the shared isPathWithinRoot() utility which uses
            // realpath() with parent-walking on ENOENT.
            for (const pathKey of ['memoryPath', 'statePath']) {
                if (override[pathKey]) {
                    const resolvedPath = resolve(workingDir, override[pathKey]);
                    const safe = await isPathWithinRoot(resolvedPath, workingDir);
                    if (!safe) {
                        consoleStyler.log('agentic',
                            `Ignoring ${pathKey} from sentient.json — path traverses outside workspace`
                        );
                        delete override[pathKey];
                    }
                }
            }

            // Merge override into the sentient section of cognitiveConfig
            const merged = { ...cognitiveConfig };
            merged.sentient = {
                ...(merged.sentient || {}),
                ...override,
            };

            consoleStyler.log('agentic',
                `Loaded workspace sentient override from ${overridePath}`
            );
            return merged;
        } catch (_e) {
            // No override file — use defaults
            return cognitiveConfig;
        }
    }

    async dispose() {
        // Stop sentient background tick loop
        if (this._sentientBackgroundActive && this._agent?.cognitive?.stopBackground) {
            this._agent.cognitive.stopBackground();
            this._sentientBackgroundActive = false;
            consoleStyler.log('agentic', 'Sentient background tick loop stopped');
        }

        // Save sentient state before disposing
        if (this._agent?.isSentientEnabled?.()) {
            await this._agent.saveSentientState();
            consoleStyler.log('agentic', 'Sentient state saved');
        }

        if (this._agent) {
            this._agent.reset();
            this._agent = null;
        }
        this._runtime = null;
        this._llmProvider = null;
        await super.dispose();
    }
}
