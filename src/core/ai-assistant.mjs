// Main AI Assistant class
// Orchestrates all components and handles the main conversation flow
// REFACTORED: Extracted streaming and quality gate logic
// ENHANCED: Consciousness systems (Fact Engine, Semantic Collapse, Somatic, Archetypes)

import { emitStatus } from './status-reporter.mjs';
import { config } from '../config.mjs';
import fs from 'fs';
import path from 'path';
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
import { ConversationManager } from './conversation-manager.mjs';
import { createSystemPrompt } from './system-prompt.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';
import { ManifestManager } from '../structured-dev/manifest-manager.mjs';
import { callProvider, callProviderStream, getProviderLabel, createProviderContext } from './ai-provider.mjs';
import { SymbolicContinuityManager } from './symbolic-continuity.mjs';
import { getModelInfo } from './model-registry.mjs';
import { ConsoleStatusAdapter } from '../lib/adapters/console-status-adapter.mjs';
import { runStreamHandler } from './stream-handler.mjs';
import { QualityGate } from './quality-gate.mjs';
import { ResoLangService } from './resolang-service.mjs';
import { PromptRouter, TASK_ROLES, fitToBudget } from './prompt-router.mjs';

// ── Consciousness Systems (unified processor) ──
import { ConsciousnessProcessor } from './consciousness-processor.mjs';

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
        this.workspaceContentServer = options.workspaceContentServer; // New: Workspace Content Server
        
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
        
        // Initialize ConversationManager for multi-conversation support
        this.conversationManager = new ConversationManager(this.workingDir);
        
        this.manifestManager = new ManifestManager(this.workingDir);
        
        // Initialize Symbolic Continuity Manager
        this.symbolicContinuity = new SymbolicContinuityManager(
            this.workingDir,
            this.llmAdapter,
            this.promptRouter
        );
        
        // ── Consciousness Systems (unified processor) ──
        this.consciousness = new ConsciousnessProcessor();
        // Convenience alias for direct fact-engine access
        this.factEngine = this.consciousness.factEngine;
        
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
                chromeWsBridge: this.chromeWsBridge, // Pass Chrome Bridge if available
                workspaceContentServer: this.workspaceContentServer // Pass Workspace Content Server
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

        // Switch conversation manager workspace (saves current, loads new)
        await this.conversationManager.switchWorkspace(this.workingDir);
        
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

    // Save conversation state via ConversationManager
    async saveConversation() {
        try {
            await this.conversationManager.saveActive();
            return true;
        } catch (error) {
            consoleStyler.log('error', `Failed to save conversation: ${error.message}`);
            return false;
        }
    }

    // Load conversation state via ConversationManager
    async loadConversation() {
        try {
            // Initialize the ConversationManager (creates .conversations/ dir, loads default)
            await this.conversationManager.initialize();

            // Migrate legacy .conversation.json if it exists
            await this.conversationManager.migrateFromLegacy();

            // Get persona content for system prompt
            const personaContent = this.personaManager ? this.personaManager.renderPersonaPrompt() : '';

            // Point historyManager at the active conversation's HistoryManager
            const activeHm = this.conversationManager.getActiveHistoryManager();
            const history = activeHm.getHistory();

            // Ensure system prompt is updated to current context (including persona)
            this.openclawAvailable = !!(this.openClawManager && this.openClawManager.client && this.openClawManager.client.isConnected);
            const currentSystemPrompt = createSystemPrompt(this.workingDir, this.workspaceManager.getCurrentWorkspace(), null, { openclawAvailable: this.openclawAvailable, personaContent });

            if (history.length > 0 && history[0].role === 'system') {
                history[0].content = currentSystemPrompt;
            } else if (history.length === 0) {
                activeHm.initialize(currentSystemPrompt);
            } else {
                history.unshift({ role: 'system', content: currentSystemPrompt });
                activeHm.setHistory(history);
            }

            // Sync the assistant's historyManager reference to the active conversation
            this.historyManager = activeHm;
            this._syncHistoryManagerRefs();

            // Load symbolic continuity for this conversation
            await this.symbolicContinuity.initialize(
                this.conversationManager.getActiveConversationName()
            );

            if (this.eventBus) {
                this.eventBus.emit('server:history-loaded', this.historyManager.getHistory());
                // Also emit the active conversation name
                this.eventBus.emit('server:conversation-switched', {
                    name: this.conversationManager.getActiveConversationName(),
                    isDefault: this.conversationManager.isDefaultConversation()
                });
            }
            return history.length > 1;
        } catch (error) {
            consoleStyler.log('error', `Failed to load conversation: ${error.message}`);
            return false;
        }
    }

    // ─── Multi-conversation API ────────────────────────────────────────────

    /**
     * List all conversations in this workspace.
     */
    async listConversations() {
        return await this.conversationManager.listConversations();
    }

    /**
     * Create a new conversation.
     * @param {string} name
     * @returns {Object}
     */
    async createConversation(name) {
        // Build system prompt for the new conversation
        const personaContent = this.personaManager ? this.personaManager.renderPersonaPrompt() : '';
        this.openclawAvailable = !!(this.openClawManager && this.openClawManager.client && this.openClawManager.client.isConnected);
        const systemPrompt = createSystemPrompt(this.workingDir, this.workspaceManager.getCurrentWorkspace(), null, { openclawAvailable: this.openclawAvailable, personaContent });

        const result = await this.conversationManager.createConversation(name, systemPrompt);
        
        if (result.created && this.eventBus) {
            const conversations = await this.conversationManager.listConversations();
            this.eventBus.emit('server:conversation-list', conversations);
        }

        return result;
    }

    /**
     * Switch to a different conversation. Saves current first.
     * Shared state (workspaceManager, resoLangService) is preserved.
     * @param {string} name
     * @returns {Object}
     */
    async switchConversation(name) {
        const result = await this.conversationManager.switchConversation(name);

        if (result.switched) {
            // Point historyManager at the new active conversation
            this.historyManager = this.conversationManager.getActiveHistoryManager();
            this._syncHistoryManagerRefs();

            // Ensure system prompt is current
            await this.updateSystemPrompt();

            // Load symbolic continuity for the new conversation
            await this.symbolicContinuity.initialize(
                this.conversationManager.getActiveConversationName()
            );

            // Notify UI
            if (this.eventBus) {
                this.eventBus.emit('server:history-loaded', this.historyManager.getHistory());
                this.eventBus.emit('server:conversation-switched', {
                    name: this.conversationManager.getActiveConversationName(),
                    isDefault: this.conversationManager.isDefaultConversation()
                });
            }
        }

        return result;
    }

    /**
     * Delete a conversation.
     * @param {string} name
     * @returns {Object}
     */
    async deleteConversation(name) {
        const result = await this.conversationManager.deleteConversation(name);

        if (result.deleted) {
            // If we were on the deleted conversation, historyManager was already switched to default
            this.historyManager = this.conversationManager.getActiveHistoryManager();
            this._syncHistoryManagerRefs();

            if (this.eventBus) {
                const conversations = await this.conversationManager.listConversations();
                this.eventBus.emit('server:conversation-list', conversations);
                this.eventBus.emit('server:history-loaded', this.historyManager.getHistory());
                this.eventBus.emit('server:conversation-switched', {
                    name: this.conversationManager.getActiveConversationName(),
                    isDefault: this.conversationManager.isDefaultConversation()
                });
            }
        }

        return result;
    }

    /**
     * Rename a conversation.
     * @param {string} oldName
     * @param {string} newName
     * @returns {Object}
     */
    async renameConversation(oldName, newName) {
        const result = await this.conversationManager.renameConversation(oldName, newName);

        if (result.success) {
            // If we renamed the active conversation, sync the historyManager reference
            if (this._activeConversation !== this.conversationManager.getActiveConversationName()) {
                this.historyManager = this.conversationManager.getActiveHistoryManager();
                this._syncHistoryManagerRefs();
            }

            if (this.eventBus) {
                const conversations = await this.conversationManager.listConversations();
                this.eventBus.emit('server:conversation-list', conversations);
                this.eventBus.emit('server:conversation-renamed', {
                    oldName: result.oldName,
                    newName: result.newName
                });
            }
        }

        return result;
    }

    /**
     * Report from the current (child) conversation to the parent ("chat") conversation.
     * @param {string} summary
     * @param {Object} [metadata]
     * @returns {Object}
     */
    async reportToParent(summary, metadata = {}) {
        const childName = this.conversationManager.getActiveConversationName();
        return await this.conversationManager.reportToParent(childName, summary, metadata);
    }

    /**
     * Get the name of the currently active conversation.
     * @returns {string}
     */
    getActiveConversationName() {
        return this.conversationManager.getActiveConversationName();
    }

    /**
     * Sync the historyManager reference across all sub-components that hold a reference.
     * Called after switching conversations so everything uses the new HistoryManager.
     */
    _syncHistoryManagerRefs() {
        // Re-initialize the tool executor with the new historyManager
        if (this.toolExecutor) {
            this.toolExecutor.historyManager = this.historyManager;
            if (this.toolExecutor.coreHandlers) {
                this.toolExecutor.coreHandlers.historyManager = this.historyManager;
            }
        }

        // Update the quality gate
        if (this.qualityGate) {
            this.qualityGate.historyManager = this.historyManager;
        }

        // Set up history summarizer on new HistoryManager
        this.historyManager.setSummarizer(async (prompt) => {
            try {
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
    }

    // Initialize custom tools and update system prompt with manifest
    // P4 optimization: Only re-read manifest / rebuild system prompt when dirty
    async initializeCustomTools() {
        // Initialize ResoLang Holographic Memory
        if (this.resoLangService) {
            await this.resoLangService.initialize();
        }

        // Initialize Consciousness Processor (loads persisted facts, etc.)
        await this.consciousness.initialize();

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

            // ── Symbolic Continuity Injection ──
            const continuityMsg = this.symbolicContinuity.renderInjectionMessage();
            if (continuityMsg) {
                this.historyManager.addMessage('system', continuityMsg);
            }

            // ── Consciousness Systems: Pre-Input Analysis ──
            const { messages: consciousnessMessages } = this.consciousness.preProcess(
                userInput,
                { history: this.historyManager.getHistory(), reasoningSystem: this.reasoningSystem }
            );
            for (const msg of consciousnessMessages) {
                this.historyManager.addMessage(msg.role, msg.content);
            }
            // ── End Consciousness Systems ──

            this.historyManager.addMessage('user', userInput);

            // Store user input in holographic memory
            if (this.memoryAdapter && typeof this.memoryAdapter.store === 'function') {
                try {
                    await this.memoryAdapter.store(userInput, { role: 'user' });
                } catch (e) {
                    // Ignore store errors or unimplemented methods
                }
            }

            // ── Triage Step ──
            // Analyze request feasibility before engaging full agent loop
            try {
                const triageResult = await this._runTriage(userInput, this.historyManager.getHistory());
                
                if (triageResult.status === 'COMPLETED' && triageResult.response) {
                    consoleStyler.log('routing', `Triage: Request completed immediately (Fast Path).`);
                    finalResponse = triageResult.response;
                    this.historyManager.addMessage('assistant', finalResponse);
                    
                    // Post-process to ensure consciousness stays in sync
                    await this.consciousness.postProcess(finalResponse);
                    await this.saveConversation();
                    return finalResponse;
                }
                
                if (triageResult.status === 'MISSING_INFO' && triageResult.missing_info_question) {
                    consoleStyler.log('routing', `Triage: Request ambiguous, asking for clarification.`);
                    finalResponse = triageResult.missing_info_question;
                    this.historyManager.addMessage('assistant', finalResponse);
                    await this.saveConversation();
                    return finalResponse;
                }
                
                consoleStyler.log('routing', `Triage: Request validated, proceeding to main agent.`);
            } catch (error) {
                consoleStyler.log('warning', `Triage check failed, falling back to main loop: ${error.message}`);
            }
            // ── End Triage Step ──

            this.qualityEvaluator.reset();
            this.reasoningSystem.reset();
            
            // Predict reasoning from input
            consoleStyler.log('reasoning', 'Analyzing request complexity and predicting reasoning approach...');
            this.reasoningSystem.predictReasoningFromInput(userInput);
            
            // Modulate reasoning based on consciousness state
            const hints = this.consciousness.getReasoningHints();
            if (hints.shouldEscalate && hints.reason) {
                consoleStyler.log('reasoning', hints.reason);
            }
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
                
                // DIAGNOSTIC LOG: Check for instruction leakage
                if (responseMessage.content && responseMessage.content.length > 0) {
                     consoleStyler.log('debug', `[DIAGNOSTIC] Assistant content with tool call: "${responseMessage.content.substring(0, 100)}..."`);
                }

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
                    // Track tool calls in consciousness processor
                    this.consciousness.trackToolCalls(toolCalls, results);
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
                        
                        // Track in consciousness processor
                        this.consciousness.trackToolCalls([toolCall], [toolResult]);
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

                // ── Consciousness Systems: Post-Response Processing ──
                await this.consciousness.postProcess(finalResponse);
                // ── End Consciousness Post-Processing ──
                
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
                
                // ── Symbolic Continuity Generation ──
                // Count tool calls in this run for frequency heuristic
                const history = this.historyManager.getHistory();
                const lastUserIndex = history.map(m => m.role).lastIndexOf('user');
                const turnMessages = lastUserIndex >= 0 ? history.slice(lastUserIndex) : [];
                const toolCallCount = turnMessages.filter(m => m.tool_calls).length;
                
                if (this.symbolicContinuity.shouldGenerate(userInput, finalResponse, toolCallCount)) {
                    await this.symbolicContinuity.generateSignature(
                        userInput, finalResponse, toolCallCount,
                        this.consciousness.getSnapshot()
                    );
                }
                
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
        const rawMessages = this.historyManager.getLastExchanges(5); // Keep context focused
        
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
                 
                 // Inject fact engine context alongside holographic memory
                 const factContext = this.consciousness.renderFactContext(lastUserMsg.content);
                 if (factContext) {
                     rawMessages.splice(1, 0, { role: 'system', content: factContext });
                 }
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

            // Log Request
            this._logTranscript('REQUEST', modelConfig.modelId, {
                messages: budgetedMessages,
                tools_count: this.allTools.length,
                params: { temperature: this.temperature, reasoning_effort: reasoning }
            });

            // Use the injected LLM adapter
            const result = await this.llmAdapter.generateContent(requestData, { signal: options.signal });

            // Log Response
            this._logTranscript('RESPONSE', modelConfig.modelId, result);

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

    /**
     * Log LLM interactions to a transcript file for debugging.
     */
    _logTranscript(type, model, data) {
        if (!this.workingDir) return;
        
        const logDir = path.join(this.workingDir, 'logs');
        try {
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            
            const timestamp = new Date().toISOString();
            const logFile = path.join(logDir, 'llm-transcript.log');
            
            const entry = `\n=== ${type} [${timestamp}] ===\n` +
                          `Model: ${model}\n` +
                          `Data:\n${JSON.stringify(data, null, 2)}\n` +
                          `====================================\n`;
                          
            fs.appendFileSync(logFile, entry);
        } catch (e) {
            // Silently fail logging
        }
    }

    /**
     * Run a lightweight triage check on the user's request.
     * Determines if the request is simple enough to answer immediately,
     * ambiguous enough to need clarification, or complex enough for the main agent.
     */
    async _runTriage(userInput, fullHistory) {
        const modelConfig = this.promptRouter.resolveModel(TASK_ROLES.TRIAGE);
        
        // Use a limited history window for speed (last 5 messages)
        const recentHistory = fullHistory.slice(-5);
        
        const systemPrompt = `Classify the user request into exactly one category.

**COMPLETED** — Simple query you can answer immediately without tools or files.
Examples: greetings, general knowledge, short code snippets.

**MISSING_INFO** — Too vague to act on. Critical details missing.
Examples: "Fix the bug" (which?), "Update the file" (which?).

**READY** — Requires tools, file access, project context, or deep reasoning.
Examples: "Refactor ai-assistant.mjs", "Check the logs".

Return JSON:
{
  "status": "COMPLETED" | "MISSING_INFO" | "READY",
  "reasoning": "one sentence",
  "response": "answer if COMPLETED, else null",
  "missing_info_question": "clarifying question if MISSING_INFO, else null"
}`;

        try {
            const messages = [
                { role: 'system', content: systemPrompt },
                ...recentHistory.filter(m => m.role !== 'system')
            ];

            this._logTranscript('TRIAGE_REQUEST', modelConfig.modelId, messages);

            const result = await this.llmAdapter.generateContent({
                model: modelConfig.modelId,
                messages: messages,
                temperature: 0.1,
                response_format: { type: 'json_object' }
            });

            this._logTranscript('TRIAGE_RESPONSE', modelConfig.modelId, result);

            const content = result.choices[0].message.content;
            const cleanContent = content.replace(/^```json\n?/, '').replace(/\n?```$/, '');
            
            return JSON.parse(cleanContent);
        } catch (error) {
            return { status: 'READY' };
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
                { 
                    openclawAvailable: this.openclawAvailable, 
                    skillsSummary, 
                    personaContent,
                    symbolicContinuityEnabled: this.symbolicContinuity?.enabled || false,
                    chineseRoomMode: this.symbolicContinuity?.chineseRoomEnabled || false
                }
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
            errorHistory: this.toolExecutor.getErrorHistory(),
            consciousness: this.consciousness.getSnapshot()
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
        
        const prompt = `Complete the code at cursor position (between prefix and suffix).
RETURN ONLY the insertion text. NO markdown. NO prefix/suffix repetition.

File: ${filePath}

[PREFIX]
${prefix}
[/PREFIX]

[SUFFIX]
${suffix}
[/SUFFIX]

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
