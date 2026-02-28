# Oboto Library API Reference

This document provides a comprehensive reference for the Oboto library (`@sschepis/oboto`), which allows you to embed advanced AI software engineering capabilities into your own applications.

## Table of Contents

- [Installation](#installation)
- [Entry Points & Subpath Imports](#entry-points--subpath-imports)
- [AiMan Class](#aiman-class)
  - [Constructor](#constructor)
  - [Execution Methods](#execution-methods)
  - [Structured Development Methods](#structured-development-methods)
  - [State Management](#state-management)
  - [Customization](#customization)
- [Task Management](#task-management)
- [Structured Development Modules](#structured-development-modules)
  - [FlowManager](#flowmanager)
  - [ManifestManager](#manifestmanager)
  - [Visualizers & Generators](#visualizers--generators)
- [Server API](#server-api)
- [Plugin System](#plugin-system)
- [Adapters](#adapters)
- [Core Components](#core-components)
- [CLI Binaries](#cli-binaries)
- [TypeScript Support](#typescript-support)

---

## Installation

```bash
# As a project dependency
npm install @sschepis/oboto

# Global install (adds oboto and oboto-server to PATH)
npm install -g @sschepis/oboto
```

---

## Entry Points & Subpath Imports

The package provides multiple entry points via the `exports` map in `package.json`:

| Import Path | Description | Key Exports |
|---|---|---|
| `@sschepis/oboto` | Main library entry | `AiMan`, `Oboto`, `config`, structured dev modules, task management |
| `@sschepis/oboto/server` | Programmatic server | `createServer` |
| `@sschepis/oboto/plugins` | Plugin system | `PluginManager`, `PluginLoader`, `createPluginAPI`, `PluginInstaller` |
| `@sschepis/oboto/adapters` | Adapter base classes | `ConsoleStatusAdapter`, `NetworkLLMAdapter`, `MemoryAdapter` |

### Examples

```javascript
// Main entry
import { AiMan, Oboto, config } from '@sschepis/oboto';

// Server
import { createServer } from '@sschepis/oboto/server';

// Plugins
import { PluginManager, PluginLoader } from '@sschepis/oboto/plugins';

// Adapters
import { ConsoleStatusAdapter, NetworkLLMAdapter, MemoryAdapter } from '@sschepis/oboto/adapters';
```

---

## AiMan Class

The `AiMan` class is the main entry point for the library. It orchestrates the AI assistant, manages context, and provides high-level methods for software development tasks. `Oboto` is an alias for `AiMan`.

### Constructor

```javascript
import { AiMan } from '@sschepis/oboto';

const ai = new AiMan({
    workingDir: process.cwd(),      // Root directory for file operations
    llmAdapter: myLLMAdapter,       // Optional: Custom LLM provider
    statusAdapter: myStatusAdapter, // Optional: Custom status reporter
    memoryAdapter: myMemoryAdapter, // Optional: Persistent memory store
    maxTurns: 30,                   // Maximum conversation turns per execution
    overrides: {}                   // Internal component overrides
});
```

### Execution Methods

#### `execute(task, options)`
Executes a natural language task.
- **task** (`string`): The task description.
- **options** (`Object`): Execution options (e.g., `signal` for aborting).
- **Returns**: `Promise<string>` (The final result).

#### `executeStream(task, onChunk, options)`
Executes a task and streams the response chunks.
- **onChunk** (`Function`): Callback `(chunk: string) => void`.

#### `design(task, options)`
Runs the agent in **Design Mode** to produce a technical design document without writing code.
- **Returns**: `Promise<DesignResult>`

#### `implement(designResult, options)`
Takes a `DesignResult` and implements the features described in it.
- **designResult** (`DesignResult`): The output from `design()`.
- **Returns**: `Promise<string>` (Implementation summary).

#### `designAndImplement(task, options)`
Convenience method that chains `design()` and `implement()`.
- **options.onDesignComplete**: Callback invoked when design is ready, before implementation starts.
- **Returns**: `Promise<{ design: DesignResult, result: string }>`

#### `test(implementationResult, options)`
Generates and runs unit tests for the implemented code.

#### `review(designResult, implementationResult, options)`
Performs an automated code review, comparing the implementation against the design.
- **Returns**: `Promise<{ overallScore, findings: [], summary }>`

### General Purpose Assistant

The library can be used as a general-purpose assistant via the `chat()` method and `Oboto` alias.

#### `chat(message, options)`
Send a conversational message to the assistant. Unlike `execute()`, which is task-oriented, `chat()` allows for interactive sessions where the assistant maintains context across multiple turns.

```javascript
import { Oboto } from '@sschepis/oboto'; // Oboto is an alias for AiMan

const assistant = new Oboto();

// General knowledge
const response = await assistant.chat("What is the capital of France?");
console.log(response);

// Code analysis
await assistant.chat("Summarize the contents of src/lib/index.mjs");
```

### State Management

#### `fork()`
Creates a complete copy of the current assistant state, including conversation history and tools. Useful for exploring alternative paths without affecting the main session.
- **Returns**: `AiMan` (A new instance).

#### `checkpoint(name)`
Saves the current conversation state with a name.
- **name** (`string`): Checkpoint identifier.

#### `rollbackTo(name)`
Restores the conversation state to a specific checkpoint.

#### `listCheckpoints()`
Returns a list of all saved checkpoints with metadata.

### Customization

#### `registerTool(schema, handler)`
Registers a custom tool for the agent to use.
- **schema**: JSON Schema defining the tool (OpenAI format).
- **handler**: Async function implementing the tool logic.

```javascript
ai.registerTool({
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get weather for location',
    parameters: { type: 'object', properties: { location: { type: 'string' } } }
  }
}, async ({ location }) => {
  return "Sunny, 25C";
});
```

#### `use(middleware)`
Adds middleware to the execution chain. Middleware can intercept requests and responses.

#### `on(event, listener)` / `off(event, listener)`
Subscribe to lifecycle events:
- `tool:start`: When a tool begins execution.
- `tool:end`: When a tool completes.

---

## Task Management

The library exports classes for managing long-running async tasks with checkpointing:

```javascript
import { TaskManager, TaskCheckpointManager, CheckpointStore } from '@sschepis/oboto';
```

### TaskManager
Manages spawning, monitoring, and controlling async tasks.
- `spawnTask(spec)`: Spawn a new background task.
- `getTaskStatus(taskId)`: Get the status of a running task.
- `listTasks()`: List all active tasks.
- `waitForTask(taskId)`: Wait for a task to complete.
- `cancelTask(taskId)`: Cancel a running task.

### TaskCheckpointManager
Provides checkpoint/restore capabilities for tasks in progress.
- `saveCheckpoint(taskId, state)`: Persist task state.
- `restoreCheckpoint(taskId)`: Restore from last checkpoint.
- `listCheckpoints(taskId)`: List available checkpoints.

### CheckpointStore
Pluggable storage backend for checkpoints. Default implementation uses the filesystem.

---

## Structured Development Modules

These modules power the structured development workflow and can be imported directly for specialized use cases.

```javascript
import { FlowManager, ManifestManager, C4Visualizer } from '@sschepis/oboto';
```

### FlowManager
Manages the transition between development phases (Discovery → Design → Interface → Implementation).
- `initStructuredDev(targetDir)`: Initialize the environment.
- `submitTechnicalDesign(featureId, doc)`: Submit a design.
- `approveDesign(featureId)`: Move to Interface phase.
- `lockInterfaces(featureId, defs)`: Lock API signatures.
- `submitCritique(featureId, critique)`: Review implementation.

### ManifestManager
Handles the reading and writing of `SYSTEM_MAP.md`, the "Living Manifest" of the project.
- `initManifest()`: Create a new manifest.
- `readManifest()`: Get current manifest content.
- `addFeature(id, name, ...)`: Register a feature.
- `addInvariant(id, name, desc)`: Add a global invariant.
- `createSnapshot(desc)`: Save manifest state.

### Visualizers & Generators

#### `C4Visualizer`
Generates Mermaid.js C4 architecture diagrams from the manifest.
- `generateComponentDiagram()`: Returns Mermaid syntax.

#### `KnowledgeGraphBuilder`
Analyzes the codebase to build a graph of files, classes, and dependencies.
- `buildGraph()`: Returns `{ nodes, edges }`.

#### `CiCdArchitect`
Generates CI/CD pipeline configurations.
- `generatePipeline(platform)`: Supports 'github' and 'gitlab'.

#### `ContainerizationWizard`
Generates Docker configurations.
- `generateConfig()`: Returns Dockerfile, .dockerignore, docker-compose.yml.

#### `ApiDocSmith`
Generates Markdown API documentation from source code JSDoc.
- `generateDocs(targetDir)`: Returns markdown string.

#### `EnhancementGenerator`
Proactively analyzes code to suggest improvements.
- `generateEnhancements(category, focusDirs)`: Returns list of suggestions.
- `implementEnhancements(list)`: Auto-implements selected enhancements.

---

## Server API

The `@sschepis/oboto/server` subpath provides a programmatic way to create an Express server backed by the Oboto AI engine.

```javascript
import { createServer } from '@sschepis/oboto/server';

const app = createServer({ workingDir: '/path/to/workspace' });
app.listen(3000, () => console.log('Oboto API on port 3000'));
```

### REST Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/execute` | Execute a task (returns JSON result) |
| `POST` | `/api/execute/stream` | Execute a task with SSE streaming |
| `POST` | `/api/design` | Generate a design document |
| `POST` | `/api/implement` | Implement from a design result |

### Full Server with WebSocket

For the full-featured server (with WebSocket support, plugin management, cloud sync, etc.), use the `oboto-server` binary or pass `--server` to the `oboto` CLI:

```bash
# Via binary
oboto-server --port 3000

# Via CLI flag
oboto --server --port 3000
```

---

## Plugin System

The `@sschepis/oboto/plugins` subpath exports the plugin management system.

```javascript
import { PluginManager, PluginLoader, createPluginAPI, PluginInstaller } from '@sschepis/oboto/plugins';
```

### PluginManager
Central manager for loading, enabling, disabling, and configuring plugins.

### PluginLoader
Discovers plugins from multiple sources:
1. **Builtin plugins** — shipped in the `plugins/` directory of the package
2. **Global plugins** — installed in `~/.oboto/plugins/`
3. **Workspace plugins** — in `.plugins/` within the current workspace
4. **npm plugins** — packages with keyword `oboto-plugin`

### createPluginAPI(context)
Factory function that creates the API surface exposed to plugins for registering tools, routes, UI components, and event handlers.

### PluginInstaller
Handles installing, updating, and removing plugins from npm or local paths.

### Creating a Plugin

See the included `plugins/hello-world/` for a complete example. A plugin consists of:
- `plugin.json` — metadata and configuration schema
- `index.mjs` — entry point exporting `activate(api)` and `deactivate()` functions
- `package.json` — optional npm metadata

---

## Adapters

The `@sschepis/oboto/adapters` subpath provides base adapter classes for customizing how the library interacts with LLMs, reports status, and stores memory.

```javascript
import { ConsoleStatusAdapter, NetworkLLMAdapter, MemoryAdapter } from '@sschepis/oboto/adapters';
```

### ConsoleStatusAdapter
Default adapter that reports status updates to the console.

### NetworkLLMAdapter
Adapter for connecting to remote LLM APIs (OpenAI, Anthropic, etc.).

### MemoryAdapter
Abstract base class for implementing persistent memory (e.g., Vector DB, File System).
- `store(text, metadata)` — Store a memory entry.
- `retrieve(query, topK)` — Retrieve relevant memories.

---

## Core Components

### `AiManEventBus`
A typed `EventEmitter` for system-wide events.

### `MiddlewareChain`
Manages a stack of middleware functions for request/response processing.

### `config`
Configuration module providing `loadConfig()` for reading Oboto settings from `~/.oboto/config.json` and environment variables.

### `DesignResult`
Data class returned by `ai.design()` containing the technical design document and metadata.

### `CancellationError`
Error class thrown when an operation is cancelled via an `AbortSignal`.

### `AssistantFacade` / `EventicFacade`
The core assistant implementation class. `AssistantFacade` is an alias for `EventicFacade`. Most users should use the `AiMan` wrapper instead.

---

## CLI Binaries

When installed globally (`npm install -g @sschepis/oboto`), two binaries are added to your PATH:

### `oboto`
The main CLI entry point supporting multiple modes:

```bash
# Interactive mode (REPL)
oboto

# Single-shot task execution
oboto "Create a REST API for users"

# Start the full server
oboto --server --port 3000
```

### `oboto-server`
Dedicated server binary — equivalent to `oboto --server`:

```bash
# Start server on default port
oboto-server

# Custom port
oboto-server --port 8080
```

---

## TypeScript Support

Type declarations are provided at `src/lib/interfaces.d.ts` and are referenced by the `types` field in `package.json`. Key exported types include:

- `AiMan` / `Oboto` — Main class
- `AssistantFacade` / `MiniAIAssistant` — Core facade aliases
- `DesignResult` — Design output
- `CancellationError` — Cancellation error
- `TaskManager`, `TaskCheckpointManager`, `CheckpointStore` — Task management
- `ConsoleStatusAdapter`, `NetworkLLMAdapter`, `MemoryAdapter` — Adapters
- `AiManEventBus`, `MiddlewareChain` — Core utilities

```typescript
import type { AiMan, DesignResult, TaskManager } from '@sschepis/oboto';
```
