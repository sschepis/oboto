import { consoleStyler } from '../ui/console-styler.mjs';
import { Eventic, defaultTools } from './eventic.mjs';
import { EventicAIProvider } from './eventic-ai-plugin.mjs';
import { EventicToolsPlugin } from './eventic-tools-plugin.mjs';
import { EventicStatePlugin } from './eventic-state-plugin.mjs';
import { TaskCheckpointManager } from './task-checkpoint-manager.mjs';
import { config } from '../config.mjs';

// Agentic provider system
import { AgenticProviderRegistry, EventicProvider, CognitiveProvider, LMScriptProvider, MahaProvider, MegacodeProvider } from './agentic/index.mjs';

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

// Extracted modules
import {
    updateSystemPrompt as _updateSystemPrompt,
    queueChimeIn as _queueChimeIn,
    drainGuidanceQueue as _drainGuidanceQueue,
    getGuidanceQueue as _getGuidanceQueue,
    getPluginsSummary as _getPluginsSummary,
    generateCodeCompletion as _generateCodeCompletion
} from './facade-prompt.mjs';
import {
    saveConversation as _saveConversation,
    loadConversation as _loadConversation,
    deleteHistoryExchanges as _deleteHistoryExchanges,
    switchConversation as _switchConversation,
    generateNextSteps as _generateNextSteps,
    changeWorkingDirectory as _changeWorkingDirectory
} from './facade-conversation.mjs';

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
                consoleStyler.logError('error', 'CheckpointManager init error', err);
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
                        consoleStyler.log('info', msg);
                    }
                }
            ],
            context: {
                files: {},
                memory: {},
                workingDir: this.workingDir,
                eventBus: this.eventBus,
                consciousness: this.consciousness,
                facade: this
            }
        });

        // Instantiate our new EventicAIProvider wrapping the legacy ai-provider.mjs
        this.aiProvider = new EventicAIProvider({
            model: options.model || config?.ai?.model,
            timeout: 300_000  // 5min — accommodates local models (LMStudio) on complex prompts
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

        // LMScript CLI-driven agent loop with dual holographic memory
        const lmscriptProvider = new LMScriptProvider();
        this.agenticRegistry.register(lmscriptProvider);

        // Maha unified provider (routes to the best-fit provider per request)
        const mahaProvider = new MahaProvider();
        this.agenticRegistry.register(mahaProvider);

        // Megacode provider for large-scale code generation
        const megacodeProvider = new MegacodeProvider();
        this.agenticRegistry.register(megacodeProvider);

        // Activate the configured provider (default: maha).
        // Changed from 'eventic' → 'cognitive' in 2026-02-26, then to 'maha' in 2026-03-18.
        // NOTE: If the user explicitly set agenticProvider in config, that is
        // honored.  The default only applies to fresh installations.
        const defaultAgenticProvider = config?.ai?.agenticProvider || 'maha';
        if (!config?.ai?.agenticProvider) {
            consoleStyler.log('system', `Agentic provider defaulting to "${defaultAgenticProvider}" (override via config.ai.agenticProvider)`);
        }
        this._agenticInitPromise = this.agenticRegistry.setActive(
            defaultAgenticProvider,
            this._getAgenticDeps()
        ).catch(err => {
            consoleStyler.log('warning', `Failed to activate agentic provider "${defaultAgenticProvider}", falling back to eventic: ${err.message}`);
            return this.agenticRegistry.setActive('eventic', this._getAgenticDeps());
        }).catch(err => {
            // Both primary and fallback failed — log and let run()/runStream() handle the null provider
            consoleStyler.log('error', `All agentic providers failed to activate: ${err.message}`);
        });

        // Track the facade's busy state
        this._isBusy = false;
        
        // Guidance injection queue — allows users to inject mid-run commentary
        this._guidanceQueue = [];
        
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
            const runOpts = {
                signal: options.signal,
                model: options.model,
                ws: options.ws
            };
            // Forward streaming options so that the provider → agent pipeline
            // can stream tokens directly via the onChunk callback.
            if (options.onChunk) {
                runOpts.stream = true;
                runOpts.onChunk = options.onChunk;
            }
            const result = await provider.run(userInput, runOpts);
            // Providers may return a string or { response, streamed, tokenUsage }
            const response = typeof result === 'string' ? result : (result?.response || '');
            const tokenUsage = typeof result === 'object' ? result?.tokenUsage : null;
            // Store token usage on the facade so callers (e.g. chat-handler)
            // can read it after run() completes.
            this._lastTokenUsage = tokenUsage || null;
            return response.trim() ? response : 'No response generated.';
        } catch (err) {
            consoleStyler.logError('error', 'Run error', err);
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

            // Wrap onChunk to track whether any chunks were emitted by the
            // provider/agent pipeline so we can fall back gracefully.
            let chunksEmitted = false;
            const trackingChunk = typeof onChunk === 'function' ? (delta) => {
                chunksEmitted = true;
                onChunk(delta);
            } : onChunk;

            const result = await provider.run(userInput, {
                signal: options.signal,
                model: options.model,
                stream: true,
                onChunk: trackingChunk
            });
            
            const responseText = typeof result === 'string' ? result : (result?.response || '');
            
            // Only emit full response as fallback if no chunks were streamed
            // (e.g. provider doesn't support streaming internally)
            if (!chunksEmitted && typeof onChunk === 'function' && responseText) {
                onChunk(responseText);
            }
            
            return responseText.trim() ? responseText : 'No response generated.';
        } catch (err) {
            consoleStyler.logError('error', 'Stream error', err);
            return `Error: ${err.message}`;
        } finally {
            this._isBusy = false;
        }
    }

    // ─── Prompt & Guidance (delegated to facade-prompt.mjs) ──────────────

    queueChimeIn(message, source = 'user') { return _queueChimeIn(this, message, source); }
    drainGuidanceQueue() { return _drainGuidanceQueue(this); }
    getGuidanceQueue() { return _getGuidanceQueue(this); }
    _getPluginsSummary() { return _getPluginsSummary(this); }
    async updateSystemPrompt() { return await _updateSystemPrompt(this); }

    // ─── Conversation lifecycle (delegated to facade-conversation.mjs) ───

    async saveConversation() { return await _saveConversation(this); }
    async loadConversation() { return await _loadConversation(this); }
    deleteHistoryExchanges(count) { return _deleteHistoryExchanges(this, count); }
    async switchConversation(name) { return await _switchConversation(this, name); }

    // ─── Remaining conversation controller delegates ─────────────────────

    async listConversations() { return await this.conversationController.listConversations(); }
    async createConversation(name) { return await this.conversationController.createConversation(name); }
    async clearConversation(name) { return await this.conversationController.clearConversation(name); }
    async deleteConversation(name) { return await this.conversationController.deleteConversation(name); }
    async renameConversation(oldName, newName) { return await this.conversationController.renameConversation(oldName, newName); }

    async reportToParent(summary, metadata = {}) { 
        return await this.conversationController.reportToParent(summary, metadata); 
    }
    
    getActiveConversationName() {
        return this.conversationController.getActiveConversationName();
    }

    // ─── State & accessors ───────────────────────────────────────────────

    isBusy() { return this._isBusy; }

    get allTools() {
        if (!this.toolExecutor) return [];
        return this.toolExecutor.getAllToolDefinitions();
    }

    get model() { return this.aiProvider.model; }
    set model(newModel) { this.aiProvider.model = newModel; }

    markSystemPromptDirty() {
        // System prompts are injected per-request in Eventic default loops
    }

    // ─── Initialization helpers ──────────────────────────────────────────

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

    // ─── Workspace switching ─────────────────────────────────────────────

    async changeWorkingDirectory(newDir) {
        return await _changeWorkingDirectory(this, newDir);
    }

    // ─── Session management ──────────────────────────────────────────────

    async saveSession(sessionPath) { return await this.sessionController.saveSession(sessionPath); }
    async loadSession(sessionPath) { return await this.sessionController.loadSession(sessionPath); }

    // ─── Agentic Provider Management ────────────────────────────────────

    listAgenticProviders() { return this.agenticRegistry.list(); }

    getActiveAgenticProvider() {
        const active = this.agenticRegistry.getActive();
        if (!active) return null;
        return { id: active.id, name: active.name, description: active.description };
    }

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

    // ─── Context & features ──────────────────────────────────────────────

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
        return await _generateCodeCompletion(this, fileContent, cursorOffset, filePath);
    }

    async generateNextSteps(userInput, aiResponse) {
        return await _generateNextSteps(this, userInput, aiResponse);
    }
}
