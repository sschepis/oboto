<p align="center">
  <img src="tray-app/assets/oboto-icon-bw.png" alt="Oboto" width="128" height="128" />
</p>

<h1 align="center">Oboto</h1>
<p align="center"><strong>Your AI-Powered Everything Assistant</strong></p>

<p align="center">
  <a href="https://github.com/sschepis/oboto/releases/latest"><img src="https://img.shields.io/github/v/release/sschepis/oboto?label=download&style=for-the-badge" alt="Download" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue?style=for-the-badge" alt="Platform" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="License" />
</p>

---

**Oboto** is an advanced AI assistant built to make you more productive, efficient, and successful — across every domain. From software engineering and project management to research, automation, and creative work, Oboto combines a persistent cognitive architecture with deep system integration to act as your tireless partner in getting things done.

## 📥 Download

| Platform | Download | Notes |
|----------|----------|-------|
| **macOS** (Apple Silicon) | [Oboto-1.2.0-arm64.dmg](https://github.com/sschepis/oboto/releases/latest) | Code-signed, requires macOS 10.12+ |
| **macOS** (zip) | [Oboto-1.2.0-arm64-mac.zip](https://github.com/sschepis/oboto/releases/latest) | Portable zip archive |
| **Windows** | [Build via GitHub Actions](https://github.com/sschepis/oboto/actions/workflows/build-windows.yml) | NSIS installer + portable exe |

## 🚀 Key Features

### Core Architecture
*   **🤖 Multi-Agent Architecture** — Multiple parallel conversations per workspace, background tasks, recurring schedules, and an autonomous agent loop. Conversations share workspace memory and report findings back to a central command. See [Multi-Agent Architecture](docs/architecture/multi-agent.md).
*   **🧠 Consciousness Processor** — Simulates an "inner life" with state persistence, ambiguity resolution (Semantic Collapse), and embodied cognition (Somatic Engine) for more coherent reasoning.
*   **🏗️ Structured Development** — Enforces architectural discipline via a "Living Manifest" (`SYSTEM_MAP.md`), ensuring code changes align with global invariants and design phases.

### AI Provider Support
*   **Multi-Provider** — Switch seamlessly between OpenAI, Google Gemini, Anthropic Claude, Google Vertex AI (Claude on GCP), local LLM Studio, and in-browser WebLLM models.
*   **Model Routing** — Route specific task types (agentic, reasoning, summarization, code completion) to different models for cost/quality optimization.
*   **Auto-Detection** — Provider is inferred automatically from the model name or can be set explicitly.

### Integrations
*   **🔌 OpenClaw** — Delegate tasks to external agents for cross-system coordination.
*   **🔌 MCP Support** — Connect to any Model Context Protocol server for dynamic tool extension.
*   **☁️ Cloud Sync** — Real-time cloud synchronization for conversations, files, and workspaces with presence indicators and multi-device support.

### User Interface
*   **🖥️ Generative UI (Surfaces)** — Spawn dynamic React dashboards on the fly to visualize data or create custom control panels. Surfaces run in a **strict sandbox** by default, with `fetch` restricted to `localhost` to prevent data exfiltration (configurable via `.oboto.json`).
*   **🕐 Chronological UI Rendering** — Tool calls are now interleaved with text exactly as streamed by the model, improving readability of long reasoning chains.
*   **❓ Integrated Help System** — Contextual help tooltips, searchable help panel, guided tours, feature spotlights, smart suggestions, and "What Is This?" mode for exploring the interface.
*   **🧙 Setup Wizard** — Guided first-run onboarding that walks through provider selection, API key configuration, workspace setup, and optional OpenClaw integration.
*   **🎨 UI Themes** — Customizable themes with live preview and theme editor.
*   **⌨️ Keyboard Shortcuts** — Global command palette (`Cmd+K`), keyboard shortcuts reference, and guake-style terminal.

### Desktop & Browser
*   **🖥️ System Tray App** — Electron-based tray application for running Oboto as a persistent background service with workspace management and auto-start on login.
*   **🌐 Chrome Extension** — Full browser automation and control via a Chrome extension that connects to the Oboto server over WebSocket.

### Workspace & Server
*   **🌐 Workspace Content Server** — Each workspace automatically spins up a local HTTP server on a dynamic port, serving static files from `public/`. Opt in to **Dynamic Routes** (executing JS handlers from `routes/`, `.routes/`, or `api/`) via `OBOTO_DYNAMIC_ROUTES=true` or `.oboto.json`. All requests are logged to `server.log`.
*   **💾 Conversation Autosave** — Chat history is automatically saved on every turn with robust lock mechanisms to prevent corruption.
*   **🔄 Skill Promotion** — Promote workspace-specific skills to the global skills directory with `promoteSkill(name)` so they can be reused across all workspaces.

### Reliability
*   **🛡️ Agent Loop Reliability** — Improved "doom loop" detection (counting iterations, not individual batched tool calls) and robust handling of cancelled requests to prevent Anthropic API 400 errors.

### Developer Features
*   **📦 Library API** — Embeddable as an npm package (`@sschepis/oboto`) with a programmatic API for task execution, streaming, design-and-implement workflows, and custom tool registration.
*   **🔐 Secrets Vault** — AES-256-GCM encrypted secrets storage for API keys and credentials, managed through the UI or CLI.

## 🔌 Plugin Ecosystem

Oboto ships with 30 built-in plugins, each extending capabilities in a specific domain:

| Plugin | Description |
|--------|-------------|
| **browser** | Puppeteer-based browser automation |
| **canvas-viz** | Canvas-based data visualization |
| **chrome-ext** | Chrome extension integration |
| **code-interpreter** | Sandboxed code execution environment |
| **document-reader** | PDF, DOCX, and document parsing |
| **embed** | Vector embedding operations |
| **firecrawl** | Web scraping and crawling |
| **hello-world** | Plugin development template |
| **html-artifacts** | HTML artifact rendering |
| **image** | AI-powered image generation and manipulation |
| **knowledge-graph** | Semantic knowledge graph with memory fields |
| **logger** | Structured logging |
| **math** | Wolfram-style computation via mathjs |
| **math-anim** | Animated mathematical explanations using a Manim-inspired DSL |
| **note-taker** | Note capture and organization |
| **notification-center** | System notifications |
| **openclaw** | External agent task delegation |
| **personas** | Agent personality management |
| **poorman-alpha** | Symbolic math via SymPy bridge |
| **prompt-editor** | System prompt editor |
| **secure-backup** | Encrypted workspace backups |
| **semantic-search** | Semantic document search |
| **temporal-voyager** | Conversation time-travel |
| **thought-stream-debugger** | Agent reasoning debugger |
| **tts** | Text-to-speech (ElevenLabs, OpenAI) |
| **ui-themes** | Theme management and editor |
| **voice-suite** | Voice input/output providers |
| **web-search** | Web search via Serper API |
| **workflow-weaver** | Visual workflow builder |
| **workflows** | Multi-step workflow automation |

## 🛠️ Tool Categories

| Category | Tools | Description |
|----------|-------|-------------|
| **File Operations** | read, write, search, diff | File CRUD with safety guards |
| **Shell** | execute | Sandboxed command execution |
| **Browser** | navigate, click, type, screenshot | Puppeteer-based browser automation |
| **Chrome Extension** | tabs, DOM, CDP, cookies | Full Chrome browser control via extension |
| **Desktop** | mouse, keyboard, screen | Native desktop automation via nut.js |
| **Image** | generate, edit, analyze | AI-powered image generation and manipulation |
| **Math** | evaluate, symbolic | Wolfram-style computation via mathjs |
| **Web** | fetch, search | Web requests and search via Serper |
| **Structured Dev** | manifest, flow, bootstrap | Project scaffolding and architecture |
| **MCP** | connect, call | Model Context Protocol server integration |
| **OpenClaw** | delegate, status | External agent task delegation |
| **Workflows** | create, run, schedule | Multi-step workflow automation |
| **Surfaces** | create, update, delete | Dynamic React dashboard generation |
| **Async Tasks** | spawn, status, cancel | Background task management |
| **Personas** | set, list, create | Agent personality management |
| **Skills** | install, list, invoke, promote | Modular skill system with global promotion |
| **Content Server** | static serve, dynamic routes | Per-workspace HTTP server for static & JS routes |
| **Embeddings** | embed, search | Vector embedding operations |
| **TTS** | speak | Text-to-speech via ElevenLabs/OpenAI |

## 📚 Documentation

Detailed documentation is available in the [`docs/`](docs/) directory:

*   [**System Overview**](docs/architecture/overview.md) — High-level architecture, components, and data flow
*   [**Multi-Agent Architecture**](docs/architecture/multi-agent.md) — Parallel conversations, background tasks, agent loop
*   [**Consciousness Architecture**](docs/architecture/consciousness.md) — Inference engine, somatic state, symbolic continuity
*   [**Structured Development Guide**](docs/architecture/structured-dev.md) — Manifest-driven development workflow
*   [**Integrations (OpenClaw & MCP)**](docs/architecture/integrations.md) — External agent delegation and MCP servers
*   [**Skills System**](docs/architecture/skills.md) — Extending the agent with modular skills
*   [**Service & Tray App Design**](docs/architecture/service-tray-design.md) — Background service and system tray architecture
*   [**Setup Wizard Design**](docs/architecture/setup-wizard-design.md) — First-run configuration wizard
*   [**Integrated Help System**](docs/integrated-help-system-design.md) — Contextual help, tours, and smart suggestions
*   [**First-Run Wizard Strategy**](docs/first-run-wizard-strategy.md) — Onboarding flow design
*   [**Cloud AI Provider Design**](docs/oboto-cloud-ai-provider-design.md) — Cloud sync and multi-device architecture
*   [**Skills Settings Tab**](docs/architecture/skills-settings-tab.md) — Managing skills from the UI
*   [**Project Management**](docs/architecture/project-management.md) — Phase controller, task scheduler, and template registry
*   [**Tools Reference**](docs/guides/tools.md) — Complete list of available tools and commands
*   [**UI Surfaces Guide**](docs/guides/ui-surfaces.md) — Dynamic dashboards and UI components
*   [**Surface Components**](docs/guides/surface-components.md) — Reusable surface-kit UI primitives reference
*   [**Setup & Installation**](docs/guides/setup.md) — Detailed installation instructions
*   [**Library API Reference**](src/lib/README.md) — Programmatic API for embedding Oboto
*   [**Changelog**](CHANGELOG.md) — Version history and release notes

## ⚡ Quick Start

### Prerequisites
*   Node.js v18+
*   npm & pnpm
*   Google Chrome (for browser automation)

### Install via npm (Recommended)

```bash
npm install -g @sschepis/oboto
```

After installation, two binaries are available on your PATH:

| Command | Description |
|---------|-------------|
| `oboto` | CLI — interactive mode, single-shot prompts, or `--server` flag |
| `oboto-server` | Start the web server with UI directly |

### From Source

1.  **Clone & Install**
    ```bash
    git clone https://github.com/sschepis/oboto.git
    cd oboto
    npm install
    ```

2.  **Build UI**
    ```bash
    cd ui
    pnpm install
    pnpm run build
    cd ..
    ```

3.  **Configure**
    ```bash
    cp .env.example .env
    # Edit .env with your API keys (Google Gemini, Anthropic, OpenAI)
    ```

### Running Oboto

**Server Mode (Agent + Web UI)**
```bash
# Via the installed binary:
oboto-server

# Or via npm scripts:
npm run start:server
```
Access the UI at `http://localhost:3000`.

For development with hot-reloading UI:
```bash
# Terminal 1: Start the backend
npm run start:server

# Terminal 2: Start the Vite dev server
npm run dev:ui
```
Access the dev UI at `http://localhost:5173`.

**CLI Mode**
```bash
# Interactive mode
oboto

# Single-shot mode
oboto "Create a REST API for user management"

# Or via npm
npm start
```

**System Tray App (Background Service)**
```bash
npm run tray:install
npm run tray
```

### Building from Source

**macOS DMG:**
```bash
npm run tray:build:mac
# Output: tray-app/dist/Oboto-1.2.0-arm64.dmg
```

**Windows Installer:**
```bash
# Requires Wine on macOS, or run on Windows / via GitHub Actions
npm run tray:build:win
```

Or trigger the [Windows build workflow](https://github.com/sschepis/oboto/actions/workflows/build-windows.yml) on GitHub Actions.

## 🏗️ Project Structure

```
oboto/
├── ai.mjs                        # CLI entry point (interactive, single-shot, --server)
├── bin/
│   └── oboto-server.mjs           # Server binary (installed to PATH via npm)
├── src/                           # Backend source
│   ├── core/                      # Agent loop, AI provider, conversation, consciousness
│   ├── server/                    # Express + WebSocket server, WS handlers
│   ├── execution/                 # Tool executor and handler modules
│   ├── structured-dev/            # Manifest, flow manager, bootstrapper, visualizers
│   ├── reasoning/                 # Fact inference, semantic collapse
│   ├── cloud/                     # Cloud sync, auth, realtime, conversation/file/workspace sync
│   ├── skills/                    # Skills manager
│   ├── plugins/                   # Plugin API, loader, manager, settings, storage
│   ├── surfaces/                  # Dynamic UI surface manager
│   ├── lib/                       # Embeddable library API (npm package entry point)
│   │   ├── index.mjs              # Main export: AiMan, Oboto, adapters, modules
│   │   └── interfaces.d.ts       # TypeScript type declarations
│   └── ui/                        # Console styler, generative UI renderer
├── ui/                            # React + Vite frontend
│   └── src/
│       ├── components/            # Chat, layout, features (60+ components)
│       │   ├── features/          # Settings, plugins, surfaces, wizard, etc.
│       │   ├── help/              # Help system (tours, tooltips, articles, search)
│       │   └── ...
│       ├── hooks/                 # React hooks for state management
│       ├── services/              # WebSocket service layer
│       └── surface-kit/           # Reusable UI primitives (charts, data, feedback, overlay)
├── plugins/                       # 30 built-in plugins (shipped with npm package)
├── tray-app/                      # Electron system tray application
├── chrome-extension/              # Chrome browser controller extension
├── skills/                        # Modular skill definitions (SKILL.md)
├── docs/                          # Architecture and guide documentation
├── .github/workflows/             # CI/CD workflows (Windows build)
└── themes.json                    # UI theme definitions
```

## 🧠 The "Consciousness"

Oboto features a unique cognitive architecture:
*   **Fact Inference Engine** — Learns and deduces new facts from conversation context.
*   **Symbolic Continuity** — Maintains a cryptographic "identity thread" across sessions, with optional Chinese Room Mode for encrypted private symbolic space.
*   **Somatic Engine** — Simulates nervous system states (Focus, Stress, Rest) to modulate creativity and caution.
*   **Archetype Analyzer** — Analyzes interaction patterns and adapts persona behavior.
*   **Persona Manager** — Manages customizable agent personalities and behavioral archetypes.
*   **Semantic Collapse** — Resolves ambiguity by collapsing probability distributions to concrete decisions.

## 📦 Library Usage

Oboto can be embedded as a library in your own Node.js applications:

```bash
npm install @sschepis/oboto
```

### Basic Usage

```javascript
import { AiMan } from '@sschepis/oboto';

const ai = new AiMan({ workingDir: process.cwd() });

// Execute a task
const result = await ai.execute('Create a REST API for user management');

// Design then implement
const { design, result: impl } = await ai.designAndImplement('Add authentication middleware');

// Stream responses
await ai.executeStream('Refactor the database layer', (chunk) => {
  process.stdout.write(chunk);
});

// Register custom tools
ai.registerTool(schema, handler);
```

### Subpath Imports

The package provides several subpath imports for granular access:

```javascript
// Main library entry — AiMan, Oboto, adapters, structured dev modules
import { AiMan, Oboto, config } from '@sschepis/oboto';

// Adapters only — for custom LLM/status/memory implementations
import { ConsoleStatusAdapter, NetworkLLMAdapter, MemoryAdapter } from '@sschepis/oboto/adapters';

// Programmatic server — create an Express server with the AiMan API
import { createServer } from '@sschepis/oboto/server';
const app = createServer({ workingDir: process.cwd() });
app.listen(3000);

// Plugin system — manage plugins programmatically
import { PluginManager, PluginLoader } from '@sschepis/oboto/plugins';
```

### Programmatic Server

You can create a standalone API server programmatically:

```javascript
import { createServer } from '@sschepis/oboto/server';

const app = createServer({ workingDir: '/path/to/workspace' });
app.listen(3000, () => console.log('Oboto API running on port 3000'));

// POST /api/execute   — Execute a task
// POST /api/execute/stream — Stream a task (SSE)
// POST /api/design    — Generate a design document
// POST /api/implement — Implement a design
```

See the full [Library API Reference](src/lib/README.md) for details.

## 🌐 Chrome Extension

The Chrome extension enables full browser automation:

1.  Navigate to `chrome://extensions` and enable Developer mode
2.  Click "Load unpacked" and select the `chrome-extension/` directory
3.  Start the Oboto server — the extension auto-connects via WebSocket

Features include tab management, DOM interaction, CDP debugging, cookie/storage access, and real-time event streaming. See [Chrome Extension README](chrome-extension/README.md).

## ⚙️ Configuration

### Environment Variables

Key configuration options in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_MODEL` | `gpt-4o` | AI model to use |
| `AI_PROVIDER` | auto-detect | Provider: `openai`, `gemini`, `anthropic`, `lmstudio`, `cloud`, `webllm` |
| `AI_TEMPERATURE` | `0.7` | Response creativity |
| `AI_MAX_TOKENS` | `4096` | Max response tokens |
| `AI_MAX_TURNS` | `100` | Max conversation turns per execution |
| `OBOTO_DYNAMIC_ROUTES` | `false` | Enable dynamic JS route execution in the workspace content server |

### Workspace Configuration (`.oboto.json`)

Place a `.oboto.json` file in any workspace root to customize per-workspace behavior:

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

| Key | Values | Default | Description |
|-----|--------|---------|-------------|
| `dynamicRoutes.enabled` | `true` / `false` | `false` | Allow executing JS route handlers from `routes/`, `.routes/`, or `api/` |
| `surface.sandboxMode` | `"strict"` / `"permissive"` | `"strict"` | `strict` restricts surface `fetch` to localhost; `permissive` allows any origin |

### Model Routing

Route specific task types to different models for cost/quality optimization:

```env
ROUTE_AGENTIC=gemini-2.5-flash
ROUTE_REASONING_HIGH=gemini-2.5-pro
ROUTE_REASONING_MEDIUM=gemini-2.5-flash
ROUTE_REASONING_LOW=gemini-2.0-flash
ROUTE_SUMMARIZER=gemini-2.0-flash
ROUTE_CODE_COMPLETION=gemini-2.0-flash
```

### Secrets Vault

API keys can be managed through the Secrets Vault UI (`Cmd+K → "Secrets Vault"`). Secrets are AES-256-GCM encrypted at rest in `.secrets.enc`. Priority: Shell env vars > Vault secrets > `.env` file > defaults.

## 🧪 Testing

```bash
npm test
```

Tests use Jest with `--experimental-vm-modules` for ESM support. Test files are located alongside source in `__tests__/` directories.

## 🤝 Contributing

We welcome contributions! Please see the [Structured Development Guide](docs/architecture/structured-dev.md) to understand how we use the `SYSTEM_MAP.md` to manage features.

## 📄 License

MIT
