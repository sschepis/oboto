export const MCP_TOOLS = [
    {
        name: "mcp_add_server",
        description: "Add a new MCP server configuration. Supports both stdio (command-line) and sse (server-sent events) transports.",
        parameters: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "Unique name for the server"
                },
                type: {
                    type: "string",
                    enum: ["stdio", "sse"],
                    description: "Transport type: 'stdio' for local processes, 'sse' for remote servers"
                },
                command: {
                    type: "string",
                    description: "Command to execute (required for stdio type)"
                },
                args: {
                    type: "array",
                    items: { type: "string" },
                    description: "Arguments for the command (for stdio type)"
                },
                url: {
                    type: "string",
                    description: "URL to connect to (required for sse type)"
                },
                env: {
                    type: "object",
                    additionalProperties: { type: "string" },
                    description: "Environment variables for the server process"
                },
                scope: {
                    type: "string",
                    enum: ["global", "workspace"],
                    default: "workspace",
                    description: "Where to save the configuration. 'global' saves to user home, 'workspace' saves to current project."
                }
            },
            required: ["name", "type"]
        }
    },
    {
        name: "mcp_remove_server",
        description: "Remove an MCP server configuration.",
        parameters: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "Name of the server to remove"
                },
                scope: {
                    type: "string",
                    enum: ["global", "workspace"],
                    default: "workspace",
                    description: "Scope from which to remove the configuration"
                }
            },
            required: ["name"]
        }
    },
    {
        name: "mcp_list_servers",
        description: "List all configured MCP servers and their status.",
        parameters: {
            type: "object",
            properties: {}
        }
    },
    {
        name: "mcp_refresh_servers",
        description: "Reload MCP configuration and reconnect to all servers.",
        parameters: {
            type: "object",
            properties: {}
        }
    }
];
