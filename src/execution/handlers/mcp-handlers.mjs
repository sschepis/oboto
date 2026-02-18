export class McpHandlers {
    constructor(clientManager) {
        this.clientManager = clientManager;
    }

    async addServer(args) {
        const { name, type, command, args: commandArgs, url, env, scope } = args;

        if (type === 'stdio') {
            if (!command) return "Error: 'command' is required for stdio transport.";
        } else if (type === 'sse') {
            if (!url) return "Error: 'url' is required for sse transport.";
        } else {
            return "Error: Invalid transport type.";
        }

        const config = {
            command,
            args: commandArgs,
            url,
            env
        };

        // Clean up undefined values
        Object.keys(config).forEach(key => config[key] === undefined && delete config[key]);

        try {
            await this.clientManager.saveServerConfig(name, config, scope === 'global');
            
            // Try connecting immediately
            const success = await this.clientManager.connect(name, config);
            
            if (success) {
                return `Successfully added and connected to MCP server '${name}' (${scope} scope).`;
            } else {
                return `Added configuration for MCP server '${name}' (${scope} scope), but failed to connect immediately. Check logs for details.`;
            }
        } catch (e) {
            return `Error adding server: ${e.message}`;
        }
    }

    async removeServer(args) {
        const { name, scope } = args;
        try {
            await this.clientManager.disconnect(name);
            await this.clientManager.removeServerConfig(name, scope === 'global');
            return `Successfully removed MCP server '${name}' (${scope} scope).`;
        } catch (e) {
            return `Error removing server: ${e.message}`;
        }
    }

    async listServers() {
        try {
            const servers = this.clientManager.listServers();
            if (servers.length === 0) {
                return "No MCP servers configured.";
            }
            
            let output = "Configured MCP Servers:\n\n";
            output += "| Name | Status | Type | Tools |\n";
            output += "|------|--------|------|-------|\n";
            
            for (const s of servers) {
                output += `| ${s.name} | ${s.status} | ${s.type} | ${s.tools} |\n`;
            }
            
            return output;
        } catch (e) {
            return `Error listing servers: ${e.message}`;
        }
    }

    async refreshServers() {
        try {
            await this.clientManager.loadConfig();
            await this.clientManager.connectAll();
            return "Successfully refreshed MCP server configurations and connections.";
        } catch (e) {
            return `Error refreshing servers: ${e.message}`;
        }
    }
}
