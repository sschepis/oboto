// Main AI Assistant class
// Orchestrates all components and handles the main conversation flow
// REFACTORED: Extracted streaming and quality gate logic

import { emitStatus } from './status-reporter.mjs';
import { config } from '../config.mjs';
import { TOOLS } from '../tools/tool-definitions.mjs';
import { MCP_TOOLS } from '../tools/definitions/mcp-tools.mjs'; // New import
import { OPENCLAW_TOOLS } from '../tools/definitions/openclaw-tools.mjs';
import { OpenClawManager } from '../integration/openclaw/manager.mjs';
import { McpClientManager } from './mcp-client-manager.mjs'; // New import
import { PersonaManager } from './persona-manager.mjs';
import { ReasoningSystem } from '../reasoning/reasoning-system.mjs';
import { CustomToolsManager } from '../custom-tools/custom-tools-manager.mjs';
import { PackageManager } from '../package/package-manager.mjs';
import { ToolExecutor } from '../execution/tool-executor.mjs';
import { WorkspaceManager } from '../workspace/workspace-manager.mjs';
import { QualityEvaluator } from '../quality/quality-evaluator.mjs';
import { HistoryManager } from './history-manager.mjs';
import { createSystemPrompt } from './system-prompt.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';
import { ManifestManager } from '../structured-dev/manifest-manager.mjs';
import { callProvider, callProviderStream, getProviderLabel, createProviderContext } from './ai-provider.mjs';
import { getModelInfo } from './model-registry.mjs';
import { ConsoleStatusAdapter } from '../lib/adapters/console-status-adapter.mjs';
import { runStreamHandler } from './stream-handler.mjs';
import { QualityGate } from './quality-gate.mjs';
import { ResoLangService } from './resolang-service.mjs';
import { PromptRouter, TASK_ROLES, fitToBudget } from './prompt-router.mjs';

// Use native fetch in Node.js v18+
const fetch = globalThis.fetch;

export class MiniAIAssistant {
    constructor(workingDir, options = {}) {
        // Initialize Prompt Router
        this.promptRouter = new PromptRouter();

        // Provider context is auto-detected from model name
        const providerCtx = createProviderContext();
        this.endpoint = providerCtx.endpoint;
        this.workingDir = workingDir || config.system.workspaceRoot || process.cwd();
        
        // Initialize ResoLang Service for Holographic Memory
        this.resoLangService = new ResoLangService(this.workingDir);
        
        // Dependency Injection for Adapters
        this.llmAdapter = options.llmAdapter || {
            generateContent: (req, opts) => callProvider(req, opts),
            generateContentStream: (req, opts) => callProviderStream(req, opts)
        };
        this.statusAdapter = options.statusAdapter || new ConsoleStatusAdapter();
        this.eventBus = options.eventBus;
        this.middleware = options.middleware;
        // Use ResoLang as default memory adapter if none provided
        this.memoryAdapter = options.memoryAdapter || this.resoLangService;
        this.taskManager = options.taskManager; // New: Task Manager injection
        this.schedulerService = options.schedulerService; // New: Scheduler Service injection
        this.openClawManager = options.openClawManager || null; // OpenClaw integration
        
        // Initialize Persona Manager
        this.personaManager = new PersonaManager(this.workingDir);
        
        // Initialize MCP Client Manager
        this.mcpClientManager = new McpClientManager(this.workingDir);
        // We'll init it async later

        // Configurable max conversation turns (defaults to config, which defaults to 30)
        this.maxTurns = options.maxTurns || config.ai.maxTurns;
        
        // Max subagents limit
        this.maxSubagents = options.maxSubagents || config.ai.maxSubagents || 1;

        // Initialize all subsystems
        this.reasoningSystem = new ReasoningSystem();
        this.customToolsManager = new CustomToolsManager();
        this.packageManager = new PackageManager();
        this.workspaceManager = new WorkspaceManager();
        this.qualityEvaluator = new QualityEvaluator(this.endpoint);
        this.historyManager = new HistoryManager();
        this.manifestManager = new ManifestManager(this.workingDir);
        this.dryRun = options.dryRun || false;
        
        this._initToolExecutor();
        
        this.qualityGate = new QualityGate(
            this.qualityEvaluator,
            this.historyManager,
            this.workingDir,
            this.workspaceManager
        );

        // Determine if OpenClaw is available
        this.openclawAvailable = !!(this.openClawManager && this.openClawManager.client && this.openClawManager.client.isConnected);

        // Initialize history with system prompt (will be updated async if manifest exists)
        // Skills summary will be added in updateSystemPrompt
        this.historyManager.initialize(
            createSystemPrompt(this.workingDir, this.workspaceManager.getCurrentWorkspace(), null, { openclawAvailable: this.openclawAvailable })
        );
        
        // Set up history summarizer
        this.historyManager.setSummarizer(async (prompt) => {
            try {
                // Use summarizer role for cheap calls
                const modelConfig = this.promptRouter.resolveModel(TASK_ROLES.SUMMARIZER);
                
                const result = await this.llmAdapter.generateContent({
                    model: modelConfig.modelId,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.3
                });
                return result.choices[0].message.content;
            } catch (error) {
                consoleStyler.log('warning', `Summarizer failed: ${error.message}`);
                throw error;
            }
        });

        // Initialize tools with custom tools
        this.allTools = [...TOOLS, ...MCP_TOOLS];
        
        // Add OpenClaw tools if the integration is available
        if (this.openClawManager) {
            this.allTools.push(...OPENCLAW_TOOLS);
        }
        
        // Model configuration
        this.model = config.ai.model; // Fallback default
        this.temperature = config.ai.temperature;
        
        // Load custom tools will be done asynchronously after construction
        this.customToolsLoaded = false;
    }

    _initToolExecutor() {
        const currentDryRun = this.toolExecutor ? this.toolExecutor.dryRun : this.dryRun;
        
        this.toolExecutor = new ToolExecutor(
            this.packageManager,
            this.customToolsManager,
            this.workspaceManager,
            MiniAIAssistant,  // Pass the class for recursive calls
            {
                middleware: this.middleware,
                dryRun: currentDryRun,
                historyManager: this.historyManager,
                memoryAdapter: this.memoryAdapter, // Pass memory adapter to executor
                taskManager: this.taskManager, // Pass task manager to executor
                schedulerService: this.schedulerService, // Pass scheduler service to executor
                openClawManager: this.openClawManager, // Pass OpenClaw manager to executor
                mcpClientManager: this.mcpClientManager, // Pass MCP client manager to executor
                eventBus: this.eventBus, // Pass eventBus to executor
                personaManager: this.personaManager, // Pass persona manager to executor
                assistant: this, // Pass reference to self for persona prompt refresh
                chromeWsBridge: this.chromeWsBridge // Pass Chrome Bridge if available
            }
        );
        
        // Update local state to match
        this.dryRun = currentDryRun;
    }

    // Change the working directory and re-initialize dependent components
    async changeWorkingDirectory(newDir) {
        const fs = await import('fs');
        const path = await import('path');
        
        // Resolve absolute path
        const resolvedPath = path.resolve(newDir);
        
        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Directory not found: ${resolvedPath}`);
        }

        // Check if it's a directory
        const stat = await fs.promises.stat(resolvedPath);
        if (!stat.isDirectory()) {
            throw new Error(`Path is not a directory: ${resolvedPath}`);
        }

        this.workingDir = resolvedPath;
        
        // Also change the process working directory so os.cwd() reflects the new path
        try {
            process.chdir(resolvedPath);
        } catch (e) {
            consoleStyler.log('warning', `Could not chdir to ${resolvedPath}: ${e.message}`);
        }
        
        consoleStyler.log('system', `Changing working directory to: ${this.workingDir}`);

        // Re-initialize components
        this.manifestManager = new ManifestManager(this.workingDir);
        
        // Switch persona workspace
        if (this.personaManager) {
            await this.personaManager.switchWorkspace(this.workingDir);
        }
        
        this._initToolExecutor();
        
        this.qualityGate = new QualityGate(
            this.qualityEvaluator,
            this.historyManager,
            this.workingDir,
            this.workspaceManager
        );

        // Update system prompt with new context
        await this.updateSystemPrompt();
        
        // Try to load existing conversation for this workspace
        await this.loadConversation();

        return this.workingDir;
    }

    // Save conversation state (history only) for persistent sessions
    async saveConversation() {
        try {
            const fs = await import('fs');
            const path = await import('path');
            const filePath = path.join(this.workingDir, '.conversation.json');
            
            // Only save if there's meaningful history (more than just system prompt)
            const history = this.historyManager.getHistory();
            if (history.length <= 1) return false;

            fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf8');
            return true;
        } catch (error) {
            consoleStyler.log('error', `Failed to save conversation: ${error.message}`);
            return false;
        }
    }

    // Load conversation state
    async loadConversation() {
        try {
            const fs = await import('fs');
            const path = await import('path');
            const filePath = path.join(this.workingDir, '.conversation.json');

            // Get persona content for system prompt
            const personaContent = this.personaManager ? this.personaManager.renderPersonaPrompt() : '';
            
            if (fs.existsSync(filePath)) {
                consoleStyler.log('system', `Loading conversation from ${filePath}...`);
                const content = fs.readFileSync(filePath, 'utf8');
                const history = JSON.parse(content);
                
                // Ensure system prompt is updated to current context (including persona)
                this.openclawAvailable = !!(this.openClawManager && this.openClawManager.client && this.openClawManager.client.isConnected);
                const currentSystemPrompt = createSystemPrompt(this.workingDir, this.workspaceManager.getCurrentWorkspace(), null, { openclawAvailable: this.openclawAvailable, personaContent });
                
                if (history.length > 0 && history[0].role === 'system') {
                    history[0].content = currentSystemPrompt;
                } else {
                    history.unshift({ role: 'system', content: currentSystemPrompt });
                }
                
                this.historyManager.setHistory(history);
                
                if (this.eventBus) {
                    this.eventBus.emit('server:history-loaded', history);
                }
                return true;
            } else {
                consoleStyler.log('system', `No conversation found at ${filePath}. Starting fresh.`);
                // Reset history
                this.openclawAvailable = !!(this.openClawManager && this.openClawManager.client && this.openClawManager.client.isConnected);
                this.historyManager.initialize(createSystemPrompt(this.workingDir, this.workspaceManager.getCurrentWorkspace(), null, { openclawAvailable: this.openclawAvailable, personaContent }));
                if (this.eventBus) {
                    this.eventBus.emit('server:history-loaded', this.historyManager.getHistory());
                }
                return false;
            }
        } catch (error) {
            consoleStyler.log('error', `Failed to load conversation: ${error.message}`);
            return false;
        }
    }

    // Initialize custom tools and update system prompt with manifest
    // P4 optimization: Only re-read manifest / rebuild system prompt when dirty
    async initializeCustomTools() {
        // Initialize ResoLang Holographic Memory
        if (this.resoLangService) {
            await this.resoLangService.initialize();
        }

        // Initialize Persona Manager (idempotent)
        if (this.personaManager) {
            await this.personaManager.initialize();
        }

        // Initialize MCP Client Manager (idempotent)
        if (this.mcpClientManager) {
            await this.mcpClientManager.initialize();
        }

        // Only update system prompt if manifest has changed or first call
        if (this._systemPromptDirty !== false) {
            await this.updateSystemPrompt();
            this._systemPromptDirty = false;
        }

        // Bootstrap persona (set up Morning Briefing, etc.) — only on first init
        if (this.personaManager && !this._personaBootstrapped) {
            await this._bootstrapPersona();
            this._personaBootstrapped = true;
        }

        // Rebuild tool list to ensure dynamic tools are included
        this.allTools = [...TOOLS, ...MCP_TOOLS];
        
        if (this.openClawManager) {
            this.allTools.push(...OPENCLAW_TOOLS);
        }

        // Load custom tools (cached)
        if (!this._cachedCustomTools) {
            this._cachedCustomTools = await this.customToolsManager.loadCustomTools();
        }
        this.allTools.push(...this._cachedCustomTools);

        // Load MCP tools (dynamic)
        if (this.mcpClientManager) {
             this.allTools.push(...this.mcpClientManager.getAllTools());
        }

        this.customToolsLoaded = true;
    }

    /**
     * Bootstrap the active persona — set up recurring tasks like Morning Briefing.
     * Only runs once per session, and only if the persona has bootstrap config.
     */
    async _bootstrapPersona() {
        const bootstrap = this.personaManager.getBootstrapConfig();
        if (!bootstrap) return;

        // Set up Morning Briefing recurring task if configured and scheduler is available
        if (bootstrap.morningBriefing?.enabled && this.schedulerService) {
            try {
                // Check if a Morning Briefing schedule already exists
                const existing = this.schedulerService.listSchedules('all');
                const alreadyExists = existing.some(s => s.name === (bootstrap.morningBriefing.name || 'Morning Briefing'));

                if (!alreadyExists) {
                    await this.schedulerService.createSchedule({
                        name: bootstrap.morningBriefing.name || 'Morning Briefing',
                        description: bootstrap.morningBriefing.description || 'Daily persona briefing',
                        query: bootstrap.morningBriefing.query,
                        intervalMs: (bootstrap.morningBriefing.intervalMinutes || 1440) * 60 * 1000,
                        maxRuns: null,
                        skipIfRunning: true,
                        tags: ['persona', 'briefing']
                    });
                    consoleStyler.log('system', `🎭 Persona bootstrap: Morning Briefing schedule created (every ${bootstrap.morningBriefing.intervalMinutes || 1440} min)`);
                } else {
                    consoleStyler.log('system', '🎭 Persona bootstrap: Morning Briefing schedule already exists');
                }
            } catch (e) {
                consoleStyler.log('warning', `Failed to set up Morning Briefing: ${e.message}`);
            }
        }
    }

    // Mark system prompt as needing refresh (call after manifest-modifying operations)
    markSystemPromptDirty() {
        this._systemPromptDirty = true;
    }

    _canParallelizeTools(toolCalls) {
        // Read-only tools can always parallelize
        const readOnlyTools = new Set(['read_file', 'list_files', 'search_web', 'read_manifest']);
        const writeTools = new Set();
        
        for (const tc of toolCalls) {
            if (readOnlyTools.has(tc.function.name)) continue;
            // Check for file path conflicts
            try {
                const args = JSON.parse(tc.function.arguments);
                if (args.path && writeTools.has(args.path)) return false;
                if (args.path) writeTools.add(args.path);
            } catch { return false; }
        }
        return true;
    }

    // Save current session state
    async saveSession(sessionPath) {
        try {
            consoleStyler.log('system', `Saving session to ${sessionPath}...`);
            const historySaved = await this.historyManager.save(`${sessionPath}.history.json`);
            
            // Only save workspace if active
            if (this.workspaceManager.isWorkspaceActive()) {
                await this.workspaceManager.save(`${sessionPath}.workspace.json`);
            }
            
            if (historySaved) {
                consoleStyler.log('system', `✓ Session saved successfully`);
                return true;
            }
            return false;
        } catch (error) {
            consoleStyler.log('error', `Failed to save session: ${error.message}`);
            return false;
        }
    }

    // Load session state
    async loadSession(sessionPath) {
        try {
            consoleStyler.log('system', `Loading session from ${sessionPath}...`);
            const historyLoaded = await this.historyManager.load(`${sessionPath}.history.json`);
            
            // Try to load workspace
            await this.workspaceManager.load(`${sessionPath}.workspace.json`);
            
            if (historyLoaded) {
                consoleStyler.log('system', `✓ Session loaded successfully (${this.historyManager.getHistory().length} messages)`);
                // Update system prompt with current environment
                this.updateSystemPrompt();
                return true;
            }
            return false;
        } catch (error) {
            consoleStyler.log('error', `Failed to load session: ${error.message}`);
            return false;
        }
    }

    // Delete specified number of exchanges from history
    deleteHistoryExchanges(count) {
        const deletedExchanges = this.historyManager.deleteHistoryExchanges(count);
        
        // Reset any conversation state that depends on history length
        if (deletedExchanges > 0) {
            this.qualityEvaluator.reset();
        }
        
        return deletedExchanges;
    }

    // Main function to process user input and orchestrate tool use
    // @param {string} userInput - The user's input
    // @param {boolean|Object} optionsOrIsRetry - Options object { isRetry, signal } or boolean for backwards compat
    async run(userInput, optionsOrIsRetry = {}) {
        // Backwards compatibility: if boolean, treat as legacy isRetry parameter
        const options = typeof optionsOrIsRetry === 'boolean'
            ? { isRetry: optionsOrIsRetry }
            : optionsOrIsRetry;
        const { isRetry = false, signal, responseFormat, dryRun = false, model = null } = options;

        // Check for cancellation before starting
        if (signal?.aborted) {
            throw new DOMException('Agent execution was cancelled', 'AbortError');
        }

        // Ensure custom tools are loaded
        await this.initializeCustomTools();
        
        // Update dry run state
        this.toolExecutor.setDryRun(dryRun);
        
        if (!isRetry) {
            emitStatus('Analyzing your request…');
            consoleStyler.log('ai', 'Processing new user request...', { timestamp: true });
            
            // Inject Background Task Notifications here
            if (this.taskManager) {
                const completedTasks = this.taskManager.getCompletedUnread();
                if (completedTasks.length > 0) {
                    consoleStyler.log('system', `Injecting ${completedTasks.length} background task notification(s)`);
                    for (const task of completedTasks) {
                        const notification = `BACKGROUND TASK COMPLETED [${task.id}]: "${task.description}"\n` +
                                           `Status: ${task.status}\n` +
                                           `Result Summary: ${task.result ? task.result.substring(0, 300) + '...' : task.error}`;
                        
                        this.historyManager.addMessage('system', notification);
                        this.taskManager.markRead(task.id);
                    }
                }
            }

            this.historyManager.addMessage('user', userInput);

            // Store user input in holographic memory
            if (this.memoryAdapter && typeof this.memoryAdapter.store === 'function') {
                try {
                    await this.memoryAdapter.store(userInput, { role: 'user' });
                } catch (e) {
                    // Ignore store errors or unimplemented methods
                }
            }

            this.qualityEvaluator.reset();
            this.reasoningSystem.reset();
            
            // Predict reasoning from input
            consoleStyler.log('reasoning', 'Analyzing request complexity and predicting reasoning approach...');
            this.reasoningSystem.predictReasoningFromInput(userInput);
        } else {
            consoleStyler.log('recovery', `Retry attempt #${this.qualityEvaluator.getRetryAttempts()} initiated`, { timestamp: true });
        }
        
        let finalResponse = null;
        const maxTurns = this.maxTurns;

        for (let i = 0; i < maxTurns; i++) {
            // Check for cancellation at the start of each turn
            if (signal?.aborted) {
                throw new DOMException('Agent execution was cancelled', 'AbortError');
            }

            // Show conversation turn progress
            consoleStyler.log('progress', `Processing turn ${i + 1}/${maxTurns}`, { timestamp: true });
            emitStatus(i === 0 ? 'Thinking…' : `Continuing work (turn ${i + 1}/${maxTurns})…`);
            
            if (this.eventBus) this.eventBus.emitTyped('turn:start', { turnNumber: i + 1, maxTurns });

            const responseMessage = await this.generateContent(null, null, responseFormat, model, { signal });

            if (this.eventBus) this.eventBus.emitTyped('turn:end', { turnNumber: i + 1 });

            if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                // Log tool calls initiation
                const toolNames = responseMessage.tool_calls.map(tc => tc.function.name).join(', ');
                consoleStyler.log('tools', `Initiating ${responseMessage.tool_calls.length} tool call(s): ${toolNames}`);
                emitStatus(`Executing ${responseMessage.tool_calls.length} tool(s)…`);
                
                this.historyManager.pushMessage(responseMessage);
                
                const toolCalls = responseMessage.tool_calls;
                const canParallelize = this._canParallelizeTools(toolCalls);

                if (canParallelize && toolCalls.length > 1) {
                    consoleStyler.log('tools', `Running ${toolCalls.length} tools in parallel`);
                    
                    // Log all starts first
                    for (const toolCall of toolCalls) {
                         consoleStyler.log('working', `Executing tool (parallel): ${toolCall.function.name}`);
                         this.statusAdapter.onToolStart(toolCall.function.name, toolCall.function.arguments);
                    }

                    const results = await Promise.all(
                        toolCalls.map(async (toolCall) => {
                            const result = await this.toolExecutor.executeTool(toolCall, { signal });
                            this.statusAdapter.onToolEnd(toolCall.function.name, result);
                            return result;
                        })
                    );
                    
                    for (const result of results) {
                        this.historyManager.pushMessage(result);
                    }
                } else {
                    // Sequential (existing behavior)
                    for (const toolCall of toolCalls) {
                        // Log individual tool execution start
                        consoleStyler.log('working', `Executing tool: ${toolCall.function.name}`);
                        
                        const toolResult = await this.toolExecutor.executeTool(toolCall, { signal });
                        
                        // Log tool completion
                        const success = !toolResult.content.startsWith('Error:');
                        if (success) {
                            consoleStyler.log('tools', `✓ Tool completed: ${toolCall.function.name}`);
                        } else {
                            consoleStyler.log('error', `✗ Tool failed: ${toolCall.function.name} - ${toolResult.content.substring(0, 50)}...`);
                        }
                        
                        this.historyManager.pushMessage(toolResult);
                    }
                }
                
                consoleStyler.log('tools', `All tool calls completed. Continuing conversation...`);
                continue;

            } else {
                finalResponse = responseMessage.content;
                
                this.historyManager.addMessage('assistant', finalResponse);

                // Store assistant response in holographic memory
                if (this.memoryAdapter && typeof this.memoryAdapter.store === 'function') {
                    try {
                        await this.memoryAdapter.store(finalResponse, { role: 'assistant' });
                    } catch (e) {
                        // Ignore
                    }
                }
                
                emitStatus('Composing response…');

                // Perform quality evaluation if this isn't already a retry
                if (!isRetry && !this.qualityEvaluator.isRetrying()) {
                    const retryConfig = await this.qualityGate.evaluateAndCheckRetry(userInput, finalResponse);
                    
                    if (retryConfig) {
                        this.historyManager.setHistory(retryConfig.preservedHistory);
                        consoleStyler.log('recovery', 'Preserving tool call history and retrying with improved prompt...');
                        const stats = this.historyManager.getStats();
                        consoleStyler.log('recovery', `Session memory preserved: ${stats.messageCount} messages`, { indent: true });
                        
                        // Recursive retry with improved prompt (pass signal through)
                        return await this.run(retryConfig.improvedPrompt, { isRetry: true, signal });
                    }
                }
                
                // Save conversation state
                await this.saveConversation();
                
                break;
            }
        }

        if (!finalResponse) {
            finalResponse = "The assistant could not determine a final answer after multiple steps.";
        }
        
        return finalResponse;
    }

    // Function to call the AI provider using the injected adapter
    async generateContent(overrideReasoning = null, toolName = null, responseFormat = null, overrideModel = null, options = {}) {
        // Determine reasoning effort
        let reasoning = overrideReasoning;
        
        if (!reasoning) {
            const history = this.historyManager.getHistory();
            const context = {
                retryAttempts: this.qualityEvaluator.getRetryAttempts(),
                historyLength: history.length,
                toolCallCount: history.filter(msg => msg.tool_calls).length,
                pendingSteps: this.toolExecutor.getCurrentTodos()?.items?.filter(
                    item => item.status !== 'completed'
                ).length || 0,
                todoCount: this.toolExecutor.getCurrentTodos()?.items?.length || 0,
                toolName
            };
            
            reasoning = this.reasoningSystem.getSimplifiedReasoning('', context);
            consoleStyler.log('reasoning', `Selected reasoning effort: ${reasoning}`);
        }

        // ── Prompt Routing & Token Budgeting ──
        
        let role = TASK_ROLES.AGENTIC; // Default for main loop
        if (reasoning === 'high') role = TASK_ROLES.REASONING_HIGH;
        if (reasoning === 'low') role = TASK_ROLES.REASONING_LOW;
        
        let modelConfig;
        
        if (overrideModel) {
            const info = getModelInfo(overrideModel);
            modelConfig = {
                modelId: info.id,
                provider: info.provider,
                contextWindow: info.contextWindow,
                maxOutputTokens: info.maxOutputTokens,
                supportsToolCalling: info.supportsToolCalling,
                supportsReasoningEffort: info.supportsReasoningEffort,
                costTier: info.costTier,
                reasoningCapability: info.reasoningCapability,
            };
            consoleStyler.log('routing', `Using manual model override: ${overrideModel}`);
        } else {
            modelConfig = this.promptRouter.resolveModel(role);
            
            // Safety check: if high reasoning model doesn't support tools but we might need them, fallback
            // Note: We don't know for sure if we need tools this turn, but being in the main loop implies capability is needed.
            if (!modelConfig.supportsToolCalling && role === TASK_ROLES.REASONING_HIGH) {
                 consoleStyler.log('routing', `Role ${role} (${modelConfig.modelId}) lacks tool support. Falling back to AGENTIC.`);
                 role = TASK_ROLES.AGENTIC;
                 modelConfig = this.promptRouter.resolveModel(role);
            }
        }

        // Apply token budget
        const rawMessages = this.historyManager.getLastExchanges(10); // Get more context initially
        
        // Inject memory context if needed (before budgeting)
        if (this.memoryAdapter) {
             const lastUserMsg = rawMessages.filter(m => m.role === 'user').pop();
             if (lastUserMsg && !lastUserMsg._contextInjected) {
                 try {
                     const memories = await this.memoryAdapter.retrieve(lastUserMsg.content, 5);
                     if (memories && memories.length > 0) {
                         const contextBlock = memories.map(m => `[Relevant context]: ${m.text}`).join('\n');
                         const contextMsg = { role: 'system', content: `RETRIEVED CONTEXT:\n${contextBlock}` };
                         rawMessages.splice(1, 0, contextMsg);
                         lastUserMsg._contextInjected = true;
                     }
                 } catch (e) {}
             }
        }

        const { messages: budgetedMessages, trimmed, estimatedTokens } = fitToBudget(
            rawMessages, 
            modelConfig.contextWindow, 
            modelConfig.maxOutputTokens
        );
        
        try {
            const providerLabel = getProviderLabel(modelConfig.modelId);
            emitStatus(`Sending request to ${providerLabel}…`);
            consoleStyler.log('ai', `Sending request to ${providerLabel}...`, { timestamp: true });
            consoleStyler.log('ai', `Context: ${budgetedMessages.length} messages, ~${estimatedTokens} tokens${trimmed ? ' (trimmed)' : ''}`, { indent: true });
            
            let requestData = {
                model: modelConfig.modelId,
                messages: budgetedMessages,
                tools: this.allTools,
                tool_choice: "auto",
                temperature: this.temperature,
                reasoning_effort: modelConfig.supportsReasoningEffort ? reasoning : undefined,
                response_format: responseFormat
            };

            if (this.middleware) {
                requestData = await this.middleware.execute('pre-request', requestData);
            }

            // Use the injected LLM adapter
            const result = await this.llmAdapter.generateContent(requestData, { signal: options.signal });

            if (!result.choices || result.choices.length === 0) {
                throw new Error("Invalid response structure from AI provider.");
            }
            
            let message = result.choices[0].message;

            // Post-response
            if (this.middleware) {
                const responseData = await this.middleware.execute('post-response', { message: message });
                message = responseData.message;
                result.choices[0].message = message;
            }
            
            return message;

        } catch (error) {
            consoleStyler.log('error', `AI provider communication failed: ${error.message}`, { box: true });
            
            // Track errors for reasoning system
            this.reasoningSystem.addError(error);
            
            // If it's a fetch error, try to continue with a recovery message
            if (error.message.includes('fetch failed') || error.message.includes('Error:')) {
                consoleStyler.log('recovery', 'API connection failed, attempting to continue task execution');
                return {
                    content: "API connection temporarily failed. Continuing with task execution.",
                    tool_calls: []
                };
            }
            
            return { content: `Error: ${error.message}.` };
        }
    }

    // Function to call the AI provider with streaming response.
    // @param {string} userInput - The user's input
    // @param {Function} onChunk - Callback for each chunk of streamed content
    // @param {Object} [options] - Options object { signal }
    async runStream(userInput, onChunk, options = {}) {
        await this.initializeCustomTools();
        return runStreamHandler(this, userInput, onChunk, options);
    }

    // Update system prompt with current workspace and manifest
    async updateSystemPrompt() {
        let manifestContent = null;
        if (this.manifestManager && this.manifestManager.hasManifest()) {
            manifestContent = await this.manifestManager.readManifest();
        }

        // Re-check OpenClaw availability
        this.openclawAvailable = !!(this.openClawManager && this.openClawManager.client && this.openClawManager.client.isConnected);

        // Get Skills Summary
        let skillsSummary = "";
        if (this.toolExecutor && this.toolExecutor.skillsManager) {
            await this.toolExecutor.skillsManager.ensureInitialized();
            skillsSummary = this.toolExecutor.skillsManager.getSkillsSummary();
        }

        // Render active persona content
        let personaContent = "";
        if (this.personaManager) {
            personaContent = this.personaManager.renderPersonaPrompt();
        }

        this.historyManager.updateSystemPrompt(
            createSystemPrompt(
                this.workingDir,
                this.workspaceManager.getCurrentWorkspace(),
                manifestContent,
                { openclawAvailable: this.openclawAvailable, skillsSummary, personaContent }
            )
        );
    }

    // Get current conversation context
    getContext() {
        return {
            historyLength: this.historyManager.getHistory().length,
            workspace: this.workspaceManager.getCurrentWorkspace(),
            currentTodos: this.toolExecutor.getCurrentTodos(),
            qualityIssue: this.qualityEvaluator.getQualityIssue(),
            retryAttempts: this.qualityEvaluator.getRetryAttempts(),
            errorHistory: this.toolExecutor.getErrorHistory()
        };
    }

    // Debug: Display current session memory state
    displaySessionMemory() {
        const history = this.historyManager.getHistory();
        const sessionSummary = {
            totalMessages: history.length,
            messageTypes: {
                system: history.filter(m => m.role === 'system').length,
                user: history.filter(m => m.role === 'user').length,
                assistant: history.filter(m => m.role === 'assistant').length,
                tool: history.filter(m => m.role === 'tool').length
            },
            toolResults: history.filter(m => m.role === 'tool').map(m => ({
                name: m.name,
                contentLength: m.content.length
            })),
            assistantWithToolCalls: history.filter(m => m.role === 'assistant' && m.tool_calls).length
        };

        consoleStyler.log('system', 'Session Memory State:', { box: true });
        consoleStyler.log('system', `Total messages: ${sessionSummary.totalMessages}`, { indent: true });
        consoleStyler.log('system', `Message breakdown: ${JSON.stringify(sessionSummary.messageTypes)}`, { indent: true });
        consoleStyler.log('system', `Tool results: ${sessionSummary.toolResults.length} preserved`, { indent: true });
        
        if (sessionSummary.toolResults.length > 0) {
            sessionSummary.toolResults.forEach((tool, i) => {
                consoleStyler.log('system', `  ${i + 1}. ${tool.name} (${tool.contentLength} chars)`, { indent: true });
            });
        }

        return sessionSummary;
    }

    // Generate code completion (ghost text)
    async generateCodeCompletion(fileContent, cursorOffset, filePath) {
        const prefix = fileContent.substring(0, cursorOffset);
        const suffix = fileContent.substring(cursorOffset);
        
        // Basic Prompt
        const prompt = `You are a fast, precise code completion engine.
Your task is to complete the code at the cursor position (marked implicitly between prefix and suffix).
RETURN ONLY THE CODE TO INSERT. Do not include markdown blocks. Do not repeat the prefix or suffix.

File Path: ${filePath}

[CODE PREFIX]
${prefix}
[END PREFIX]

[CODE SUFFIX]
${suffix}
[END SUFFIX]

COMPLETION:`;

        try {
            // Use a direct call with lower latency parameters
            const result = await this.llmAdapter.generateContent({
                model: this.model, 
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: 64,
                stop: ['\n\n', '[CODE SUFFIX]']
            });
            
            let completion = result.choices[0].message.content;
            
            // Clean up any markdown code fences if the model adds them despite instructions
            completion = completion.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
            
            return completion;
        } catch (e) {
            consoleStyler.log('error', `Code completion failed: ${e.message}`);
            return null;
        }
    }

    // Generate context-aware next steps
    async generateNextSteps() {
        const fs = await import('fs');
        const path = await import('path');
        const steps = [];

        try {
            const hasPackageJson = fs.existsSync(path.join(this.workingDir, 'package.json'));
            const hasGit = fs.existsSync(path.join(this.workingDir, '.git'));
            
            if (hasPackageJson) {
                steps.push({ id: 'npm-install', label: 'Install Dependencies', icon: 'download', command: 'npm install', type: 'command' });
                steps.push({ id: 'npm-test', label: 'Run Tests', icon: 'flask-conical', command: 'npm test', type: 'command' });
            }
            
            if (hasGit) {
                steps.push({ id: 'git-status', label: 'Git Status', icon: 'git-branch', command: 'git status', type: 'command' });
            }
            
            // Add generic steps
            steps.push({ id: 'list-files', label: 'List Files', icon: 'folder', command: 'ls -la', type: 'command' });
            steps.push({ id: 'explain', label: 'Explain Project', icon: 'book-open', prompt: 'Explain what this project does based on the file structure.', type: 'prompt' });

        } catch (e) {
            consoleStyler.log('error', `Error generating next steps: ${e.message}`);
        }

        if (this.eventBus) {
            this.eventBus.emit('server:next-steps', steps);
        }
        return steps;
    }
}
