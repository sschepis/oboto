import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * Eventic Tools Plugin
 * 
 * Bridges the robust ToolExecutor from the legacy pipeline into the new Eventic engine.
 * Registers all available tools and MCP features so Eventic's AI can use them.
 */
export class EventicToolsPlugin {
    constructor(toolExecutor) {
        this.toolExecutor = toolExecutor;
        this.type = 'plugin';
    }

    install(eventic) {
        // Register static built-in tools
        for (const [name, toolDef] of this.toolExecutor.toolRegistry.entries()) {
            eventic.registerTool(name, async (args, options) => {
                return await this._execute(name, args, options);
            });
        }

        // Expose legacy ToolExecutor tool list directly on engine
        eventic.getAvailableTools = () => this.toolExecutor.getAllToolDefinitions();

        // Proxy eventic.tools.get to dynamically resolve plugin, custom, and MCP tools.
        // Uses getToolFunction() for plugin + custom tool lookup (avoids accessing private internals).
        const originalToolsGet = eventic.tools.get.bind(eventic.tools);
        eventic.tools.get = (name) => {
            let tool = originalToolsGet(name);
            if (tool) return tool;

            // Check Plugin Tools + Custom Tools via public API
            if (this.toolExecutor.getToolFunction(name)) {
                return async (args, options) => await this._execute(name, args, options);
            }

            // Check MCP Tools (not covered by getToolFunction)
            if (this.toolExecutor.mcpClientManager && name.startsWith('mcp_')) {
                return async (args, options) => await this._execute(name, args, options);
            }

            return undefined;
        };
    }

    async _execute(functionName, args, options = {}) {
        const toolCall = {
            id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            function: {
                name: functionName,
                // Handle Eventic passing an object vs string argument
                arguments: typeof args === 'string' ? args : JSON.stringify(args || {})
            }
        };

        try {
            const result = await this.toolExecutor.executeTool(toolCall, options);
            return result.content;
        } catch (err) {
            consoleStyler.log('error', `[EventicToolsPlugin] Tool execution failed: ${err.message}`);
            return `Error: ${err.message}`;
        }
    }
}
