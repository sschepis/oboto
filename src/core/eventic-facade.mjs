import fs from 'fs';
import path from 'path';
import { Eventic, defaultTools } from './eventic.mjs';
import { EventicAIProvider } from './eventic-ai-plugin.mjs';
import { EventicToolsPlugin } from './eventic-tools-plugin.mjs';
import { EventicStatePlugin } from './eventic-state-plugin.mjs';
import { TaskCheckpointManager } from './task-checkpoint-manager.mjs';
import { createSystemPrompt } from './system-prompt.mjs';
import { config } from '../config.mjs';

// Agentic provider system
import { AgenticProviderRegistry, EventicProvider, CognitiveProvider } from './agentic/index.mjs';

// Managers needed for ToolExecutor
import { ToolExecutor } from '../execution/tool-executor.mjs';
import { PackageManager } from '../package/package-manager.mjs';
import { CustomToolsManager } from '../custom-tools/custom-tools-manager.mjs';
import { WorkspaceManager } from '../workspace/workspace-manager.mjs';
import { HistoryManager } from './history-manager.mjs';
import { ConversationManager } from './conversation-manager.mjs';
import { McpClientManager } from './mcp-client-manager.mjs';
import { PersonaManager } from './persona-manager.mjs';
import { ResoLangService } from './resolang-service.mjs';
import { ConsciousnessProcessor } from './consciousness-processor.mjs';

// Plugin system
import { PluginManager } from '../plugins/plugin-manager.mjs';

// Controllers
import { ConversationController } from './controllers/conversation-controller.mjs';
import { SessionController } from './controllers/session-controller.mjs';

/**
 * Eventic Transition Adapter Layer
 * Exposes the same public API as `AssistantFacade` but routes internal execution
 * to the new `Eventic` core engine instead of the old AssistantPipeline.
 */
export class EventicFacade {
    constructor(workingDir, options = {}) {
        this.workingDir = workingDir || process.cwd();
        this.dryRun = options.dryRun || false;
        
        // Dependencies for tools (reusing options where possible)
        this.eventBus = options.eventBus;
        this.middleware = options.middleware;
        this.taskManager = options.taskManager;
        this.schedulerService = options.schedulerService;
        this.openClawManager = options.openClawManager || null;
        this.workspaceContentServer = options.workspaceContentServer;
        this.chromeWsBridge = options.chromeWsBridge;

        this.packageManager = new PackageManager();
        this.customToolsManager = new CustomToolsManager();
        this.workspaceManager = new WorkspaceManager();
        this.historyManager = new HistoryManager();
        this.conversationManager = new ConversationManager(this.workingDir);
        this.mcpClientManager = new McpClientManager(this.workingDir);
        this.personaManager = new PersonaManager(this.workingDir);
        this.resoLangService = new ResoLangService(this.workingDir);
        this.memoryAdapter = options.memoryAdapter || this.resoLangService;
        this.consciousness = new ConsciousnessProcessor({ persistDir: this.workingDir });
        
        // Controllers
        this.conversationController = new ConversationController(this);
        this.sessionController = new SessionController(this);

        // Only create a checkpoint manager if one wasn't provided AND we have an eventBus
        // (child agents spawned by PlanExecutor don't have an eventBus and don't need checkpointing)
        if (options.taskCheckpointManager) {
            this.taskCheckpointManager = options.taskCheckpointManager;
            // Already initialized by the caller — don't re-initialize
        } else if (this.eventBus && this.taskManager) {
            this.taskCheckpointManager = new TaskCheckpointManager({
                eventBus: this.eventBus,
                taskManager: this.taskManager,
                workingDir: this.workingDir,
                aiAssistantClass: EventicFacade
            });
            this._checkpointInitPromise = this.taskCheckpointManager.initialize().catch(err => {
                console.error('[EventicFacade] CheckpointManager init error:', err);
            });
        } else {
            // Lightweight stub for child agents — no checkpointing needed
            this.taskCheckpointManager = {
                config: { enabled: false },
                initialize: async () => {},
                checkpointRequest: async () => false,
                completeRequest: async () => {},
                shutdown: async () => {}
            };
        }

        this._initToolExecutor();

        // Setup Eventic Engine
        this.engine = new Eventic({
            logHandlers: [
                (msg) => {
                    // Send to the console or the attached status adapter if any
                    if (options.statusAdapter && typeof options.statusAdapter.log === 'function') {
                        options.statusAdapter.log('info', msg);
                    } else {
                        console.log(msg);
                    }
                }
            ],
            context: {
                files: {},
                memory: {},
                workingDir: this.workingDir,
                eventBus: this.eventBus,
                consciousness: this.consciousness
            }
        });

        // Instantiate our new EventicAIProvider wrapping the legacy ai-provider.mjs
        this.aiProvider = new EventicAIProvider({
            model: options.model || config?.ai?.model,
            timeout: 120000
        });

        // Wire up the plugins
        this.engine.use(this.aiProvider);
        this.engine.use(defaultTools); // Eventic's default primitive tools
        
        // Use our new comprehensive tools plugin
        this.toolsPlugin = new EventicToolsPlugin(this.toolExecutor);
        this.engine.use(this.toolsPlugin);

        // State & Checkpointing Plugin
        this.statePlugin = new EventicStatePlugin({
            historyManager: this.historyManager,
            conversationManager: this.conversationManager,
            taskCheckpointManager: this.taskCheckpointManager
        });
        this.engine.use(this.statePlugin);

        // ── Agentic Provider Registry ──────────────────────────────────────
        // Register available agentic providers. The active provider handles
        // the AGENT_START dispatch in run()/runStream().
        this.agenticRegistry = new AgenticProviderRegistry();

        // Default: Eventic agent loop (identical to previous behavior)
        const eventicProvider = new EventicProvider();
        eventicProvider.install(this.engine); // registers AGENT_START etc.
        this.agenticRegistry.register(eventicProvider);

        // Alternate: TinyAleph cognitive agent loop
        const cognitiveProvider = new CognitiveProvider();
        this.agenticRegistry.register(cognitiveProvider);

        // Activate the configured provider (default: eventic)
        const defaultAgenticProvider = config?.ai?.agenticProvider || 'eventic';
        this._agenticInitPromise = this.agenticRegistry.setActive(
            defaultAgenticProvider,
            this._getAgenticDeps()
        ).catch(err => {
            console.warn(`[EventicFacade] Failed to activate agentic provider "${defaultAgenticProvider}", falling back to eventic:`, err.message);
            return this.agenticRegistry.setActive('eventic', this._getAgenticDeps());
        }).catch(err => {
            // Both primary and fallback failed — log and let run()/runStream() handle the null provider
            console.error(`[EventicFacade] All agentic providers failed to initialize:`, err.message);
        });

        // Track the facade's busy state
        this._isBusy = false;
        
        // OpenClaw tracking (stubbed for compatibility)
        this.openclawAvailable = false;

        // Stub _services to prevent crashes when downstream (e.g. main.mjs) tries to register services
        this._services = {
            registry: new Map(),
            register: (name, instance) => this._services.registry.set(name, instance),
            get: (name) => this._services.registry.get(name),
            optional: (name) => this._services.registry.get(name) || null
        };

        // ── Plugin System ──────────────────────────────────────────────────
        this.pluginManager = new PluginManager({
            workingDir: this.workingDir,
            toolExecutor: this.toolExecutor,
            eventBus: this.eventBus,
            aiProvider: this.aiProvider,
            // wsDispatcher and surfaceManager are set later by web-server.mjs
        });
        this._services.register('pluginManager', this.pluginManager);
    }

    /**
     * Build the shared dependencies object for agentic providers.
     * @returns {Object}
     * @private
     */
    _getAgenticDeps() {
        return {
            aiProvider: this.aiProvider,
            toolExecutor: this.toolExecutor,
            historyManager: this.historyManager,
            eventBus: this.eventBus,
            consciousness: this.consciousness,
            workingDir: this.workingDir,
            engine: this.engine,
            facade: this
        };
    }

    /**
     * Main entry point - processes user input through the active agentic provider.
     */
    async run(userInput, options = {}) {
        // Ensure checkpoint manager and agentic provider are initialized
        if (this._checkpointInitPromise) {
            await this._checkpointInitPromise;
            this._checkpointInitPromise = null;
        }
        if (this._agenticInitPromise) {
            await this._agenticInitPromise;
            this._agenticInitPromise = null;
        }
        this._isBusy = true;
        
        try {
            const provider = this.agenticRegistry.getActive();
            if (!provider) {
                throw new Error('No agentic provider is active. Initialization may have failed — check server logs.');
            }
            const result = await provider.run(userInput, {
                signal: options.signal,
                model: options.model
            });
            // Providers may return a string or { response, streamed }
            return typeof result === 'string' ? result : (result.response || 'No response generated.');
        } catch (err) {
            console.error('[EventicFacade] Run error:', err);
            throw err;
        } finally {
            this._isBusy = false;
        }
    }

    /**
     * Streaming entry point - delegates to the active agentic provider.
     */
    async runStream(userInput, onChunk, options = {}) {
        if (this._checkpointInitPromise) {
            await this._checkpointInitPromise;
            this._checkpointInitPromise = null;
        }
        if (this._agenticInitPromise) {
            await this._agenticInitPromise;
            this._agenticInitPromise = null;
        }
        this._isBusy = true;
        
        try {
            const provider = this.agenticRegistry.getActive();
            if (!provider) {
                throw new Error('No agentic provider is active. Initialization may have failed — check server logs.');
            }
            const result = await provider.run(userInput, {
                signal: options.signal,
                model: options.model,
                stream: true,
                onChunk
            });
            
            // Providers may return a string or { response, streamed }
            const responseText = typeof result === 'string' ? result : (result?.response || '');
            const alreadyStreamed = typeof result === 'object' && result?.streamed;
            
            // Only emit if the provider didn't already handle streaming itself
            if (!alreadyStreamed && typeof onChunk === 'function' && responseText) {
                onChunk(responseText);
            }
            
            return responseText || 'No response generated.';
        } catch (err) {
            console.error('[EventicFacade] Stream error:', err);
            return `Error: ${err.message}`;
        } finally {
            this._isBusy = false;
        }
    }

    queueChimeIn(message) {
        console.warn('[EventicFacade] queueChimeIn not implemented in Eventic phase 1');
        return false;
    }

    isBusy() {
        return this._isBusy;
    }

    get allTools() {
        if (!this.toolExecutor) return [];
        return this.toolExecutor.getAllToolDefinitions();
    }

    get model() {
        return this.aiProvider.model;
    }

    set model(newModel) {
        this.aiProvider.model = newModel;
    }

    // ─── Transition Stubs ───────────────────────────────────────────────────
    // The following methods map `AssistantFacade` methods to no-ops or simple stubs
    // to prevent crashes when the server calls them.

    _initToolExecutor() {
        this.toolExecutor = new ToolExecutor(
            this.packageManager,
            this.customToolsManager,
            this.workspaceManager,
            EventicFacade,   // Pass class for recursive calls
            {
                middleware: this.middleware,
                dryRun: this.dryRun,
                historyManager: this.historyManager,
                memoryAdapter: this.memoryAdapter,
                taskManager: this.taskManager,
                schedulerService: this.schedulerService,
                mcpClientManager: this.mcpClientManager,
                eventBus: this.eventBus,
                assistant: this
            }
        );
    }

    refreshServices() {
        // Refresh toolExecutor references
        if (this.toolExecutor) {
            this.toolExecutor.historyManager = this.historyManager;
            if (this.toolExecutor.coreHandlers) {
                this.toolExecutor.coreHandlers.historyManager = this.historyManager;
            }
        }
    }

    async initializeCustomTools() {
        if (!this.customToolsLoaded) {
            await this.customToolsManager.loadCustomTools();
            this.customToolsLoaded = true;
        }
        return true;
    }

    markSystemPromptDirty() {
        // System prompts are injected per-request in Eventic default loops
    }

    _getPluginsSummary() {
        if (!this.pluginManager) return '';
        try {
            const plugins = this.pluginManager.listPlugins?.() || [];
            const active = plugins.filter(p => p.status === 'active');
            if (active.length === 0) return '';
            return 'Active plugins: ' + active.map(p => `${p.name} (${p.description || 'no description'})`).join(', ');
        } catch { return ''; }
    }

    async updateSystemPrompt() {
        const personaContent = this.personaManager ? this.personaManager.renderPersonaPrompt() : '';
        let skillsSummary = '';
        if (this.toolExecutor && this.toolExecutor.skillsManager) {
            try {
                await this.toolExecutor.skillsManager.ensureInitialized();
                skillsSummary = this.toolExecutor.skillsManager.getSkillsSummary();
            } catch (e) { /* ignore */ }
        }
        this.openclawAvailable = !!(this.openClawManager && this.openClawManager.client && this.openClawManager.client.isConnected);
        const pluginsSummary = this._getPluginsSummary();
        const dynamicRoutesEnabled = process.env.OBOTO_DYNAMIC_ROUTES === 'true';
        const currentSystemPrompt = createSystemPrompt(
            this.workingDir,
            this.workspaceManager.getCurrentWorkspace(),
            null,
            {
                openclawAvailable: this.openclawAvailable, personaContent, skillsSummary,
                includeSurfaces: true, includeStyling: true, includeWorkflows: true,
                pluginsSummary, dynamicRoutesEnabled
            }
        );
        this.aiProvider.systemPrompt = currentSystemPrompt;

        // Update system prompt in history if present
        const history = this.historyManager.getHistory();
        if (history.length > 0 && history[0].role === 'system') {
            history[0].content = currentSystemPrompt;
        }
        return true;
    }

    async changeWorkingDirectory(newDir) {
        if (this._isBusy) {
            throw new Error('Cannot change workspace while the agent is processing a request. Wait for the current operation to finish.');
        }
        const resolvedPath = path.resolve(newDir);
        this.workingDir = resolvedPath;
        try {
            process.chdir(resolvedPath);
        } catch (e) {
            console.warn(`[EventicFacade] Could not chdir to ${resolvedPath}`);
        }
        
        if (this.personaManager) {
            await this.personaManager.switchWorkspace(this.workingDir);
        }

        // Re-initialize workspace-scoped managers for the new directory
        if (this.conversationManager) {
            await this.conversationManager.switchWorkspace(this.workingDir);
        }
        // Reset history manager so it doesn't reference stale workspace data.
        // loadConversation() (called by settings-handler after this method) will
        // replace it with the new workspace's active history manager.
        this.historyManager = new HistoryManager();
        // Persist any pending facts from the old consciousness before replacing it
        if (this.consciousness) {
            try { await this.consciousness.persist(); } catch { /* best-effort */ }
        }
        this.consciousness = new ConsciousnessProcessor({ persistDir: this.workingDir });
        this.resoLangService = new ResoLangService(this.workingDir);
        this.memoryAdapter = this.resoLangService;
        // Close existing MCP connections before replacing the manager to avoid
        // leaking child processes spawned by StdioClientTransport.
        if (this.mcpClientManager?.clients) {
            for (const name of this.mcpClientManager.clients.keys()) {
                try { await this.mcpClientManager.disconnect(name); } catch { /* best-effort */ }
            }
        }
        this.mcpClientManager = new McpClientManager(this.workingDir);

        // Shut down existing plugin system before rebuilding ToolExecutor
        // so plugin-registered tools are removed from the old instance
        if (this.pluginManager) {
            try { await this.pluginManager.shutdown(); } catch { /* best-effort */ }
        }

        // Update Eventic engine context
        this.engine.context.workingDir = this.workingDir;
        this.engine.context.consciousness = this.consciousness;

        this._initToolExecutor();
        // Update the tools plugin to point to the new executor
        if (this.toolsPlugin) {
            this.toolsPlugin.toolExecutor = this.toolExecutor;
        }

        // Re-initialize the active agentic provider with updated deps.
        // Store the promise so run()/runStream() will await it before processing.
        const activeProvider = this.agenticRegistry.getActive();
        if (activeProvider) {
            this._agenticInitPromise = activeProvider.initialize(this._getAgenticDeps()).catch(err => {
                console.warn('[EventicFacade] Failed to re-initialize agentic provider after workspace change:', err.message);
            });
        }

        // Re-create the PluginManager for the new workspace.
        // Discovery, wsDispatcher wiring, and initialization are deferred
        // to web-server.mjs which will call setWsDispatcher/setBroadcast/initialize.
        this.pluginManager = new PluginManager({
            workingDir: this.workingDir,
            toolExecutor: this.toolExecutor,
            eventBus: this.eventBus,
            aiProvider: this.aiProvider,
        });
        this._services.register('pluginManager', this.pluginManager);

        return this.workingDir;
    }

    async saveSession(sessionPath) { return await this.sessionController.saveSession(sessionPath); }
    async loadSession(sessionPath) { return await this.sessionController.loadSession(sessionPath); }
    
    deleteHistoryExchanges(count) {
        const deletedExchanges = this.historyManager.deleteHistoryExchanges(count);
        // Sync with Eventic AI provider
        this.statePlugin.loadHistory(this.engine);
        return deletedExchanges;
    }
    
    async saveConversation() {
        return await this.conversationManager.saveActive();
    }

    async loadConversation() {
        try {
            await this.conversationManager.initialize();
            await this.conversationManager.migrateFromLegacy();

            const activeHm = this.conversationManager.getActiveHistoryManager();
            const history = activeHm.getHistory();
            
            // Build system prompt with persona, workspace context, skills, etc.
            const personaContent = this.personaManager ? this.personaManager.renderPersonaPrompt() : '';
            let skillsSummary = '';
            if (this.toolExecutor && this.toolExecutor.skillsManager) {
                try {
                    await this.toolExecutor.skillsManager.ensureInitialized();
                    skillsSummary = this.toolExecutor.skillsManager.getSkillsSummary();
                } catch (e) {
                    // Skills loading failed, continue without them
                }
            }
            this.openclawAvailable = !!(this.openClawManager && this.openClawManager.client && this.openClawManager.client.isConnected);
            const pluginsSummary = this._getPluginsSummary();
            const dynamicRoutesEnabled = process.env.OBOTO_DYNAMIC_ROUTES === 'true';
            const currentSystemPrompt = createSystemPrompt(
                this.workingDir,
                this.workspaceManager.getCurrentWorkspace(),
                null,
                {
                    openclawAvailable: this.openclawAvailable, personaContent, skillsSummary,
                    includeSurfaces: true, includeStyling: true, includeWorkflows: true,
                    pluginsSummary, dynamicRoutesEnabled
                }
            );

            // Inject or update system prompt in history
            if (history.length > 0 && history[0].role === 'system') {
                history[0].content = currentSystemPrompt;
            } else if (history.length === 0) {
                activeHm.initialize(currentSystemPrompt);
            } else {
                history.unshift({ role: 'system', content: currentSystemPrompt });
                activeHm.setHistory(history);
            }

            // Also set on the AI provider for per-request injection
            this.aiProvider.systemPrompt = currentSystemPrompt;

            // Sync up history with AI Provider
            this.historyManager = activeHm;
            this.aiProvider.conversationHistory = JSON.parse(JSON.stringify(activeHm.getHistory()));
            
            // Sync with tools/plugins
            if (this.toolExecutor) {
                this.toolExecutor.historyManager = this.historyManager;
                if (this.toolExecutor.coreHandlers) {
                    this.toolExecutor.coreHandlers.historyManager = this.historyManager;
                }
            }
            if (this.statePlugin) {
                this.statePlugin.historyManager = this.historyManager;
            }

            if (this.eventBus) {
                this.eventBus.emit('server:history-loaded', this.historyManager.getHistory());
                this.eventBus.emit('server:conversation-switched', {
                    name: this.conversationManager.getActiveConversationName(),
                    isDefault: this.conversationManager.isDefaultConversation()
                });
            }
            return activeHm.getHistory().length > 1;
        } catch (error) {
            console.error(`[EventicFacade] Failed to load conversation: ${error.message}`);
            return false;
        }
    }
    
    async listConversations() { return await this.conversationController.listConversations(); }
    async createConversation(name) { return await this.conversationController.createConversation(name); }
    async switchConversation(name) { 
        const result = await this.conversationController.switchConversation(name);
        if (result && result.switched) {
            // Update Eventic's view of history
            this.statePlugin.loadHistory(this.engine);
        }
        return result;
    }
    async clearConversation(name) { return await this.conversationController.clearConversation(name); }
    async deleteConversation(name) { return await this.conversationController.deleteConversation(name); }
    async renameConversation(oldName, newName) { return await this.conversationController.renameConversation(oldName, newName); }
    
    async reportToParent(summary, metadata = {}) { 
        return await this.conversationController.reportToParent(summary, metadata); 
    }
    
    getActiveConversationName() {
        return this.conversationController.getActiveConversationName();
    }

    // ─── Agentic Provider Management ────────────────────────────────────────

    /**
     * List all registered agentic providers.
     * @returns {Array<{id: string, name: string, description: string, active: boolean}>}
     */
    listAgenticProviders() {
        return this.agenticRegistry.list();
    }

    /**
     * Get the currently active agentic provider.
     * @returns {{id: string, name: string, description: string}|null}
     */
    getActiveAgenticProvider() {
        const active = this.agenticRegistry.getActive();
        if (!active) return null;
        return { id: active.id, name: active.name, description: active.description };
    }

    /**
     * Switch the active agentic provider.
     * @param {string} providerId — 'eventic' or 'cognitive'
     * @returns {Promise<{id: string, name: string}>}
     */
    async switchAgenticProvider(providerId) {
        const provider = await this.agenticRegistry.setActive(
            providerId,
            this._getAgenticDeps()
        );

        if (this.eventBus) {
            this.eventBus.emitTyped('agentic:provider-changed', {
                id: provider.id,
                name: provider.name,
                description: provider.description
            });
        }

        return { id: provider.id, name: provider.name };
    }

    getContext() {
        return {
            historyLength: this.aiProvider.conversationHistory.length,
            workspace: this.workingDir,
            currentTodos: this.toolExecutor?.getCurrentTodos() || [],
            errorHistory: this.toolExecutor?.getErrorHistory() || [],
            consciousness: this.engine.context.consciousness?.getSnapshot() || {},
            agenticProvider: this.getActiveAgenticProvider()?.id || null
        };
    }

    displaySessionMemory() {
        return this.sessionController.displaySessionMemory();
    }

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
            const response = await this.aiProvider.ask(prompt, { 
                temperature: 0.1,
                recordHistory: false
            });
            let completion = typeof response === 'string' ? response : (response.content || '');
            completion = completion.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
            return completion;
        } catch (e) {
            console.error(`[EventicFacade] Code completion failed: ${e.message}`);
            return null;
        }
    }

    async generateNextSteps() {
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

            steps.push({ id: 'list-files', label: 'List Files', icon: 'folder', command: 'ls -la', type: 'command' });
            steps.push({ id: 'explain', label: 'Explain Project', icon: 'book-open', prompt: 'Explain what this project does based on the file structure.', type: 'prompt' });

        } catch (e) {
            console.error(`[EventicFacade] Error generating next steps: ${e.message}`);
        }

        if (this.eventBus) {
            this.eventBus.emit('server:next-steps', steps);
        }
        return steps;
    }
}
