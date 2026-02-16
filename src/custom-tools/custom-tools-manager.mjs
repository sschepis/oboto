// Custom tools management system
// Handles loading, saving, validating, and managing custom tools

import path from 'path';
import { fileURLToPath } from 'url';
import { consoleStyler } from '../ui/console-styler.mjs';

export class CustomToolsManager {
    constructor() {
        this.customTools = new Map(); // Map of tool_name -> function
        this.customToolSchemas = new Map(); // Map of tool_name -> schema
        this.toolsFilePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tools.json');
    }

    // Load custom tools from .tools.json on startup
    async loadCustomTools() {
        try {
            const fs = await import('fs');
            if (!fs.existsSync(this.toolsFilePath)) {
                consoleStyler.log('tools', `No custom tools file found at ${this.toolsFilePath}`);
                return [];
            }

            const toolsData = JSON.parse(fs.readFileSync(this.toolsFilePath, 'utf8'));
            let loadedCount = 0;
            const loadedSchemas = [];

            for (const [toolName, toolDef] of Object.entries(toolsData.tools || {})) {
                try {
                    if (this.validateCustomTool(toolDef)) {
                        // Convert function string back to executable function
                        const toolFunction = new Function('return ' + toolDef.function)();
                        
                        // Add to our maps
                        this.customTools.set(toolName, toolFunction);
                        this.customToolSchemas.set(toolName, toolDef.schema);
                        
                        // Add schema to return array
                        loadedSchemas.push(toolDef.schema);
                        
                        loadedCount++;
                        consoleStyler.log('tools', `✓ Loaded custom tool: ${toolName}`);
                    } else {
                        consoleStyler.log('warning', `✗ Invalid tool: ${toolName}`);
                    }
                } catch (error) {
                    consoleStyler.log('error', `✗ Failed to load tool ${toolName}: ${error.message}`);
                }
            }

            if (loadedCount > 0) {
                consoleStyler.log('tools', `Loaded ${loadedCount} custom tools`);
            }
            
            return loadedSchemas;
        } catch (error) {
            consoleStyler.log('warning', `Failed to load custom tools: ${error.message}`);
            return [];
        }
    }

    // Validate a custom tool before loading
    validateCustomTool(toolDef) {
        // Check required fields
        if (!toolDef.schema || !toolDef.function) return false;
        
        // Validate schema structure
        if (!toolDef.schema.function || !toolDef.schema.function.name) return false;
        
        // Basic security checks - block dangerous patterns
        const dangerousPatterns = [
            /process\.exit\s*\(/,
            /require\s*\(\s*['"]child_process['"]\s*\)/,
            /import\s*\(\s*['"]child_process['"]\s*\)/,
            /eval\s*\(/,
            /Function\s*\(/,
            /fs\.rmSync/,
            /fs\.unlinkSync.*\.\./,  // Prevent path traversal deletion
            /rm\s+-rf/,
            /format\s+c:/i
        ];
        
        for (const pattern of dangerousPatterns) {
            if (pattern.test(toolDef.function)) {
                consoleStyler.log('error', `SECURITY: Rejected tool with dangerous pattern: ${pattern}`);
                return false;
            }
        }
        
        return true;
    }

    // Save a custom tool to .tools.json
    async saveCustomTool(toolName, toolFunction, toolSchema, category = 'utility') {
        try {
            const fs = await import('fs');
            
            // Load existing tools or create new structure
            let toolsData = { version: '1.0.0', tools: {} };
            if (fs.existsSync(this.toolsFilePath)) {
                try {
                    toolsData = JSON.parse(fs.readFileSync(this.toolsFilePath, 'utf8'));
                } catch (e) {
                    consoleStyler.log('warning', 'Corrupted tools file, creating new one');
                }
            }

            // Add the new tool
            toolsData.tools[toolName] = {
                schema: toolSchema,
                function: toolFunction.toString(),
                metadata: {
                    created_at: new Date().toISOString(),
                    category: category,
                    usage_count: 0,
                    last_used: null
                }
            };

            // Create backup first
            if (fs.existsSync(this.toolsFilePath)) {
                const backupPath = this.toolsFilePath.replace('.json', '.backup.json');
                fs.copyFileSync(this.toolsFilePath, backupPath);
            }

            // Save the updated tools
            fs.writeFileSync(this.toolsFilePath, JSON.stringify(toolsData, null, 2), 'utf8');
            
            // Add to runtime maps
            this.customTools.set(toolName, toolFunction);
            this.customToolSchemas.set(toolName, toolSchema);

            consoleStyler.log('tools', `✓ Saved custom tool: ${toolName}`);
            return { success: true, schema: toolSchema };
        } catch (error) {
            consoleStyler.log('error', `✗ Failed to save tool ${toolName}: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    // Update tool usage statistics
    async updateToolUsage(toolName) {
        try {
            const fs = await import('fs');
            if (!fs.existsSync(this.toolsFilePath)) return;

            const toolsData = JSON.parse(fs.readFileSync(this.toolsFilePath, 'utf8'));
            if (toolsData.tools && toolsData.tools[toolName]) {
                toolsData.tools[toolName].metadata.usage_count = (toolsData.tools[toolName].metadata.usage_count || 0) + 1;
                toolsData.tools[toolName].metadata.last_used = new Date().toISOString();
                
                fs.writeFileSync(this.toolsFilePath, JSON.stringify(toolsData, null, 2), 'utf8');
            }
        } catch (error) {
            // Ignore usage tracking errors
        }
    }

    // List custom tools with optional filtering
    async listCustomTools(category = null, showUsage = false) {
        try {
            const fs = await import('fs');
            
            if (!fs.existsSync(this.toolsFilePath)) {
                return "No custom tools found.";
            }
            
            const toolsData = JSON.parse(fs.readFileSync(this.toolsFilePath, 'utf8'));
            const tools = toolsData.tools || {};
            
            let filteredTools = Object.entries(tools);
            if (category) {
                filteredTools = filteredTools.filter(([name, tool]) =>
                    tool.metadata.category === category
                );
            }
            
            if (filteredTools.length === 0) {
                return category ?
                    `No custom tools found in category: ${category}` :
                    "No custom tools found.";
            }
            
            let output = `Found ${filteredTools.length} custom tool(s):\n\n`;
            
            for (const [name, tool] of filteredTools) {
                output += `• **${name}** (${tool.metadata.category})\n`;
                output += `  ${tool.schema.function.description}\n`;
                
                if (showUsage) {
                    output += `  Used: ${tool.metadata.usage_count || 0} times\n`;
                    if (tool.metadata.last_used) {
                        output += `  Last used: ${new Date(tool.metadata.last_used).toLocaleString()}\n`;
                    }
                }
                output += `\n`;
            }
            
            return output.trim();
        } catch (error) {
            return `Error listing tools: ${error.message}`;
        }
    }

    // Remove a custom tool
    async removeCustomTool(toolName) {
        try {
            const fs = await import('fs');
            
            if (!fs.existsSync(this.toolsFilePath)) {
                return { success: false, message: "No custom tools file found." };
            }
            
            const toolsData = JSON.parse(fs.readFileSync(this.toolsFilePath, 'utf8'));
            
            if (!toolsData.tools || !toolsData.tools[toolName]) {
                return { success: false, message: `Tool '${toolName}' not found.` };
            }
            
            // Remove from file
            delete toolsData.tools[toolName];
            fs.writeFileSync(this.toolsFilePath, JSON.stringify(toolsData, null, 2), 'utf8');
            
            // Remove from runtime
            this.customTools.delete(toolName);
            this.customToolSchemas.delete(toolName);
            
            consoleStyler.log('tools', `✓ Removed custom tool: ${toolName}`);
            return { success: true, message: `✓ Successfully removed tool: ${toolName}` };
        } catch (error) {
            return { success: false, message: `Error removing tool: ${error.message}` };
        }
    }

    // Export tools to a file
    async exportTools(outputFile = 'exported_tools.json', toolsToExport = null) {
        try {
            const fs = await import('fs');
            
            if (!fs.existsSync(this.toolsFilePath)) {
                return { success: false, message: "No custom tools found to export." };
            }
            
            const toolsData = JSON.parse(fs.readFileSync(this.toolsFilePath, 'utf8'));
            const allTools = toolsData.tools || {};
            
            let exportData = {
                version: toolsData.version || '1.0.0',
                exported_at: new Date().toISOString(),
                tools: {}
            };
            
            if (toolsToExport && toolsToExport.length > 0) {
                // Export specific tools
                for (const toolName of toolsToExport) {
                    if (allTools[toolName]) {
                        exportData.tools[toolName] = allTools[toolName];
                    }
                }
            } else {
                // Export all tools
                exportData.tools = allTools;
            }
            
            fs.writeFileSync(outputFile, JSON.stringify(exportData, null, 2), 'utf8');
            
            const toolCount = Object.keys(exportData.tools).length;
            return { 
                success: true, 
                message: `✓ Successfully exported ${toolCount} tool(s) to: ${outputFile}` 
            };
        } catch (error) {
            return { success: false, message: `Error exporting tools: ${error.message}` };
        }
    }

    // Check if a tool exists
    hasCustomTool(toolName) {
        return this.customTools.has(toolName);
    }

    // Get a custom tool function
    getCustomTool(toolName) {
        return this.customTools.get(toolName);
    }

    // Get all custom tool schemas
    getCustomToolSchemas() {
        return Array.from(this.customToolSchemas.values());
    }

    // Execute a custom tool
    async executeCustomTool(toolName, args) {
        if (!this.hasCustomTool(toolName)) {
            throw new Error(`Custom tool '${toolName}' not found`);
        }

        const toolFunction = this.getCustomTool(toolName);
        consoleStyler.log('custom', `Executing custom tool: ${toolName}`);
        
        try {
            const result = await toolFunction(...Object.values(args));
            await this.updateToolUsage(toolName);
            return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        } catch (error) {
            consoleStyler.log('error', `Custom tool error: ${error.message}`);
            throw new Error(`Custom tool error: ${error.message}`);
        }
    }
}