import fs from 'fs';
import path from 'path';
import os from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * Manages MCP client connections and configuration.
 * Handles global and workspace-specific configurations.
 */
export class McpClientManager {
    constructor(workspaceDir) {
        this.workspaceDir = workspaceDir;
        this.clients = new Map(); // serverName -> { client, transport, capabilities, tools }
        this.config = { mcpServers: {} };
        this.globalConfigPath = path.join(os.homedir(), '.oboto', 'mcp-servers.json');
        this.workspaceConfigPath = path.join(workspaceDir, '.oboto', 'mcp-servers.json');
    }

    /**
     * Initialize the manager: load config and connect to servers.
     */
    async initialize() {
        await this.loadConfig();
        await this.connectAll();
    }

    /**
     * Load configuration from global and workspace files.
     * Workspace config overrides global config.
     */
    async loadConfig() {
        this.config = { mcpServers: {} };

        // Load Global Config
        if (fs.existsSync(this.globalConfigPath)) {
            try {
                const globalData = JSON.parse(fs.readFileSync(this.globalConfigPath, 'utf8'));
                if (globalData.mcpServers) {
                    this.config.mcpServers = { ...globalData.mcpServers };
                }
            } catch (e) {
                consoleStyler.log('error', `Failed to load global MCP config: ${e.message}`);
            }
        }

        // Load Workspace Config
        if (fs.existsSync(this.workspaceConfigPath)) {
            try {
                const workspaceData = JSON.parse(fs.readFileSync(this.workspaceConfigPath, 'utf8'));
                if (workspaceData.mcpServers) {
                    // Merge workspace config (overwriting global with same name)
                    this.config.mcpServers = { ...this.config.mcpServers, ...workspaceData.mcpServers };
                }
            } catch (e) {
                consoleStyler.log('error', `Failed to load workspace MCP config: ${e.message}`);
            }
        }
    }

    /**
     * Save configuration for a specific server.
     * @param {string} serverName 
     * @param {Object} serverConfig 
     * @param {boolean} isGlobal - If true, save to global config, else workspace.
     */
    async saveServerConfig(serverName, serverConfig, isGlobal = false) {
        const targetPath = isGlobal ? this.globalConfigPath : this.workspaceConfigPath;
        const targetDir = path.dirname(targetPath);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        let currentConfig = {};
        if (fs.existsSync(targetPath)) {
            try {
                currentConfig = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
            } catch (e) {
                // Ignore error, start fresh
            }
        }

        if (!currentConfig.mcpServers) {
            currentConfig.mcpServers = {};
        }

        currentConfig.mcpServers[serverName] = serverConfig;

        fs.writeFileSync(targetPath, JSON.stringify(currentConfig, null, 2), 'utf8');
        
        // Reload in-memory config
        await this.loadConfig();
    }

    /**
     * Remove a server configuration.
     * @param {string} serverName 
     * @param {boolean} isGlobal 
     */
    async removeServerConfig(serverName, isGlobal = false) {
        const targetPath = isGlobal ? this.globalConfigPath : this.workspaceConfigPath;
        
        if (fs.existsSync(targetPath)) {
            try {
                const currentConfig = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
                if (currentConfig.mcpServers && currentConfig.mcpServers[serverName]) {
                    delete currentConfig.mcpServers[serverName];
                    fs.writeFileSync(targetPath, JSON.stringify(currentConfig, null, 2), 'utf8');
                }
            } catch (e) {
                consoleStyler.log('error', `Failed to update config file: ${e.message}`);
            }
        }

        // Reload in-memory config
        await this.loadConfig();
    }

    /**
     * Connect to all configured servers.
     */
    async connectAll() {
        for (const [name, config] of Object.entries(this.config.mcpServers)) {
            if (!this.clients.has(name)) {
                await this.connect(name, config);
            }
        }
    }

    /**
     * Connect to a specific server.
     */
    async connect(name, config) {
        try {
            consoleStyler.log('system', `Connecting to MCP server: ${name}...`);
            let transport;

            if (config.command) {
                // Stdio Transport
                transport = new StdioClientTransport({
                    command: config.command,
                    args: config.args || [],
                    env: { ...process.env, ...config.env }
                });
            } else if (config.url) {
                // SSE Transport
                transport = new SSEClientTransport(new URL(config.url), {
                    eventSourceInit: {
                        withCredentials: false
                    }
                });
            } else {
                throw new Error(`Invalid config for ${name}: missing command or url`);
            }

            const client = new Client({
                name: "oboto-client",
                version: "1.0.0",
            }, {
                capabilities: {}
            });

            await client.connect(transport);

            // Fetch tools
            const toolsResult = await client.listTools();
            const tools = toolsResult.tools || [];

            this.clients.set(name, {
                client,
                transport,
                config,
                tools
            });

            consoleStyler.log('system', `✓ Connected to MCP server: ${name} (${tools.length} tools)`);
            return true;

        } catch (e) {
            consoleStyler.log('error', `Failed to connect to MCP server ${name}: ${e.message}`);
            return false;
        }
    }

    /**
     * Disconnect from a server.
     */
    async disconnect(name) {
        const connection = this.clients.get(name);
        if (connection) {
            try {
                await connection.client.close();
                if (connection.transport.close) {
                   await connection.transport.close();
                }
            } catch (e) {
                console.error(`Error closing connection ${name}:`, e);
            }
            this.clients.delete(name);
            consoleStyler.log('system', `Disconnected from MCP server: ${name}`);
        }
    }

    /**
     * Get a flattened list of all tools from all connected servers.
     * The tool names are prefixed with "mcp_{serverName}_" to avoid collisions.
     */
    getAllTools() {
        const allTools = [];
        for (const [serverName, connection] of this.clients.entries()) {
            for (const tool of connection.tools) {
                allTools.push({
                    name: `mcp_${serverName}_${tool.name}`,
                    description: `[MCP: ${serverName}] ${tool.description}`,
                    inputSchema: tool.inputSchema,
                    originalName: tool.name,
                    serverName: serverName
                });
            }
        }
        return allTools;
    }

    /**
     * Execute a tool on a specific server.
     */
    async executeTool(serverName, toolName, args) {
        const connection = this.clients.get(serverName);
        if (!connection) {
            throw new Error(`MCP server not connected: ${serverName}`);
        }

        try {
            const result = await connection.client.callTool({
                name: toolName,
                arguments: args
            });

            // Format result for the agent
            if (result.content && Array.isArray(result.content)) {
                return result.content.map(c => {
                    if (c.type === 'text') return c.text;
                    if (c.type === 'image') return `[Image: ${c.mimeType}]`; // Placeholder for now
                    return JSON.stringify(c);
                }).join('\n');
            }
            return JSON.stringify(result);

        } catch (e) {
            throw new Error(`MCP tool execution failed: ${e.message}`);
        }
    }

    /**
     * List configured servers (status).
     */
    listServers() {
        const servers = [];
        // Include configured but not connected servers
        const allNames = new Set([...Object.keys(this.config.mcpServers), ...this.clients.keys()]);
        
        for (const name of allNames) {
            const isConnected = this.clients.has(name);
            const config = this.config.mcpServers[name];
            const connection = this.clients.get(name);
            
            servers.push({
                name,
                status: isConnected ? 'connected' : 'disconnected',
                type: config?.command ? 'stdio' : (config?.url ? 'sse' : 'unknown'),
                tools: connection ? connection.tools.length : 0
            });
        }
        return servers;
    }
}
