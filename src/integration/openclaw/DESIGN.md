# OpenClaw Integration Design

This document outlines the design for integrating OpenClaw as an external task executor and chat agent within the AI Assistant.

## 1. Overview

OpenClaw is a personal AI assistant and gateway that can execute tasks and manage sessions. We will integrate it in two modes:
1.  **Integrated Mode**: The AI Assistant spawns and manages a local OpenClaw Gateway process.
2.  **External Mode**: The AI Assistant connects to an existing running OpenClaw Gateway.

## 2. Architecture

### 2.1 Components

-   **`OpenClawClient`** (`src/integration/openclaw/client.mjs`): Handles the WebSocket connection, protocol handshake, authentication, and request/response correlation.
-   **`OpenClawManager`** (`src/integration/openclaw/manager.mjs`): Manages the lifecycle of the OpenClaw integration. It handles configuration, spawning the process (in integrated mode), and exposing the client to the rest of the system.
-   **Tool Definition** (`src/tools/definitions/openclaw-tools.mjs`): Defines the `delegate_to_openclaw` tool that the main AI agent can use.
-   **System Prompt Injection**: Updates the system prompt to inform the agent about OpenClaw's availability and how to use it.

### 2.2 Protocol

We use the OpenClaw WebSocket protocol:
-   **Endpoint**: `ws://<host>:<port>` (Default port: 18789)
-   **Handshake**:
    1.  Server sends `connect.challenge` event with a nonce.
    2.  Client sends `connect` request with `ConnectParams` (role: "operator", auth: token/password).
    3.  Server responds with `hello-ok` or error.
-   **Message Format**:
    -   Request: `{ type: "req", id: string, method: string, params: object }`
    -   Response: `{ type: "res", id: string, ok: boolean, payload?: object, error?: object }`
    -   Event: `{ type: "event", event: string, payload: object }`

### 2.3 Configuration (`.env`)

-   `OPENCLAW_MODE`: `integrated` | `external` (default: `external`)
-   `OPENCLAW_URL`: WebSocket URL (default: `ws://127.0.0.1:18789`)
-   `OPENCLAW_AUTH_TOKEN`: Auth token (optional)
-   `OPENCLAW_PATH`: Path to OpenClaw repository (required for integrated mode, e.g., `/Users/sschepis/Development/openclaw`)

## 3. Implementation Details

### 3.1 `OpenClawClient`

```javascript
class OpenClawClient extends EventEmitter {
  constructor(url, authToken) { ... }
  async connect() { ... } // Handles handshake
  disconnect() { ... }
  async sendRequest(method, params) { ... } // Returns Promise resolving to payload
  // ...
}
```

### 3.2 `OpenClawManager`

```javascript
class OpenClawManager {
  constructor(config) { ... }
  async initialize() {
    if (this.mode === 'integrated') {
      this.spawnProcess();
    }
    await this.client.connect();
  }
  spawnProcess() {
    // spawns `node openclaw.mjs gateway run` from OPENCLAW_PATH
  }
}
```

### 3.3 Tool Definition (`delegate_to_openclaw`)

```javascript
{
  name: "delegate_to_openclaw",
  description: "Delegate a task or send a message to the OpenClaw agent.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "The message or task description" },
      deliver: { type: "boolean", description: "Whether to deliver this message to external channels" }
    },
    required: ["message"]
  }
}
```

### 3.4 `@openclaw` Routing

The system prompt will include instructions:
> "If the user's message starts with @openclaw, or if you need to perform actions that OpenClaw is better suited for (like managing external channels), use the `delegate_to_openclaw` tool."

## 4. UI Integration

-   **Status**: We will expose an endpoint (or use existing status mechanisms) to show if OpenClaw is connected.
-   **Chat**: Messages delegated to OpenClaw will appear as tool calls in the chat. Responses from OpenClaw will be returned as tool outputs.

## 5. Next Steps

1.  Implement `OpenClawClient`.
2.  Implement `OpenClawManager`.
3.  Implement Tool Definitions.
4.  Wire up in `ai-assistant.mjs` and `web-server.mjs`.
5.  Test with external and integrated modes.
