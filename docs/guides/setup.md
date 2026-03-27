# Setup and Usage Guide

This guide will help you set up and run the Oboto AI Assistant.

## Prerequisites

*   **Node.js**: v18.0.0 or higher
*   **Package Manager**: `npm` (for root) and `pnpm` (for UI)
*   **Browser**: Google Chrome (for browser automation and extension support)

## Installation

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/sschepis/oboto.git
    cd oboto
    ```

2.  **Install Root Dependencies**
    ```bash
    npm install
    ```

3.  **Install UI Dependencies**
    ```bash
    cd ui
    pnpm install
    cd ..
    ```

## Configuration

1.  **Create Environment File**
    Copy `.env.example` to `.env`:
    ```bash
    cp .env.example .env
    ```

2.  **Configure API Keys**
    Open `.env` and add your API keys:
    *   `GOOGLE_API_KEY` (Required for Gemini)
    *   `ANTHROPIC_API_KEY` (Optional for Claude)
    *   `OPENAI_API_KEY` (Optional)

## Running the Application

### Option A: Server Mode (Recommended)
This runs the backend server with the web UI.

**Via installed binary (after `npm install -g @sschepis/oboto`):**
```bash
oboto-server
# or
oboto --server
```

**Via npm scripts (from source checkout):**
```bash
npm run start:server
```
Access the UI at `http://localhost:3000`.

**Development with hot-reloading UI:**
```bash
# Terminal 1: Start the backend
npm run start:server

# Terminal 2: Start the Vite dev server
npm run dev:ui
```
Access the dev UI at `http://localhost:5173`.

### Option B: CLI Mode
Run the assistant directly in your terminal.

**Via installed binary:**
```bash
# Interactive mode
oboto

# Single-shot mode
oboto "Create a REST API for user management"
```

**Via npm scripts:**
```bash
npm start
```

### CLI Flags

| Flag | Description |
|------|-------------|
| `--server` | Start the Express + WebSocket server with web UI |
| `--cwd <path>` | Set the working directory (default: current directory) |
| `--resume` | Resume previous session on startup |
| `--help`, `-h` | Show help message and exit |
| `--version`, `-v` | Show version number and exit |

### Option C: Production Build
To build the UI for production serving:

```bash
npm run build:all
```

## Oboto Cloud (Optional)

Oboto Cloud adds workspace sync, team collaboration, cloud AI agents, and metered AI model access. It's fully optional — everything works without it.

### Setting Up Cloud

1.  **Sign up** at [oboto.ai](https://oboto.ai) to get your cloud credentials.

2.  **Add cloud credentials** to your `.env` or Secrets Vault:
    ```env
    OBOTO_CLOUD_URL=https://your-project.supabase.co
    OBOTO_CLOUD_KEY=your-anon-key
    ```
    Or configure via the Secrets Vault UI (⌘K → "Secrets Vault").

3.  **Restart the server**. You'll see `☁️ Cloud integration initialized` in the logs.

4.  **Log in** via Settings → Cloud tab in the UI.

### Cloud Features

| Feature | Description |
|---------|-------------|
| **Login/Profile** | Sign in to see your org, team, and profile |
| **Workspace Sync** | Link a local workspace to a cloud workspace for state sync |
| **Conversation Sync** | Push/pull messages between local and cloud |
| **Cloud Agents** | Invoke cloud AI agents configured in the dashboard |
| **AI Proxy** | Route AI requests through the cloud (no local API keys needed) |
| **Presence** | See who's online in your workspace in real-time |

### Using Cloud as AI Provider

Set `AI_PROVIDER=cloud` in your `.env` to route all AI requests through the cloud proxy. This uses your organization's metered AI access — no local API keys required.

```env
AI_PROVIDER=cloud
AI_MODEL=auto
```

The cloud proxy supports all major models and automatically routes to the optimal provider. If the cloud is unavailable, Oboto falls back to any locally configured provider.

### No Cloud? No Problem

Without `OBOTO_CLOUD_URL` and `OBOTO_CLOUD_KEY`, the cloud module doesn't load at all. Zero impact on startup time, zero cloud code in memory, and all local features work identically.

## Workspace Content Server

Each workspace automatically spins up a local HTTP server on a dynamically assigned port. This server is used by UI Surfaces and can also serve your own content.

### Static Files

By default, the content server serves static files from the `public/` directory in your workspace root. Place HTML, CSS, JS, images, or any other assets there and they will be available at `http://localhost:<port>/`.

### Dynamic Routes (Opt-in)

You can enable dynamic route execution, which allows the server to run JavaScript route handlers found in `routes/`, `.routes/`, or `api/` directories within the workspace.

**Enable via environment variable:**
```env
OBOTO_DYNAMIC_ROUTES=true
```

**Or via `.oboto.json`:**
```json
{
  "dynamicRoutes": {
    "enabled": true
  }
}
```

> **Security Note:** Dynamic routes execute arbitrary JavaScript on the server. Only enable this for workspaces you trust.

### Server Logs

All content server requests and errors are logged to `server.log` in the workspace root for debugging and auditing.

## Workspace Configuration (`.oboto.json`)

The `.oboto.json` file provides per-workspace configuration. Place it in the root of any workspace directory.

```json
{
  "dynamicRoutes": {
    "enabled": true
  },
  "surface": {
    "sandboxMode": "strict"
  }
}
```

### Available Options

| Key | Values | Default | Description |
|-----|--------|---------|-------------|
| `dynamicRoutes.enabled` | `true` / `false` | `false` | Enable JS route handlers in `routes/`, `.routes/`, `api/` |
| `surface.sandboxMode` | `"strict"` / `"permissive"` | `"strict"` | Controls network access for UI Surfaces. `strict` restricts `fetch` to `localhost`; `permissive` allows any origin |

### Surface Sandboxing

UI Surfaces run in a strict sandbox by default. The `fetch` API inside surfaces is intercepted and restricted to `localhost` origins to prevent data exfiltration. Surfaces should use `surfaceApi.fetchRoute('/path')` to fetch from workspace routes.

To allow surfaces to access external URLs, set `surface.sandboxMode` to `"permissive"`:

```json
{
  "surface": {
    "sandboxMode": "permissive"
  }
}
```

## Agentic Providers

Oboto ships with two agentic provider backends that control how the agent loop executes:

| Provider | ID | Description |
|----------|----|-------------|
| **Unified** | `unified` | Default. Combines cognitive reasoning, safety guardrails, memory, and learning layers into a single provider. |
| **NewAgent** | `newagent` | Autonomous CLI-style agent with virtual filesystem (VFS), AST pipeline, dual memory, and batch command execution via AgentRunner. |

Set the default provider in your `.env` or config:
```env
AI_AGENTIC_PROVIDER=unified
```

You can also switch providers at runtime via the Settings UI or the `/provider` command.

> **Note:** The legacy `eventic`, `cognitive`, `lmscript`, `maha`, and `megacode` providers have been consolidated into the `unified` and `newagent` providers. If your config references a removed provider ID, it will fall back to `unified`.

## Conversation Autosave

Chat history is now automatically saved on every turn. A robust file-lock mechanism prevents corruption when multiple processes or conversations write simultaneously. No configuration is required — autosave is always on.

## Usage

1.  **Access the UI**: Open `http://localhost:5173` (or the production URL at port 3000).
2.  **Start a Chat**: Type your request in the input box.
3.  **Use Tools**: The agent will automatically use tools as needed. You can also invoke specific commands (e.g., `/plan`, `/analyze`).
4.  **Manage Files**: Use the built-in file editor tab to view and edit code.
5.  **View Architecture**: Use the `/visualize` command to see system diagrams.
