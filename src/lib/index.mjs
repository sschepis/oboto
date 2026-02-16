import { MiniAIAssistant } from '../core/ai-assistant.mjs';
import { ConsoleStatusAdapter } from './adapters/console-status-adapter.mjs';
import { NetworkLLMAdapter } from './adapters/network-llm-adapter.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';

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
     * @param {Object} [config.overrides] - Overrides for internal components (model, temperature, etc.)
     */
    constructor(config = {}) {
        this.workingDir = config.workingDir || process.cwd();
        
        // Initialize adapters
        this.llmAdapter = config.llmAdapter || new NetworkLLMAdapter(config.overrides || {});
        this.statusAdapter = config.statusAdapter || new ConsoleStatusAdapter();
        
        // Configure global logger redirect if a custom status adapter is provided
        // This ensures that internal components using consoleStyler route logs through the adapter
        if (config.statusAdapter) {
             consoleStyler.setListener(this.statusAdapter);
        }

        // Initialize the core assistant with injected dependencies
        this.assistant = new MiniAIAssistant(this.workingDir, {
            llmAdapter: this.llmAdapter
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
     * @returns {Promise<string>} The result of the task execution
     */
    async execute(task) {
        // Ensure initialized
        if (!this.assistant.customToolsLoaded) {
            await this.initialize();
        }
        
        this.statusAdapter.onToolStart('ai_man_execute', { task });
        
        try {
            const result = await this.assistant.run(task);
            this.statusAdapter.onToolEnd('ai_man_execute', result);
            return result;
        } catch (error) {
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

// Re-export adapters for convenience
export { ConsoleStatusAdapter } from './adapters/console-status-adapter.mjs';
export { NetworkLLMAdapter } from './adapters/network-llm-adapter.mjs';
