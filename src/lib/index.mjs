import { MiniAIAssistant } from '../core/ai-assistant.mjs';
import { ConsoleStatusAdapter } from './adapters/console-status-adapter.mjs';
import { NetworkLLMAdapter } from './adapters/network-llm-adapter.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';
import { config } from '../config.mjs';

/**
 * Error thrown when an agent execution is cancelled via AbortSignal.
 */
export class CancellationError extends Error {
    constructor(message = 'Agent execution was cancelled') {
        super(message);
        this.name = 'CancellationError';
    }
}

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
        // This ensures that internal components using consoleStyler route logs through the adapter
        if (cfg.statusAdapter) {
             consoleStyler.setListener(this.statusAdapter);
        }

        // Initialize the core assistant with injected dependencies
        this.assistant = new MiniAIAssistant(this.workingDir, {
            llmAdapter: this.llmAdapter,
            maxTurns: cfg.maxTurns
        });
    }

    /**
     * Initialize the system (loads tools, manifests, etc.)
     */
    async initialize() {
        await this.assistant.initializeCustomTools();
    }

    /**
     * Execute a high-level task
     * @param {string} task - The task description
     * @param {Object} [options] - Execution options
     * @param {AbortSignal} [options.signal] - AbortSignal to cancel execution
     * @returns {Promise<string>} The result of the task execution
     * @throws {CancellationError} If execution is cancelled via signal
     *
     * @example
     * const controller = new AbortController();
     * const promise = aiMan.execute('build feature X', { signal: controller.signal });
     * // Cancel after 60 seconds
     * setTimeout(() => controller.abort(), 60000);
     * try {
     *   const result = await promise;
     * } catch (err) {
     *   if (err instanceof CancellationError) console.log('Cancelled');
     * }
     */
    async execute(task, options = {}) {
        // Ensure initialized
        if (!this.assistant.customToolsLoaded) {
            await this.initialize();
        }
        
        this.statusAdapter.onToolStart('ai_man_execute', { task });
        
        try {
            const result = await this.assistant.run(task, { signal: options.signal });
            this.statusAdapter.onToolEnd('ai_man_execute', result);
            return result;
        } catch (error) {
            // Wrap AbortError into our CancellationError for a cleaner public API
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
     * @param {string} task - The task description
     * @param {Function} onChunk - Callback for each chunk of streamed content
     * @param {Object} [options] - Execution options
     * @param {AbortSignal} [options.signal] - AbortSignal to cancel execution
     * @returns {Promise<string>} The final result
     * @throws {CancellationError} If execution is cancelled via signal
     */
    async executeStream(task, onChunk, options = {}) {
        // Ensure initialized
        if (!this.assistant.customToolsLoaded) {
            await this.initialize();
        }

        this.statusAdapter.onToolStart('ai_man_execute_stream', { task });

        try {
            const result = await this.assistant.runStream(task, onChunk, { signal: options.signal });
            this.statusAdapter.onToolEnd('ai_man_execute_stream', result);
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
     * Get the tool definition for integrating this library as a tool in another agent
     * @returns {Object} JSON Schema for the tool
     */
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
    
    /**
     * Get the current status/context of the assistant
     * @returns {Object} Context object
     */
    getContext() {
        return this.assistant.getContext();
    }
}

// Re-export adapters and core types for convenience
export { ConsoleStatusAdapter } from './adapters/console-status-adapter.mjs';
export { NetworkLLMAdapter } from './adapters/network-llm-adapter.mjs';
export { MiniAIAssistant } from '../core/ai-assistant.mjs';
export { config } from '../config.mjs';
export { consoleStyler } from '../ui/console-styler.mjs';
