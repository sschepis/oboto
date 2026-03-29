import { consoleStyler } from '../ui/console-styler.mjs';
import { Eventic, defaultTools } from './eventic.mjs';
import { EventicAIProvider } from './eventic-ai-plugin.mjs';
import { EventicToolsPlugin } from './eventic-tools-plugin.mjs';
import { EventicStatePlugin } from './eventic-state-plugin.mjs';
import { TaskCheckpointManager } from './task-checkpoint-manager.mjs';
import { config } from '../config.mjs';

// Agentic provider system
import { AgenticProviderRegistry, UnifiedProvider, NewAgentProvider } from './agentic/index.mjs';

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

// Conversation-to-agent promotion
import { ConversationAgentManager } from './agent/conversation-agent-manager.mjs';

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
        // historyManager is now a getter that resolves through conversationManager
        // (see the `get historyManager()` accessor below).  We store a fallback
        // HistoryManager for use before conversationManager is initialized.
        this._fallbackHistoryManager = new HistoryManager();
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

        // Unified provider — combines cognitive, safety, memory & learning layers
        const unifiedProvider = new UnifiedProvider();
        this.agenticRegistry.register(unifiedProvider);

        // NewAgent provider — autonomous CLI-style agent with VFS, dual memory,
        // AST pipeline, and batch command execution via AgentRunner
        const newAgentProvider = new NewAgentProvider();
        this.agenticRegistry.register(newAgentProvider);

        // Activate the configured provider (default: unified).
        const defaultAgenticProvider = config?.ai?.agenticProvider || 'unified';
        this._agenticInitPromise = this.agenticRegistry.setActive(
            defaultAgenticProvider,
            this._getAgenticDeps()
        ).catch(err => {
            consoleStyler.log('error', `Failed to activate agentic provider "${defaultAgenticProvider}": ${err.message}`);
        });

        // ── Conversation-to-Agent Promotion Manager ────────────────────────
        // Must be created after aiProvider, toolExecutor, and engine are available
        // so that _getAgenticDeps() returns fully-populated deps.
        this.conversationAgentManager = new ConversationAgentManager({
            workingDir: this.workingDir,
            deps: this._getAgenticDeps(),
        });
        // Initialize in background — non-blocking so the facade constructor stays sync-friendly
        this._agentManagerInitPromise = this.conversationAgentManager.initialize().catch(err => {
            consoleStyler.log('error', `ConversationAgentManager init error: ${err.message}`);
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
            resoLangService: this.resoLangService,
            workingDir: this.workingDir,
            engine: this.engine,
            config,
            userConfig: config?.ai?.agentic || {},
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

    // ─── Conversation-to-Agent Promotion delegates ───────────────────────

    /**
     * Promote a conversation to a standalone agent.
     *
     * @param {Object} config
     * @param {string} config.conversationName — name of conversation to promote
     * @param {string} [config.agentName] — human-readable name for the agent
     * @param {'fork'|'in-place'} [config.mode='fork'] — promotion mode
     * @param {string} [config.instruction] — initial instruction
     * @param {string} [config.persona] — persona overlay
     * @param {Object} [config.toolRestrictions] — tool access restrictions
     * @returns {Promise<Object>} promotion result
     */
    async promoteConversation(config) {
        if (this._agentManagerInitPromise) {
            await this._agentManagerInitPromise;
            this._agentManagerInitPromise = null;
        }

        const ctx = this.conversationManager.getConversationContext(config.conversationName);
        if (!ctx) {
            throw new Error(`Conversation "${config.conversationName}" not found.`);
        }

        // Get the shared MemorySystem from the active unified provider (if available)
        const activeProvider = this.agenticRegistry.getActive();
        const memorySystem = activeProvider?._memorySystem ?? null;

        return await this.conversationAgentManager.createAgent({
            conversationContext: ctx,
            parentConversation: config.conversationName,
            agentName: config.agentName,
            mode: config.mode,
            instruction: config.instruction,
            persona: config.persona,
            toolRestrictions: config.toolRestrictions,
            memorySystem,
        });
    }

    /**
     * List all promoted agents.
     * @returns {Array<Object>}
     */
    listPromotedAgents() {
        return this.conversationAgentManager.listAgents();
    }

    /**
     * Send a message to a promoted agent.
     * @param {string} agentId
     * @param {string} message
     * @returns {Promise<string>}
     */
    async sendAgentMessage(agentId, message) {
        if (this._agentManagerInitPromise) {
            await this._agentManagerInitPromise;
            this._agentManagerInitPromise = null;
        }
        return await this.conversationAgentManager.sendMessage(agentId, message);
    }

    /**
     * Terminate a promoted agent.
     * @param {string} agentId
     * @returns {{ agentId: string }}
     */
    terminateAgent(agentId) {
        return this.conversationAgentManager.terminateAgent(agentId);
    }

    /**
     * Pause a promoted agent.
     * @param {string} agentId
     * @returns {{ agentId: string, status: string }}
     */
    pauseAgent(agentId) {
        return this.conversationAgentManager.pauseAgent(agentId);
    }

    /**
     * Resume a paused promoted agent.
     * @param {string} agentId
     * @returns {{ agentId: string, status: string }}
     */
    resumeAgent(agentId) {
        return this.conversationAgentManager.resumeAgent(agentId);
    }

    /**
     * Get status/diagnostics for a promoted agent.
     * @param {string} agentId
     * @returns {Object}
     */
    getAgentStatus(agentId) {
        return this.conversationAgentManager.getAgentStatus(agentId);
    }

    // ─── State & accessors ───────────────────────────────────────────────

    /**
     * Dynamic getter for historyManager — resolves through the ConversationManager
     * so callers always get the active conversation's HistoryManager without the
     * facade holding a stale reference.
     */
    get historyManager() {
        try {
            return this.conversationManager.getActiveHistoryManager();
        } catch {
            return this._fallbackHistoryManager;
        }
    }

    /**
     * Setter for backward compatibility — assignments are no-ops since
     * the getter now resolves dynamically.  Callers that previously wrote
     * `facade.historyManager = x` will silently succeed without effect.
     */
    set historyManager(_hm) {
        // No-op: historyManager is now resolved dynamically via getter.
        // Assignments are accepted silently for backward compatibility.
    }

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
        // Services resolve historyManager dynamically via the facade getter,
        // but some subsystems cache the reference.  Update those caches.
        const hm = this.historyManager;
        if (this.toolExecutor) {
            this.toolExecutor.historyManager = hm;
            if (this.toolExecutor.coreHandlers) {
                this.toolExecutor.coreHandlers.historyManager = hm;
            }
        }
        if (this.statePlugin) {
            this.statePlugin.historyManager = hm;
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
