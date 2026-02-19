# AI Man Library API Reference

This document provides a comprehensive reference for the AI Man library, which allows you to embed advanced AI software engineering capabilities into your own applications.

## Table of Contents

- [AiMan Class](#aiman-class)
  - [Constructor](#constructor)
  - [Execution Methods](#execution-methods)
  - [Structured Development Methods](#structured-development-methods)
  - [State Management](#state-management)
  - [Customization](#customization)
- [Structured Development Modules](#structured-development-modules)
  - [FlowManager](#flowmanager)
  - [ManifestManager](#manifestmanager)
  - [Visualizers & Generators](#visualizers--generators)
- [Core Components](#core-components)

---

## AiMan Class

The `AiMan` class is the main entry point for the library. It orchestrates the AI assistant, manages context, and provides high-level methods for software development tasks.

### Constructor

```javascript
import { AiMan } from 'ai-man/lib';

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
import { Oboto } from 'ai-man/lib'; // Oboto is an alias for AiMan

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

## Structured Development Modules

These modules power the structured development workflow and can be imported directly for specialized use cases.

```javascript
import { FlowManager, ManifestManager, C4Visualizer } from 'ai-man/lib';
```

### FlowManager
Manages the transition between development phases (Discovery -> Design -> Interface -> Implementation).
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

#### `TutorialGenerator`
Creates tutorials based on the session history.
- `generateTutorial(title)`: Returns markdown tutorial.

#### `EnhancementGenerator`
Proactively analyzes code to suggest improvements.
- `generateEnhancements(category, focusDirs)`: Returns list of suggestions.
- `implementEnhancements(list)`: Auto-implements selected enhancements.

---

## Core Components

### `AiManEventBus`
A typed `EventEmitter` for system-wide events.

### `MiddlewareChain`
Manages a stack of middleware functions for request/response processing.

### `MemoryAdapter`
Abstract base class for implementing persistent memory (e.g., Vector DB, File System).
- `store(text, metadata)`
- `retrieve(query, topK)`
