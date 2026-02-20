// AssistantFacade — drop-in replacement for MiniAIAssistant
// Delegates run()/runStream() to the async pipeline architecture.
// Exposes the same public API so WS handlers and other consumers need
// minimal or zero changes.

import fs from 'fs';
import path from 'path';
import { config } from '../config.mjs';
import { TOOLS } from '../tools/tool-definitions.mjs';
import { MCP_TOOLS } from '../tools/definitions/mcp-tools.mjs';
import { OPENCLAW_TOOLS } from '../tools/definitions/openclaw-tools.mjs';
import { McpClientManager } from './mcp-client-manager.mjs';
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
import { QualityGate } from './quality-gate.mjs';
import { ResoLangService } from './resolang-service.mjs';
import { PromptRouter, TASK_ROLES } from './prompt-router.mjs';
import { ConsciousnessProcessor } from './consciousness-processor.mjs';
import { emitStatus } from './status-reporter.mjs';

// Pipeline infrastructure
import { ServiceRegistry } from './service-registry.mjs';
import { ConversationLock } from './conversation-lock.mjs';
import { AssistantPipeline } from './assistant-pipeline.mjs';
import { RequestContext } from './request-context.mjs';

// Controllers
import { ConversationController } from './controllers/conversation-controller.mjs';
import { SessionController } from './controllers/session-controller.mjs';
import { AssistantInitializer } from './assistant-setup/assistant-initializer.mjs';

export class AssistantFacade {
    constructor(workingDir, options = {}) {
        // ── Core Configuration ──
        this.promptRouter = new PromptRouter();
        const providerCtx = createProviderContext();
        this.endpoint = providerCtx.endpoint;
        this.workingDir = workingDir || config.system.workspaceRoot || process.cwd();

        // ── Adapters (dependency injection) ──
        this.llmAdapter = options.llmAdapter || {
            generateContent: (req, opts) => callProvider(req, opts),
            generateContentStream: (req, opts) => callProviderStream(req, opts)
        };
        this.statusAdapter = options.statusAdapter || new ConsoleStatusAdapter();
        this.eventBus = options.eventBus;
        this.middleware = options.middleware;

        // ── Sub-systems ──
        this.resoLangService = new ResoLangService(this.workingDir);
        this.memoryAdapter = options.memoryAdapter || this.resoLangService;
        this.taskManager = options.taskManager;
        this.schedulerService = options.schedulerService;
        this.openClawManager = options.openClawManager || null;
        this.workspaceContentServer = options.workspaceContentServer;
        this.personaManager = new PersonaManager(this.workingDir);
        this.mcpClientManager = new McpClientManager(this.workingDir);

        // Configurable limits
        this.maxTurns = options.maxTurns || config.ai.maxTurns;
        this.maxSubagents = options.maxSubagents || config.ai.maxSubagents || 1;

        // Initialize all subsystems
        this.reasoningSystem = new ReasoningSystem();
        this.customToolsManager = new CustomToolsManager();
        this.packageManager = new PackageManager();
        this.workspaceManager = new WorkspaceManager();
        this.qualityEvaluator = new QualityEvaluator(this.endpoint);
        this.historyManager = new HistoryManager();
        this.conversationManager = new ConversationManager(this.workingDir);
        this.manifestManager = new ManifestManager(this.workingDir);

        this.symbolicContinuity = new SymbolicContinuityManager(
            this.workingDir,
            this.llmAdapter,
            this.promptRouter
        );

        this.consciousness = new ConsciousnessProcessor();
        this.factEngine = this.consciousness.factEngine;

        this.dryRun = options.dryRun || false;

        // Tool executor (initialised separately for re-init on workspace change)
        this._initToolExecutor();

        this.qualityGate = new QualityGate(
            this.qualityEvaluator,
            this.historyManager,
            this.workingDir,
            this.workspaceManager
        );

        // OpenClaw availability flag
        this.openclawAvailable = !!(this.openClawManager && this.openClawManager.client && this.openClawManager.client.isConnected);

        // Initialise history with system prompt
        this.historyManager.initialize(
            createSystemPrompt(this.workingDir, this.workspaceManager.getCurrentWorkspace(), null, { openclawAvailable: this.openclawAvailable })
        );

        // Set up history summarizer
        this._setupSummarizer();

        // Initial tool list
        this.allTools = [...TOOLS, ...MCP_TOOLS];
        if (this.openClawManager) this.allTools.push(...OPENCLAW_TOOLS);

        // Model config
        this.model = config.ai.model;
        this.temperature = config.ai.temperature;
        this.customToolsLoaded = false;

        // ── Pipeline Infrastructure ──
        this._services = new ServiceRegistry();
        this._conversationLock = new ConversationLock();
        this._pipeline = new AssistantPipeline();

        // Initialize AssistantInitializer BEFORE registering services (it owns registerServices())
        this.initializer = new AssistantInitializer(this);

        // Register all services into the registry
        this._registerServices();

        // Initialize Controllers
        this.conversationController = new ConversationController(this);
        this.sessionController = new SessionController(this);
    }

    _setupSummarizer() {
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

    // ─── Service Registration ───────────────────────────────────────────

    _registerServices() {
        this.initializer.registerServices(this._services);
    }

    // ─── Tool Executor Initialisation ───────────────────────────────────

    _initToolExecutor() {
        const currentDryRun = this.toolExecutor ? this.toolExecutor.dryRun : this.dryRun;

        this.toolExecutor = new ToolExecutor(
            this.packageManager,
            this.customToolsManager,
            this.workspaceManager,
            AssistantFacade,   // Pass class for recursive calls
            {
                middleware: this.middleware,
                dryRun: currentDryRun,
                historyManager: this.historyManager,
                memoryAdapter: this.memoryAdapter,
                taskManager: this.taskManager,
                schedulerService: this.schedulerService,
                openClawManager: this.openClawManager,
                mcpClientManager: this.mcpClientManager,
                eventBus: this.eventBus,
                personaManager: this.personaManager,
                assistant: this,
                chromeWsBridge: this.chromeWsBridge,
                workspaceContentServer: this.workspaceContentServer
            }
        );

        this.dryRun = currentDryRun;
    }

    // ─── Pipeline Run / RunStream ───────────────────────────────────────

    /**
     * Main entry point — processes user input through the async pipeline.
     * @param {string} userInput
     * @param {Object} [options]
     * @returns {Promise<string>} The assistant's response
     */
    async run(userInput, options = {}) {
        // Backwards compat: boolean → object
        const opts = typeof options === 'boolean'
            ? { isRetry: options }
            : options;

        const { isRetry = false, signal, responseFormat, dryRun = false, model = null } = opts;

        // Ensure custom tools are loaded
        await this.initializeCustomTools();

        // Update dry run state
        this.toolExecutor.setDryRun(dryRun);

        // Refresh service references that may have changed (e.g. after conversation switch)
        this.refreshServices();

        // Build the request context
        const ctx = new RequestContext({
            userInput,
            signal,
            stream: false,
            onChunk: null,
            model,
            responseFormat,
            isRetry,
            dryRun,
            maxTurns: this.maxTurns
        });

        // Execute through per-conversation lock to serialize same-conversation requests
        const convName = this.conversationManager.getActiveConversationName() || 'default';
        return this._conversationLock.acquire(convName, async () => {
            const result = await this._pipeline.execute(ctx, this._services);
            return ctx.finalResponse || "The assistant could not determine a final answer after multiple steps.";
        });
    }

    /**
     * Streaming entry point — processes user input with chunk callbacks.
     * @param {string} userInput
     * @param {Function} onChunk - Callback for each chunk
     * @param {Object} [options]
     * @returns {Promise<string>} The full response
     */
    async runStream(userInput, onChunk, options = {}) {
        await this.initializeCustomTools();

        // Refresh service references
        this.refreshServices();

        const ctx = new RequestContext({
            userInput,
            signal: options.signal,
            stream: true,
            onChunk,
            model: options.model || null,
            responseFormat: options.responseFormat || null,
            isRetry: false,
            dryRun: options.dryRun || false,
            maxTurns: this.maxTurns
        });

        const convName = this.conversationManager.getActiveConversationName() || 'default';
        return this._conversationLock.acquire(convName, async () => {
            await this._pipeline.execute(ctx, this._services);
            return ctx.finalResponse || "The assistant could not determine a final answer after multiple steps.";
        });
    }

    /**
     * Refresh mutable service references in the registry.
     */
    refreshServices() {
        this.initializer.registerServices(this._services);
        
        // Update Component References
        if (this.toolExecutor) {
            this.toolExecutor.historyManager = this.historyManager;
            if (this.toolExecutor.coreHandlers) {
                this.toolExecutor.coreHandlers.historyManager = this.historyManager;
            }
        }

        if (this.qualityGate) {
            this.qualityGate.historyManager = this.historyManager;
        }

        this._setupSummarizer();
    }

    // ─── Custom Tools / System Prompt ───────────────────────────────────

    async initializeCustomTools() {
        return await this.initializer.initializeCustomTools();
    }

    markSystemPromptDirty() {
        this.initializer.markSystemPromptDirty();
    }

    async updateSystemPrompt() {
        return await this.initializer.updateSystemPrompt();
    }

    // ─── Workspace Management ───────────────────────────────────────────

    async changeWorkingDirectory(newDir) {
        const resolvedPath = path.resolve(newDir);

        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Directory not found: ${resolvedPath}`);
        }
        const stat = await fs.promises.stat(resolvedPath);
        if (!stat.isDirectory()) {
            throw new Error(`Path is not a directory: ${resolvedPath}`);
        }

        this.workingDir = resolvedPath;

        try {
            process.chdir(resolvedPath);
        } catch (e) {
            consoleStyler.log('warning', `Could not chdir to ${resolvedPath}: ${e.message}`);
        }

        consoleStyler.log('system', `Changing working directory to: ${this.workingDir}`);

        this.manifestManager = new ManifestManager(this.workingDir);

        if (this.personaManager) {
            await this.personaManager.switchWorkspace(this.workingDir);
        }

        await this.conversationManager.switchWorkspace(this.workingDir);

        this._initToolExecutor();

        this.qualityGate = new QualityGate(
            this.qualityEvaluator,
            this.historyManager,
            this.workingDir,
            this.workspaceManager
        );

        await this.updateSystemPrompt();
        await this.loadConversation();

        return this.workingDir;
    }

    // ─── Session Management ─────────────────────────────────────────────

    async saveSession(sessionPath) {
        return await this.sessionController.saveSession(sessionPath);
    }

    async loadSession(sessionPath) {
        return await this.sessionController.loadSession(sessionPath);
    }

    deleteHistoryExchanges(count) {
        const deletedExchanges = this.historyManager.deleteHistoryExchanges(count);
        if (deletedExchanges > 0) {
            this.qualityEvaluator.reset();
        }
        return deletedExchanges;
    }

    // ─── Conversation Management ────────────────────────────────────────

    async saveConversation() {
        return await this.conversationManager.saveActive();
    }

    async loadConversation() {
        // Initialize logic for ConversationController if needed, 
        // but for now we'll just replicate the loading logic here or expose it
        // Actually, loadConversation is complex init logic.
        // Let's keep it here for now as it sets up the initial state of the facade.
        try {
            await this.conversationManager.initialize();
            await this.conversationManager.migrateFromLegacy();

            const personaContent = this.personaManager ? this.personaManager.renderPersonaPrompt() : '';
            const activeHm = this.conversationManager.getActiveHistoryManager();
            const history = activeHm.getHistory();

            this.openclawAvailable = !!(this.openClawManager && this.openClawManager.client && this.openClawManager.client.isConnected);
            const currentSystemPrompt = createSystemPrompt(
                this.workingDir,
                this.workspaceManager.getCurrentWorkspace(),
                null,
                { openclawAvailable: this.openclawAvailable, personaContent }
            );

            if (history.length > 0 && history[0].role === 'system') {
                history[0].content = currentSystemPrompt;
            } else if (history.length === 0) {
                activeHm.initialize(currentSystemPrompt);
            } else {
                history.unshift({ role: 'system', content: currentSystemPrompt });
                activeHm.setHistory(history);
            }

            this.historyManager = activeHm;
            this.refreshServices();

            await this.symbolicContinuity.initialize(
                this.conversationManager.getActiveConversationName()
            );

            if (this.eventBus) {
                this.eventBus.emit('server:history-loaded', this.historyManager.getHistory());
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

    async listConversations() {
        return await this.conversationController.listConversations();
    }

    async createConversation(name) {
        return await this.conversationController.createConversation(name);
    }

    async switchConversation(name) {
        return await this.conversationController.switchConversation(name);
    }

    async deleteConversation(name) {
        return await this.conversationController.deleteConversation(name);
    }

    async renameConversation(oldName, newName) {
        return await this.conversationController.renameConversation(oldName, newName);
    }

    async reportToParent(summary, metadata = {}) {
        return await this.conversationController.reportToParent(summary, metadata);
    }

    getActiveConversationName() {
        return this.conversationController.getActiveConversationName();
    }

    // ─── Context & Diagnostics ──────────────────────────────────────────

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

    displaySessionMemory() {
        return this.sessionController.displaySessionMemory();
    }

    // ─── Code Completion ────────────────────────────────────────────────

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
            const result = await this.llmAdapter.generateContent({
                model: this.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: 64,
                stop: ['\n\n', '[CODE SUFFIX]']
            });

            let completion = result.choices[0].message.content;
            completion = completion.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
            return completion;
        } catch (e) {
            consoleStyler.log('error', `Code completion failed: ${e.message}`);
            return null;
        }
    }

    // ─── Next Steps ─────────────────────────────────────────────────────

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
            consoleStyler.log('error', `Error generating next steps: ${e.message}`);
        }

        if (this.eventBus) {
            this.eventBus.emit('server:next-steps', steps);
        }
        return steps;
    }

    // ─── Transcript Logging ─────────────────────────────────────────────

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
}

// Also export as MiniAIAssistant for backward compatibility
export { AssistantFacade as MiniAIAssistant };
