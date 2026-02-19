# Integrations Architecture

Robodev is designed to extend its capabilities through external integrations. This document outlines the two primary integration mechanisms: **OpenClaw** and **Model Context Protocol (MCP)**.

## 1. OpenClaw Integration

[OpenClaw](https://github.com/sschepis/openclaw) is a personal AI assistant and gateway that can execute tasks and manage sessions. Robodev integrates with OpenClaw to offload specific tasks or coordinate with external agents.

### Architecture

The integration operates in two modes:
1.  **Integrated Mode**: Robodev spawns and manages a local OpenClaw Gateway process.
2.  **External Mode**: Robodev connects to an existing running OpenClaw Gateway via WebSocket.

### Components

*   **`OpenClawClient`** (`src/integration/openclaw/client.mjs`): Handles the WebSocket connection, protocol handshake, authentication, and request/response correlation.
*   **`OpenClawManager`** (`src/integration/openclaw/manager.mjs`): Manages the lifecycle of the OpenClaw integration. It handles configuration and exposes the client to the rest of the system.
*   **Tools**: The `delegate_to_openclaw` tool allows the agent to send messages or tasks to OpenClaw.

### Configuration

Configuration is handled via `.env`:
*   `OPENCLAW_MODE`: `integrated` | `external`
*   `OPENCLAW_URL`: WebSocket URL (default: `ws://127.0.0.1:18789`)
*   `OPENCLAW_AUTH_TOKEN`: Auth token for connection.

## 2. Model Context Protocol (MCP)

The [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) is a standard for connecting AI assistants to data sources and tools. Robodev acts as an **MCP Client**, allowing it to connect to any MCP-compliant server.

### Architecture (`src/core/mcp-client-manager.mjs`)

The `McpClientManager` handles:
1.  **Configuration**: Loading server definitions from `~/.robodev/mcp-servers.json` (global) and `.robodev/mcp-servers.json` (workspace).
2.  **Connection**: establishing connections to servers via:
    *   **Stdio Transport**: Spawning a local process (e.g., `npx -y @modelcontextprotocol/server-filesystem`).
    *   **SSE Transport**: Connecting to a remote HTTP/SSE endpoint.
3.  **Tool Discovery**: Fetching the list of available tools from connected servers.
4.  **Tool Execution**: Dynamic execution of tools on the remote servers.

### Dynamic Tooling

Tools from MCP servers are dynamically added to the agent's toolset at runtime. They are namespaced to avoid collisions:
`mcp_{serverName}_{toolName}`

For example, if you connect the `filesystem` server, the `read_file` tool might be exposed as `mcp_filesystem_read_file`.

### Usage

You can manage MCP servers using the built-in tools:
*   `mcp_list_servers`: View connected servers.
*   `mcp_add_server`: Connect to a new server dynamically.
