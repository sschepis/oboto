import { AssistantFacade as MiniAIAssistant } from '../core/assistant-facade.mjs';
import { ConsoleStatusAdapter } from './adapters/console-status-adapter.mjs';
import { NetworkLLMAdapter } from './adapters/network-llm-adapter.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';
import { AiManEventBus } from './event-bus.mjs';
import { MiddlewareChain } from './middleware.mjs';
import { TaskManager } from '../core/task-manager.mjs';
import { CancellationError } from './cancellation-error.mjs';
import { DesignResult } from './design-result.mjs';
import { runDesign, runImplement, runTest, runReview } from './workflows.mjs';

/**
 * Main entry point for the AI Man Library.
 * Provides a structured interface for integrating the AI system into other agents or applications.
 */
export class AiMan {
    /**
     * Create a new AI Man instance
     * @param {Object} config - Configuration options
     * @param {string} [config.workingDir] - Working directory (defaults to process.cwd())
     * @param {Object} [config.llmAdapter] - Adapter for LLM calls (defaults to NetworkLLMAdapter)
     * @param {Object} [config.statusAdapter] - Adapter for status/logging (defaults to ConsoleStatusAdapter)
     * @param {number} [config.maxTurns] - Maximum conversation turns per execution (defaults to AI_MAX_TURNS env or 30)
     * @param {Object} [config.overrides] - Overrides for internal components (model, temperature, etc.)
     */
    constructor(cfg = {}) {
        this.workingDir = cfg.workingDir || process.cwd();
        
        // Initialize adapters
        this.llmAdapter = cfg.llmAdapter || new NetworkLLMAdapter(cfg.overrides || {});
        this.statusAdapter = cfg.statusAdapter || new ConsoleStatusAdapter();
        
        // Configure global logger redirect if a custom status adapter is provided
        if (cfg.statusAdapter) {
             consoleStyler.setListener(this.statusAdapter);
        }

        // Initialize event bus and middleware
        this.events = new AiManEventBus();
        this.middleware = new MiddlewareChain();
        this.taskManager = new TaskManager(this.events);

        // Store config for creating fresh assistants in design/implement
        this._cfg = cfg;
        this._registeredTools = [];

        // Initialize the core assistant with injected dependencies
        this.memoryAdapter = cfg.memoryAdapter || null;
        this.assistant = new MiniAIAssistant(this.workingDir, {
            llmAdapter: this.llmAdapter,
            statusAdapter: this.statusAdapter,
            maxTurns: cfg.maxTurns,
            eventBus: this.events,
            middleware: this.middleware,
            memoryAdapter: this.memoryAdapter,
            taskManager: this.taskManager
        });
    }

    /**
     * Subscribe to lifecycle events
     * @param {string} event - Event name
     * @param {Function} listener - Callback function
     * @returns {this}
     */
    on(event, listener) {
        this.events.on(event, listener);
        return this;
    }

    /**
     * Unsubscribe from lifecycle events
     * @param {string} event - Event name
     * @param {Function} listener - Callback function
     * @returns {this}
     */
    off(event, listener) {
        this.events.off(event, listener);
        return this;
    }

    /**
     * Add middleware to the execution chain
     * @param {Object} middleware - Middleware object with hooks
     * @returns {this}
     */
    use(middleware) {
        this.middleware.use(middleware);
        return this;
    }

    /**
     * Initialize the system (loads tools, manifests, etc.)
     */
    async initialize() {
        await this.assistant.initializeCustomTools();
    }

    /**
     * Create a fresh assistant instance (used by design/implement to get clean conversation state)
     * @returns {MiniAIAssistant}
     * @private
     */
    _createAssistant() {
        const assistant = new MiniAIAssistant(this.workingDir, {
            llmAdapter: this.llmAdapter,
            statusAdapter: this.statusAdapter,
            maxTurns: this._cfg.maxTurns,
            eventBus: this.events,
            middleware: this.middleware,
            memoryAdapter: this.memoryAdapter,
            taskManager: this.taskManager
        });
        // Replay registered tools on fresh assistants
        for (const { schema, handler } of this._registeredTools) {
            assistant.allTools.push(schema);
            assistant.toolExecutor.registerTool(schema.function.name, handler);
        }
        return assistant;
    }

    registerTool(schema, handler) {
        this._registeredTools.push({ schema, handler });
        this.assistant.allTools.push(schema);
        this.assistant.toolExecutor.registerTool(schema.function.name, handler);
        return this;
    }

    /**
     * Create a fork of the current conversation state.
     * @returns {AiMan} A new AiMan instance with independent state
     */
    fork() {
        // Create new instance with same config
        const forked = new AiMan({
            ...this._cfg,
            workingDir: this.workingDir,
            llmAdapter: this.llmAdapter,
            statusAdapter: this.statusAdapter,
        });
        
        // Inject the cloned history
        forked.assistant.historyManager = this.assistant.historyManager.clone();
        
        // Copy tools state
        forked.assistant.customToolsLoaded = this.assistant.customToolsLoaded;
        forked.assistant.allTools = [...this.assistant.allTools];
        
        // Copy registered custom tools
        forked._registeredTools = [...this._registeredTools];
        
        // Re-register tool handlers in the new executor
        for (const { schema, handler } of this._registeredTools) {
            forked.assistant.toolExecutor.registerTool(schema.function.name, handler);
        }
        
        return forked;
    }

    /**
     * Create a named checkpoint of the current conversation state
     * @param {string} name - Checkpoint name
     * @returns {this}
     */
    checkpoint(name) {
        this.assistant.historyManager.checkpoint(name);
        return this;
    }

    /**
     * Rollback conversation to a named checkpoint
     * @param {string} name - Checkpoint name
     * @returns {number} Timestamp of the checkpoint
     */
    rollbackTo(name) {
        return this.assistant.historyManager.rollbackTo(name);
    }

    /**
     * List all conversation checkpoints
     * @returns {Array<{name: string, timestamp: number, messageCount: number}>}
     */
    listCheckpoints() {
        return this.assistant.historyManager.listCheckpoints();
    }

    /**
     * Send a conversational message to the assistant.
     * @param {string} message - The message to send
     * @param {Object} [options] - Execution options
     */
    async chat(message, options = {}) {
        if (!this.assistant.customToolsLoaded) {
            await this.initialize();
        }

        this.statusAdapter.onToolStart('ai_man_chat', { message });
        this.events.emitTyped('tool:start', { toolName: 'ai_man_chat', args: { message } });

        try {
            const result = await this.assistant.run(message, options);
            this.statusAdapter.onToolEnd('ai_man_chat', result);
            this.events.emitTyped('tool:end', { toolName: 'ai_man_chat', result });
            return result;
        } catch (error) {
            if (error.name === 'AbortError') {
                const cancellation = new CancellationError(error.message);
                this.statusAdapter.log('system', 'Chat was cancelled');
                throw cancellation;
            }
            const errorMessage = `Chat failed: ${error.message}`;
            this.statusAdapter.log('error', errorMessage);
            throw error;
        }
    }

    /**
     * Execute a high-level task
     * @param {string} task - The task description
     * @param {Object} [options] - Execution options
     */
    async execute(task, options = {}) {
        if (!this.assistant.customToolsLoaded) {
            await this.initialize();
        }
        
        this.statusAdapter.onToolStart('ai_man_execute', { task });
        this.events.emitTyped('tool:start', { toolName: 'ai_man_execute', args: { task } });
        
        try {
            const result = await this.assistant.run(task, options); 
            this.statusAdapter.onToolEnd('ai_man_execute', result);
            this.events.emitTyped('tool:end', { toolName: 'ai_man_execute', result });
            return result;
        } catch (error) {
            if (error.name === 'AbortError') {
                const cancellation = new CancellationError(error.message);
                this.statusAdapter.log('system', 'Agent execution was cancelled');
                throw cancellation;
            }
            const errorMessage = `Execution failed: ${error.message}`;
            this.statusAdapter.log('error', errorMessage);
            throw error;
        }
    }

    /**
     * Execute a high-level task with streaming output
     */
    async executeStream(task, onChunk, options = {}) {
        if (!this.assistant.customToolsLoaded) {
            await this.initialize();
        }

        this.statusAdapter.onToolStart('ai_man_execute_stream', { task });
        this.events.emitTyped('tool:start', { toolName: 'ai_man_execute_stream', args: { task } });

        try {
            const result = await this.assistant.runStream(task, onChunk, { signal: options.signal });
            this.statusAdapter.onToolEnd('ai_man_execute_stream', result);
            this.events.emitTyped('tool:end', { toolName: 'ai_man_execute_stream', result });
            return result;
        } catch (error) {
            if (error.name === 'AbortError') {
                const cancellation = new CancellationError(error.message);
                this.statusAdapter.log('system', 'Agent execution was cancelled');
                throw cancellation;
            }
            const errorMessage = `Execution failed: ${error.message}`;
            this.statusAdapter.log('error', errorMessage);
            throw error;
        }
    }

    /**
     * Design phase: Run the agent to produce a structured technical design document.
     */
    async design(task, options = {}) {
        return runDesign(() => this._createAssistant(), this.statusAdapter, task, options);
    }

    /**
     * Implementation phase: Take a design result and implement all features.
     */
    async implement(designResult, options = {}) {
        return runImplement(() => this._createAssistant(), this.statusAdapter, designResult, options);
    }

    /**
     * Generate and run tests for an implementation.
     */
    async test(implementationResult, options = {}) {
        return runTest(() => this._createAssistant(), implementationResult, options);
    }

    /**
     * Review implementation against design.
     */
    async review(designResult, implementationResult, options = {}) {
        return runReview(() => this._createAssistant(), designResult, implementationResult, options);
    }

    /**
     * Convenience method: Design and implement in one call.
     */
    async designAndImplement(task, options = {}) {
        const { signal, onDesignComplete, ...rest } = options;

        this.statusAdapter.log('system', 'Starting design phase...');
        const design = await this.design(task, { signal, ...rest });

        this.statusAdapter.log('system', 'Design phase complete. Starting implementation phase...');
        
        if (typeof onDesignComplete === 'function') {
            onDesignComplete(design);
        }

        const result = await this.implement(design, { signal, ...rest });

        return { design, result };
    }

    // Async Task Public API
    
    spawnTask(query, description, options = {}) {
        return this.taskManager.spawnTask(query, description, MiniAIAssistant, options);
    }

    getTaskStatus(taskId) {
        return this.taskManager.getTask(taskId);
    }

    listTasks(filter) {
        return this.taskManager.listTasks(filter);
    }

    waitForTask(taskId, timeout) {
        return this.taskManager.waitForTask(taskId, timeout);
    }

    getToolDefinition() {
        return {
            name: "execute_software_development_task",
            description: "Execute a complex software development task using the AI Man system. Capable of planning, coding, debugging, and verifying software features.",
            parameters: {
                type: "object",
                properties: {
                    task: {
                        type: "string",
                        description: "The detailed description of the task to perform. Be specific about requirements."
                    }
                },
                required: ["task"]
            }
        };
    }
    
    getContext() {
        return this.assistant.getContext();
    }
}

// Re-export adapters and core types for convenience
export { ConsoleStatusAdapter } from './adapters/console-status-adapter.mjs';
export { NetworkLLMAdapter } from './adapters/network-llm-adapter.mjs';
export { AssistantFacade, AssistantFacade as MiniAIAssistant } from '../core/assistant-facade.mjs';
export { config } from '../config.mjs';
export { consoleStyler } from '../ui/console-styler.mjs';
export { AiManEventBus } from './event-bus.mjs';
export { MiddlewareChain } from './middleware.mjs';
export { FlowManager } from '../structured-dev/flow-manager.mjs';
export { ManifestManager } from '../structured-dev/manifest-manager.mjs';
export { C4Visualizer } from '../structured-dev/c4-visualizer.mjs';
export { KnowledgeGraphBuilder } from '../structured-dev/knowledge-graph-builder.mjs';
export { CiCdArchitect } from '../structured-dev/cicd-architect.mjs';
export { ContainerizationWizard } from '../structured-dev/containerization-wizard.mjs';
export { ApiDocSmith } from '../structured-dev/api-doc-smith.mjs';
export { TutorialGenerator } from '../structured-dev/tutorial-generator.mjs';
export { EnhancementGenerator } from '../structured-dev/enhancement-generator.mjs';
export { CancellationError } from './cancellation-error.mjs';
export { DesignResult } from './design-result.mjs';
export { WorkflowService } from '../services/workflow-service.mjs';
export { MemoryAdapter } from './adapters/memory-adapter.mjs';

/**
 * Alias for AiMan, emphasizing the robotic developer persona.
 */
export const Oboto = AiMan;
