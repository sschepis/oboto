# Oboto: Your AI-Powered Everything Assistant

**Oboto** is an advanced AI assistant built to make you more productive, efficient, and successful — across every domain. From software engineering and project management to research, automation, and creative work, Oboto combines a persistent cognitive architecture with deep system integration to act as your tireless partner in getting things done.

![Oboto Banner](ui/public/robot.svg)

## 🚀 Key Features

*   **🤖 Multi-Agent Architecture**: Multiple parallel conversations per workspace, background tasks, recurring schedules, and an autonomous agent loop that operates independently. Conversations share workspace memory and report findings back to a central command. See [Multi-Agent Architecture](docs/architecture/multi-agent.md).
*   **🧠 Consciousness Processor**: Simulates an "inner life" with state persistence, ambiguity resolution (Semantic Collapse), and embodied cognition (Somatic Engine) to drive more coherent reasoning.
*   **🏗️ Structured Development**: Enforces architectural discipline via a "Living Manifest" (`SYSTEM_MAP.md`), ensuring that code changes align with global invariants and design phases.
*   **🔌 Deep Integrations**:
    *   **OpenClaw**: Delegates tasks to external agents for cross-system coordination.
    *   **MCP Support**: Connects to any Model Context Protocol server for dynamic tool extension.
*   **🖥️ Generative UI**: Spawns dynamic React dashboards ("Surfaces") on the fly to visualize data or create custom control panels.
*   **🛠️ Extensive Tool Suite**: 50+ built-in tools for file manipulation, browser automation, desktop control, math computation, image generation, web research, and more.
*   **🔐 Secrets Vault**: AES-256-GCM encrypted secrets storage for API keys and credentials, managed through the UI or CLI.
*   **🧙 Setup Wizard**: Guided first-run onboarding that walks through provider selection, API key configuration, workspace setup, and optional OpenClaw integration.
*   **🖥️ System Tray App**: Electron-based tray application for running Oboto as a persistent background service with workspace management and auto-start on login.
*   **🌐 Chrome Extension**: Full browser automation and control via a Chrome extension that connects to the Oboto server over WebSocket.
*   **📦 Library API**: Embeddable as an npm package (`@sschepis/oboto`) with a programmatic API for task execution, streaming, design-and-implement workflows, and custom tool registration.

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
*   [**Skills Settings Tab**](docs/architecture/skills-settings-tab.md) — Managing skills from the UI
*   [**Tools Reference**](docs/guides/tools.md) — Complete list of available tools and commands
*   [**UI Surfaces Guide**](docs/guides/ui-surfaces.md) — Dynamic dashboards and UI components
*   [**Setup & Installation**](docs/guides/setup.md) — Detailed installation instructions
*   [**Library API Reference**](src/lib/README.md) — Programmatic API for embedding Oboto

## ⚡ Quick Start

### Prerequisites
*   Node.js v18+
*   npm & pnpm
*   Google Chrome (for browser automation)

### Installation

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
    cd ..
    ```

3.  **Configure**
    ```bash
    cp .env.example .env
    # Edit .env with your API keys (Google Gemini, Anthropic, OpenAI)
    ```

### Running Oboto

**Recommended: Server Mode (Agent + UI)**
```bash
# Terminal 1: Start the backend
npm run serve

# Terminal 2: Start the UI
npm run dev:ui
```
Access the UI at `http://localhost:5173`.

**CLI Mode**
```bash
npm start
```

**System Tray App (Background Service)**
```bash
npm run tray:install
npm run tray
```

## 🏗️ Project Structure

```
oboto/
├── src/                          # Backend source
│   ├── core/                     # Agent loop, AI provider, conversation, consciousness
│   ├── server/                   # Express + WebSocket server, WS handlers
│   ├── execution/                # Tool executor and handler modules
│   ├── structured-dev/           # Manifest, flow manager, bootstrapper, visualizers
│   ├── reasoning/                # Fact inference, semantic collapse
│   ├── integration/openclaw/     # OpenClaw agent gateway integration
│   ├── skills/                   # Skills manager
│   ├── tools/                    # Tool definitions (50+ tools across 20+ modules)
│   ├── surfaces/                 # Dynamic UI surface manager
│   ├── lib/                      # Embeddable library API (npm package entry point)
│   └── workspace/                # Workspace and file management
├── ui/                           # React + Vite frontend
│   └── src/
│       ├── components/           # Chat, layout, features (40+ components)
│       ├── hooks/                # React hooks for state management
│       ├── services/             # WebSocket service layer
│       └── surface-kit/          # Reusable UI primitives
├── tray-app/                     # Electron system tray application
├── chrome-extension/             # Chrome browser controller extension
├── skills/                       # Modular skill definitions (SKILL.md)
├── docs/                         # Architecture and guide documentation
└── themes.json                   # UI theme definitions
```

## 🧠 The "Consciousness"

Oboto features a unique cognitive architecture:
*   **Fact Inference Engine**: Learns and deduces new facts from conversation context.
*   **Symbolic Continuity**: Maintains a cryptographic "identity thread" across sessions, with optional Chinese Room Mode for encrypted private symbolic space.
*   **Somatic Engine**: Simulates nervous system states (Focus, Stress, Rest) to modulate creativity and caution.
*   **Archetype Analyzer**: Analyzes interaction patterns and adapts persona behavior.
*   **Persona Manager**: Manages customizable agent personalities and behavioral archetypes.

## 🛠️ Tool Categories

| Category | Tools | Description |
|---|---|---|
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
| **Skills** | install, list, invoke | Modular skill system |
| **Embeddings** | embed, search | Vector embedding operations |
| **TTS** | speak | Text-to-speech via ElevenLabs |

## 📦 Library Usage

Oboto can be embedded as a library in your own Node.js applications:

```bash
npm install @sschepis/oboto
```

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
|---|---|---|
| `AI_MODEL` | `gpt-4o` | AI model to use |
| `AI_PROVIDER` | auto-detect | Provider: `openai`, `gemini`, `anthropic`, `local` |
| `AI_TEMPERATURE` | `0.7` | Response creativity |
| `AI_MAX_TOKENS` | `4096` | Max response tokens |
| `AI_MAX_TURNS` | `100` | Max conversation turns per execution |

### Model Routing

Route specific task types to different models for cost/quality optimization:

```env
ROUTE_AGENTIC=gemini-2.5-flash
ROUTE_REASONING_HIGH=gemini-2.5-pro
ROUTE_REASONING_LOW=gemini-2.0-flash
ROUTE_SUMMARIZER=gemini-2.0-flash
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
