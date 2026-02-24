# Oboto (ai-man) — Complete Source File Inventory

> **Package**: `@sschepis/oboto`  
> **Generated**: 2026-02-23  
> **Total source files**: ~170 backend + ~130 frontend + Chrome extension

This document lists every source file in the project, what it does, and which other files depend on it.

---

## Table of Contents

1. [Entry Points & Configuration](#1-entry-points--configuration)
2. [Core Engine (`src/core/`)](#2-core-engine-srccore)
3. [CLI (`src/cli/`)](#3-cli-srccli)
4. [Cloud Integration (`src/cloud/`)](#4-cloud-integration-srccloud)
5. [Tool Execution (`src/execution/`)](#5-tool-execution-srcexecution)
6. [Tool Definitions (`src/tools/definitions/`)](#6-tool-definitions-srctoolsdefinitions)
7. [Tool Implementations (`src/tools/`)](#7-tool-implementations-srctools)
8. [Server & WebSocket (`src/server/`)](#8-server--websocket-srcserver)
9. [WebSocket Handlers (`src/server/ws-handlers/`)](#9-websocket-handlers-srcserverws-handlers)
10. [Library / NPM Package (`src/lib/`)](#10-library--npm-package-srclib)
11. [Integration — OpenClaw (`src/integration/openclaw/`)](#11-integration--openclaw-srcintegrationopenclaw)
12. [Project Management (`src/project-management/`)](#12-project-management-srcproject-management)
13. [Structured Development (`src/structured-dev/`)](#13-structured-development-srcstructured-dev)
14. [Services (`src/services/`)](#14-services-srcservices)
15. [Skills (`src/skills/`)](#15-skills-srcskills)
16. [Surfaces (`src/surfaces/`)](#16-surfaces-srcsurfaces)
17. [Reasoning & Consciousness (`src/reasoning/`, `src/core/`)](#17-reasoning--consciousness)
18. [Quality (`src/quality/`)](#18-quality-srcquality)
19. [Workspace (`src/workspace/`)](#19-workspace-srcworkspace)
20. [Package Manager (`src/package/`)](#20-package-manager-srcpackage)
21. [Custom Tools (`src/custom-tools/`)](#21-custom-tools-srccustom-tools)
22. [UI — Console (`src/ui/`)](#22-ui--console-srcui)
23. [UI — Generative (`src/ui/generative/`)](#23-ui--generative-srcuigenerative)
24. [Shared Utilities (`src/lib/` — new)](#24-shared-utilities-srclib--new)
25. [Chrome Extension (`chrome-extension/`)](#25-chrome-extension)
26. [Frontend UI (`ui/src/`)](#26-frontend-ui-uisrc)
27. [Test Files](#27-test-files)
28. [Top-Level Config & Scripts](#28-top-level-config--scripts)

---

## 1. Entry Points & Configuration

### `ai.mjs`
**Purpose**: CLI entry point. Has shebang `#!/usr/bin/env node`, simply imports and calls `main()`.  
**Used by**: `package.json` `bin` field — invoked as `npx oboto` or `oboto` CLI command.  
**Depends on**: [`src/main.mjs`](src/main.mjs)

### `src/main.mjs`
**Purpose**: Main orchestrator (~10K chars). Parses CLI arguments, initializes all services (SecretsManager, WorkspaceContentServer, TaskManager, OpenClawManager, TaskCheckpointManager, SchedulerService, AssistantFacade, AgentLoopController, CloudSync), then dispatches to one of three modes: web server, interactive CLI, or single-shot CLI.  
**Used by**: [`ai.mjs`](ai.mjs), [`src/lib/index.mjs`](src/lib/index.mjs)  
**Depends on**: Nearly everything — [`src/config.mjs`](src/config.mjs), [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs), [`src/core/agent-loop-controller.mjs`](src/core/agent-loop-controller.mjs), [`src/core/task-manager.mjs`](src/core/task-manager.mjs), [`src/core/task-checkpoint-manager.mjs`](src/core/task-checkpoint-manager.mjs), [`src/core/scheduler-service.mjs`](src/core/scheduler-service.mjs), [`src/server/secrets-manager.mjs`](src/server/secrets-manager.mjs), [`src/server/workspace-content-server.mjs`](src/server/workspace-content-server.mjs), [`src/server/web-server.mjs`](src/server/web-server.mjs), [`src/cli/cli-interface.mjs`](src/cli/cli-interface.mjs), [`src/cloud/cloud-sync.mjs`](src/cloud/cloud-sync.mjs), [`src/integration/openclaw/manager.mjs`](src/integration/openclaw/manager.mjs)

### `src/config.mjs`
**Purpose**: Centralized configuration loaded from environment variables. Exports a `config` object with settings for AI model/provider, model routing roles, tool toggles, symbolic continuity, API keys (OpenAI, Gemini, Anthropic, ElevenLabs, Firecrawl, Serper), and cloud configuration.  
**Used by**: Most modules throughout the codebase — [`src/core/ai-provider.mjs`](src/core/ai-provider.mjs), [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs), [`src/core/prompt-router.mjs`](src/core/prompt-router.mjs), [`src/core/model-registry.mjs`](src/core/model-registry.mjs), [`src/server/web-server.mjs`](src/server/web-server.mjs), [`src/tools/file-tools.mjs`](src/tools/file-tools.mjs), [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs), and many more.  
**Depends on**: Environment variables (`.env`)

---

## 2. Core Engine (`src/core/`)

### `src/core/eventic.mjs`
**Purpose**: The core event-driven engine class (`Eventic`). Implements a plugin system via `use()`, handler dispatch via `dispatch()`, tool and handler registries, and default in-memory tools (`remember`, `recall`, `list_memories`). This is the foundational runtime that all plugins extend.  
**Used by**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs)  
**Depends on**: Nothing external (self-contained)

### `src/core/eventic-facade.mjs`
**Purpose**: Main assistant class (`EventicFacade`, ~20K chars). Wires up the Eventic engine with all plugins (AI, tools, state, agent loop). Manages ToolExecutor, conversations, history, sessions, personas. Public API includes `run()`, `runStream()`, conversation CRUD, workspace switching, and surface management.  
**Used by**: [`src/main.mjs`](src/main.mjs), [`src/lib/index.mjs`](src/lib/index.mjs), [`src/core/assistant-facade.mjs`](src/core/assistant-facade.mjs), [`src/server/web-server.mjs`](src/server/web-server.mjs), [`src/cli/cli-interface.mjs`](src/cli/cli-interface.mjs)  
**Depends on**: [`src/core/eventic.mjs`](src/core/eventic.mjs), [`src/core/eventic-ai-plugin.mjs`](src/core/eventic-ai-plugin.mjs), [`src/core/eventic-tools-plugin.mjs`](src/core/eventic-tools-plugin.mjs), [`src/core/eventic-state-plugin.mjs`](src/core/eventic-state-plugin.mjs), [`src/core/eventic-agent-loop-plugin.mjs`](src/core/eventic-agent-loop-plugin.mjs), [`src/core/history-manager.mjs`](src/core/history-manager.mjs), [`src/core/conversation-manager.mjs`](src/core/conversation-manager.mjs), [`src/core/consciousness-processor.mjs`](src/core/consciousness-processor.mjs), [`src/core/mcp-client-manager.mjs`](src/core/mcp-client-manager.mjs), [`src/core/persona-manager.mjs`](src/core/persona-manager.mjs), [`src/core/resolang-service.mjs`](src/core/resolang-service.mjs), [`src/core/prompt-router.mjs`](src/core/prompt-router.mjs), [`src/core/system-prompt.mjs`](src/core/system-prompt.mjs), [`src/core/conversation-lock.mjs`](src/core/conversation-lock.mjs), [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs), [`src/surfaces/surface-manager.mjs`](src/surfaces/surface-manager.mjs), [`src/workspace/workspace-manager.mjs`](src/workspace/workspace-manager.mjs)

### `src/core/eventic-ai-plugin.mjs`
**Purpose**: AI provider plugin for Eventic. Wraps `ai-provider.mjs`, handles streaming/non-streaming calls, tool call extraction, JSON format support, history management, and multi-turn conversations. Registered as the AI handler in the Eventic engine.  
**Used by**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs) (via `use()`)  
**Depends on**: [`src/core/ai-provider.mjs`](src/core/ai-provider.mjs), [`src/config.mjs`](src/config.mjs)

### `src/core/eventic-agent-loop-plugin.mjs`
**Purpose**: Actor-Critic agent loop plugin (~18K chars). Implements the multi-turn agentic reasoning loop with handlers: `AGENT_START` (triage/fast-path decision), `ACTOR_CRITIC_LOOP` (multi-turn generation), `EXECUTE_TOOLS` (tool execution), `CRITIC_EVALUATE_TOOLS` (tool result evaluation), `EVALUATE_TEXT_RESPONSE` (text response quality check). Includes retry logic and autonomous continuation.  
**Used by**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs) (via `use()`)  
**Depends on**: [`src/core/status-reporter.mjs`](src/core/status-reporter.mjs), [`src/config.mjs`](src/config.mjs)

### `src/core/eventic-state-plugin.mjs`
**Purpose**: State management plugin. Bridges `HistoryManager`, `ConversationManager`, and `TaskCheckpointManager` into the Eventic context. Handles state persistence, conversation switching, and checkpoint creation/restoration.  
**Used by**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs) (via `use()`)  
**Depends on**: [`src/core/history-manager.mjs`](src/core/history-manager.mjs), [`src/core/conversation-manager.mjs`](src/core/conversation-manager.mjs), [`src/core/task-checkpoint-manager.mjs`](src/core/task-checkpoint-manager.mjs)

### `src/core/eventic-tools-plugin.mjs`
**Purpose**: Tools bridge plugin. Adapts the legacy `ToolExecutor` tools into Eventic's tool registry format so the engine can discover and invoke them.  
**Used by**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs) (via `use()`)  
**Depends on**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)

### `src/core/ai-provider.mjs`
**Purpose**: Multi-provider AI abstraction (~34K chars). Supports OpenAI REST API, Google Gemini SDK (`@google/genai`), Anthropic (via Vertex), LMStudio/local models, Cloud proxy, and WebLLM (browser-side inference). Handles streaming and non-streaming, format translation between OpenAI and Gemini tool-call formats, and retry with exponential backoff.  
**Used by**: [`src/core/eventic-ai-plugin.mjs`](src/core/eventic-ai-plugin.mjs), [`src/core/prompt-router.mjs`](src/core/prompt-router.mjs)  
**Depends on**: [`src/config.mjs`](src/config.mjs), `@google/genai` (npm)

### `src/core/agent-loop-controller.mjs`
**Purpose**: Autonomous background agent loop controller (~22K chars). Manages play/pause/stop of the agent loop, assembles briefing packets from workspace context, handles blocking questions (pauses loop until user answers), and injects results back into the main chat history.  
**Used by**: [`src/main.mjs`](src/main.mjs), [`src/server/web-server.mjs`](src/server/web-server.mjs), [`src/server/ws-handlers/agent-loop-handler.mjs`](src/server/ws-handlers/agent-loop-handler.mjs)  
**Depends on**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs), [`src/core/task-manager.mjs`](src/core/task-manager.mjs), [`src/workspace/workspace-manager.mjs`](src/workspace/workspace-manager.mjs)

### `src/core/task-manager.mjs`
**Purpose**: Background task spawning and lifecycle management (~13K chars). Creates isolated assistant instances for background tasks, tracks progress, manages output logging, and supports task abort.  
**Used by**: [`src/main.mjs`](src/main.mjs), [`src/core/agent-loop-controller.mjs`](src/core/agent-loop-controller.mjs), [`src/execution/handlers/async-task-handlers.mjs`](src/execution/handlers/async-task-handlers.mjs), [`src/server/ws-handlers/task-handler.mjs`](src/server/ws-handlers/task-handler.mjs)  
**Depends on**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs)

### `src/core/task-checkpoint-manager.mjs`
**Purpose**: WAL-based task checkpointing (~22K chars). Provides periodic automatic checkpoints, crash recovery with pending recovery queue, and checkpoint metadata management. Uses Write-Ahead Logging for durability.  
**Used by**: [`src/main.mjs`](src/main.mjs), [`src/core/eventic-state-plugin.mjs`](src/core/eventic-state-plugin.mjs), [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs)  
**Depends on**: [`src/core/checkpoint-store.mjs`](src/core/checkpoint-store.mjs)

### `src/core/checkpoint-store.mjs`
**Purpose**: File-based checkpoint persistence (~16K chars). Manages checkpoint files with WAL (Write-Ahead Log) and recovery manifest. Stores checkpoint data as JSON files on disk.  
**Used by**: [`src/core/task-checkpoint-manager.mjs`](src/core/task-checkpoint-manager.mjs)  
**Depends on**: Node.js `fs`, `path`

### `src/core/history-manager.mjs`
**Purpose**: Conversation history management (~17K chars). Manages the message array for a single conversation, enforces token/context limits via truncation, supports summarization, provides named checkpoints with rollback, and estimates token counts.  
**Used by**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs), [`src/core/eventic-state-plugin.mjs`](src/core/eventic-state-plugin.mjs), [`src/core/conversation-manager.mjs`](src/core/conversation-manager.mjs), [`src/server/ws-handlers/misc-handler.mjs`](src/server/ws-handlers/misc-handler.mjs)  
**Depends on**: [`src/config.mjs`](src/config.mjs)

### `src/core/conversation-manager.mjs`
**Purpose**: Multiple named conversation management. Stores conversations as JSON files under `.conversations/` in the workspace. Supports creating, switching, listing, and deleting conversations. Each conversation wraps a separate `HistoryManager`. Default conversation is "chat".  
**Used by**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs), [`src/core/eventic-state-plugin.mjs`](src/core/eventic-state-plugin.mjs), [`src/core/controllers/conversation-controller.mjs`](src/core/controllers/conversation-controller.mjs)  
**Depends on**: [`src/core/history-manager.mjs`](src/core/history-manager.mjs)

### `src/core/consciousness-processor.mjs`
**Purpose**: Consciousness subsystem orchestrator (~10K chars). Coordinates `FactInferenceEngine`, `SemanticCollapseEngine`, `SomaticEngine`, `SomaticNarrative`, and `ArchetypeAnalyzer` to produce consciousness-enriched context for AI responses. Uses `@aleph-ai/tinyaleph` resonance primitives.  
**Used by**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs)  
**Depends on**: [`src/reasoning/fact-inference-engine.mjs`](src/reasoning/fact-inference-engine.mjs), [`src/reasoning/semantic-collapse.mjs`](src/reasoning/semantic-collapse.mjs), [`src/core/somatic-engine.mjs`](src/core/somatic-engine.mjs), [`src/core/somatic-narrative.mjs`](src/core/somatic-narrative.mjs), [`src/core/archetype-analyzer.mjs`](src/core/archetype-analyzer.mjs)

### `src/core/mcp-client-manager.mjs`
**Purpose**: Model Context Protocol (MCP) client manager (~9.5K chars). Connects to external MCP tool servers via stdio or SSE transport, discovers tools from connected servers, and manages global/workspace configuration.  
**Used by**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs), [`src/execution/handlers/mcp-handlers.mjs`](src/execution/handlers/mcp-handlers.mjs)  
**Depends on**: `@modelcontextprotocol/sdk` (npm)

### `src/core/model-registry.mjs`
**Purpose**: Dynamic model catalog. Fetches actual model lists from provider APIs (OpenAI, Gemini, LMStudio) when API keys are configured. Includes curated Anthropic models. Supports custom model registration for local Ollama/LMStudio models.  
**Used by**: [`src/server/ws-handlers/settings-handler.mjs`](src/server/ws-handlers/settings-handler.mjs), [`src/core/prompt-router.mjs`](src/core/prompt-router.mjs)  
**Depends on**: [`src/config.mjs`](src/config.mjs)

### `src/core/persona-manager.mjs`
**Purpose**: AI persona configuration manager. Loads persona JSON files from `.ai-man/personas/` directory, manages active persona, and renders persona prompt blocks for system prompt injection.  
**Used by**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs), [`src/execution/handlers/persona-handlers.mjs`](src/execution/handlers/persona-handlers.mjs)  
**Depends on**: [`src/ui/console-styler.mjs`](src/ui/console-styler.mjs)

### `src/core/prompt-router.mjs`
**Purpose**: Role-based model routing (~10K chars). Routes requests to different models based on role (agentic, reasoning_high, reasoning_medium, reasoning_low, summarizer, code_completion, triage). Manages token budgets and context fitting.  
**Used by**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs), [`src/core/eventic-ai-plugin.mjs`](src/core/eventic-ai-plugin.mjs)  
**Depends on**: [`src/config.mjs`](src/config.mjs), [`src/core/ai-provider.mjs`](src/core/ai-provider.mjs)

### `src/core/resolang-service.mjs`
**Purpose**: ResoLang WASM-based holographic memory service (~13K chars). Provides workspace-local and global resonance stores using `@sschepis/resolang` WASM primitives. Used for semantic memory with resonance-based retrieval.  
**Used by**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs)  
**Depends on**: `@sschepis/resolang` (npm)

### `src/core/scheduler-service.mjs`
**Purpose**: Recurring task schedule manager. Manages persistent cron-like schedules, handles workspace switching, and integrates with the event bus for schedule execution notifications.  
**Used by**: [`src/main.mjs`](src/main.mjs), [`src/server/ws-handlers/task-handler.mjs`](src/server/ws-handlers/task-handler.mjs)  
**Depends on**: [`src/lib/event-bus.mjs`](src/lib/event-bus.mjs), [`src/ui/console-styler.mjs`](src/ui/console-styler.mjs)

### `src/core/somatic-engine.mjs`
**Purpose**: Body-region metaphor computation (~11K chars). Computes activation levels across body regions (crown, third-eye, throat, heart, solar-plexus, sacral, root, hands, spine) from agent metrics. Produces behavioral modulation signals.  
**Used by**: [`src/core/consciousness-processor.mjs`](src/core/consciousness-processor.mjs)  
**Depends on**: `@aleph-ai/tinyaleph` (npm)

### `src/core/somatic-narrative.mjs`
**Purpose**: Natural language inner voice narrative generator (~9.3K chars). Converts `SomaticState` (body-region activations) into human-readable narrative text describing the AI's inner experience.  
**Used by**: [`src/core/consciousness-processor.mjs`](src/core/consciousness-processor.mjs)  
**Depends on**: Nothing external

### `src/core/archetype-analyzer.mjs`
**Purpose**: Jungian archetype detection (~13K chars). Analyzes agent behavior patterns to detect active archetypes (Hero, Sage, Trickster, etc.) using `@aleph-ai/tinyaleph` SymbolicSMF resonance.  
**Used by**: [`src/core/consciousness-processor.mjs`](src/core/consciousness-processor.mjs)  
**Depends on**: `@aleph-ai/tinyaleph` (npm)

### `src/core/status-reporter.mjs`
**Purpose**: Human-readable status description generator. Produces descriptive status messages for tool calls and agent lifecycle events, emitted as 'status' log entries through `consoleStyler` for UI display.  
**Used by**: [`src/core/eventic-agent-loop-plugin.mjs`](src/core/eventic-agent-loop-plugin.mjs), [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: [`src/ui/console-styler.mjs`](src/ui/console-styler.mjs)

### `src/core/system-prompt.mjs`
**Purpose**: System prompt generation. Creates the full system prompt with workspace context, persona injection, skills summary, surface information, and behavioral guidelines.  
**Used by**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs)  
**Depends on**: Nothing external (pure function)

### `src/core/controllers/conversation-controller.mjs`
**Purpose**: Conversation CRUD controller. Delegates conversation operations (list, create, switch, delete, rename) from `EventicFacade` to `ConversationManager`.  
**Used by**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs)  
**Depends on**: [`src/core/conversation-manager.mjs`](src/core/conversation-manager.mjs)

### `src/core/controllers/session-controller.mjs`
**Purpose**: Session save/load controller. Handles session persistence (saving and restoring full assistant state).  
**Used by**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs)  
**Depends on**: Node.js `fs`

---

## 3. CLI (`src/cli/`)

### `src/cli/cli-interface.mjs`
**Purpose**: CLI interaction module (~11K chars). Handles argument parsing, interactive mode (readline-based REPL), single-shot command execution, and signal handlers (SIGINT/SIGTERM). Displays responses with styled output.  
**Used by**: [`src/main.mjs`](src/main.mjs)  
**Depends on**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs), [`src/ui/console-styler.mjs`](src/ui/console-styler.mjs), [`src/config.mjs`](src/config.mjs)

---

## 4. Cloud Integration (`src/cloud/`)

### `src/cloud/cloud-sync.mjs`
**Purpose**: Top-level cloud orchestrator (~15K chars). Owns `CloudClient`, `CloudAuth`, and all sub-managers (workspace, conversation, file sync, realtime). Provides the unified API for all cloud operations.  
**Used by**: [`src/main.mjs`](src/main.mjs), [`src/server/ws-handlers/cloud-handler.mjs`](src/server/ws-handlers/cloud-handler.mjs)  
**Depends on**: [`src/cloud/cloud-client.mjs`](src/cloud/cloud-client.mjs), [`src/cloud/cloud-auth.mjs`](src/cloud/cloud-auth.mjs), [`src/cloud/cloud-config.mjs`](src/cloud/cloud-config.mjs), [`src/cloud/cloud-workspace-sync.mjs`](src/cloud/cloud-workspace-sync.mjs), [`src/cloud/cloud-conversation-sync.mjs`](src/cloud/cloud-conversation-sync.mjs), [`src/cloud/cloud-file-sync.mjs`](src/cloud/cloud-file-sync.mjs), [`src/cloud/cloud-realtime.mjs`](src/cloud/cloud-realtime.mjs), [`src/cloud/cloud-agent.mjs`](src/cloud/cloud-agent.mjs)

### `src/cloud/cloud-auth.mjs`
**Purpose**: Authentication lifecycle (~10K chars). Handles login, logout, token refresh, and credential caching via `SecretsManager`. Supports email/password and magic link auth.  
**Used by**: [`src/cloud/cloud-sync.mjs`](src/cloud/cloud-sync.mjs)  
**Depends on**: [`src/cloud/cloud-client.mjs`](src/cloud/cloud-client.mjs), [`src/server/secrets-manager.mjs`](src/server/secrets-manager.mjs)

### `src/cloud/cloud-client.mjs`
**Purpose**: Zero-dependency REST client for Oboto Cloud (~5.5K chars). Uses native `fetch` to communicate with Supabase REST/Auth APIs.  
**Used by**: [`src/cloud/cloud-sync.mjs`](src/cloud/cloud-sync.mjs), [`src/cloud/cloud-auth.mjs`](src/cloud/cloud-auth.mjs), all cloud sub-managers  
**Depends on**: [`src/cloud/cloud-config.mjs`](src/cloud/cloud-config.mjs)

### `src/cloud/cloud-config.mjs`
**Purpose**: Cloud configuration from environment variables. Exports Supabase URL and anon key.  
**Used by**: [`src/cloud/cloud-client.mjs`](src/cloud/cloud-client.mjs), [`src/cloud/cloud-sync.mjs`](src/cloud/cloud-sync.mjs)  
**Depends on**: Environment variables

### `src/cloud/cloud-agent.mjs`
**Purpose**: Cloud AI agent invocation (~3K chars). Calls Supabase Edge Functions to run AI agents remotely.  
**Used by**: [`src/cloud/cloud-sync.mjs`](src/cloud/cloud-sync.mjs)  
**Depends on**: [`src/cloud/cloud-client.mjs`](src/cloud/cloud-client.mjs)

### `src/cloud/cloud-conversation-sync.mjs`
**Purpose**: Append-only conversation/message synchronization (~7K chars). Syncs conversations and messages to/from the cloud using append-only semantics with timestamps for conflict resolution.  
**Used by**: [`src/cloud/cloud-sync.mjs`](src/cloud/cloud-sync.mjs)  
**Depends on**: [`src/cloud/cloud-client.mjs`](src/cloud/cloud-client.mjs)

### `src/cloud/cloud-file-sync.mjs`
**Purpose**: File upload/download with Supabase Storage (~8.7K chars). Performs checksum-based delta sync to avoid redundant transfers.  
**Used by**: [`src/cloud/cloud-sync.mjs`](src/cloud/cloud-sync.mjs)  
**Depends on**: [`src/cloud/cloud-client.mjs`](src/cloud/cloud-client.mjs)

### `src/cloud/cloud-workspace-sync.mjs`
**Purpose**: Bidirectional workspace state synchronization (~6.6K chars). Uses `.cloud-link.json` files to track cloud workspace mappings and sync state.  
**Used by**: [`src/cloud/cloud-sync.mjs`](src/cloud/cloud-sync.mjs)  
**Depends on**: [`src/cloud/cloud-client.mjs`](src/cloud/cloud-client.mjs)

### `src/cloud/cloud-realtime.mjs`
**Purpose**: Phoenix Channel WebSocket client for Supabase Realtime (~13K chars). Implements Phoenix protocol for presence tracking and live update subscriptions.  
**Used by**: [`src/cloud/cloud-sync.mjs`](src/cloud/cloud-sync.mjs)  
**Depends on**: `ws` (npm)

---

## 5. Tool Execution (`src/execution/`)

### `src/execution/tool-executor.mjs`
**Purpose**: Central tool execution engine (~40K chars). Registers all tool schemas from definition files, routes tool calls to the appropriate handler classes, manages tool confirmation workflows, and handles dry-run mode. This is the main bridge between AI tool calls and actual execution.  
**Used by**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs), [`src/core/eventic-tools-plugin.mjs`](src/core/eventic-tools-plugin.mjs)  
**Depends on**: All handler files in [`src/execution/handlers/`](src/execution/handlers/), all definition files in [`src/tools/definitions/`](src/tools/definitions/), [`src/tools/file-tools.mjs`](src/tools/file-tools.mjs), [`src/tools/shell-tools.mjs`](src/tools/shell-tools.mjs), [`src/tools/desktop-automation-tools.mjs`](src/tools/desktop-automation-tools.mjs)

### `src/execution/dry-run-guard.mjs`
**Purpose**: Dry-run mode utility. When dry-run is enabled, logs tool calls without executing them.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: Nothing external

### `src/execution/handlers/async-task-handlers.mjs`
**Purpose**: Background task tool handlers (~8K chars). Implements `spawn_background_task`, `check_task_status`, `list_background_tasks`, `cancel_background_task`.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: [`src/core/task-manager.mjs`](src/core/task-manager.mjs)

### `src/execution/handlers/browser-handlers.mjs`
**Purpose**: Puppeteer browser automation handlers (~8K chars). Implements `browse_open`, `browse_click`, `browse_type`, `browse_screenshot`, `browse_close`.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: `puppeteer` (npm)

### `src/execution/handlers/chrome-ext-handlers.mjs`
**Purpose**: Chrome extension bridge handlers (~2.8K chars). Routes commands to the Chrome extension via WebSocket.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: [`src/server/chrome-ws-bridge.mjs`](src/server/chrome-ws-bridge.mjs)

### `src/execution/handlers/core-handlers.mjs`
**Purpose**: Core tool handlers (~11K chars). Implements `execute_javascript` (eval), `remember`/`recall`/`list_memories` (in-memory key-value store), `get_conversation_history`, and `call_ai_assistant` (recursive AI calls).  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: [`src/package/package-manager.mjs`](src/package/package-manager.mjs)

### `src/execution/handlers/embed-handlers.mjs`
**Purpose**: Inline embed handlers (~2.3K chars). Implements `embed_object` for embedding YouTube, Spotify, maps, CodePen, etc. in chat.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: Nothing external

### `src/execution/handlers/firecrawl-handlers.mjs`
**Purpose**: Web scraping handlers (~5K chars). Implements `firecrawl_scrape`, `firecrawl_crawl`, `firecrawl_search` using the Firecrawl API.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: `@mendable/firecrawl-js` (npm)

### `src/execution/handlers/image-handlers.mjs`
**Purpose**: Image generation and manipulation handlers (~17K chars). Implements `generate_image` (DALL-E 3), `edit_image`, `analyze_image`, `composite_images`, `resize_image` using OpenAI and Jimp.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: `jimp` (npm), OpenAI API

### `src/execution/handlers/math-handlers.mjs`
**Purpose**: Math evaluation handlers (~6.4K chars). Implements `evaluate_math`, `solve_equation`, `plot_function` using mathjs.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: `mathjs` (npm)

### `src/execution/handlers/mcp-handlers.mjs`
**Purpose**: MCP server management handlers (~2.8K chars). Implements `mcp_add_server`, `mcp_remove_server`, `mcp_list_servers`.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: [`src/core/mcp-client-manager.mjs`](src/core/mcp-client-manager.mjs)

### `src/execution/handlers/openclaw-handlers.mjs`
**Purpose**: OpenClaw delegation handlers (~3.5K chars). Implements `delegate_to_openclaw` for forwarding tasks to the OpenClaw assistant.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: [`src/integration/openclaw/manager.mjs`](src/integration/openclaw/manager.mjs)

### `src/execution/handlers/persona-handlers.mjs`
**Purpose**: Persona CRUD handlers (~5.4K chars). Implements `switch_persona`, `create_persona`, `list_personas`, `delete_persona`.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: [`src/core/persona-manager.mjs`](src/core/persona-manager.mjs)

### `src/execution/handlers/skill-handlers.mjs`
**Purpose**: Skill management handlers (~3K chars). Implements `list_skills`, `run_skill`, `install_skill`.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: [`src/skills/skills-manager.mjs`](src/skills/skills-manager.mjs)

### `src/execution/handlers/structured-dev-handlers.mjs`
**Purpose**: Structured development handlers (~7.5K chars). Implements `init_structured_dev`, `discover_features`, `define_interfaces`, `implement_feature`, `run_flow`, etc.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: [`src/structured-dev/flow-manager.mjs`](src/structured-dev/flow-manager.mjs), [`src/structured-dev/manifest-manager.mjs`](src/structured-dev/manifest-manager.mjs)

### `src/execution/handlers/surface-handlers.mjs`
**Purpose**: UI surface management handlers (~14K chars). Implements `create_surface`, `add_surface_component`, `update_surface_component`, `delete_surface`, `list_surfaces`, etc.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: [`src/surfaces/surface-manager.mjs`](src/surfaces/surface-manager.mjs)

### `src/execution/handlers/ui-style-handlers.mjs`
**Purpose**: Theme and CSS management handlers (~22K chars). Implements `set_ui_theme`, `set_ui_tokens`, `inject_css`, `reset_ui_style`, `get_ui_style_state`. Includes 10+ built-in themes.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: Nothing external (self-contained theme data)

### `src/execution/handlers/web-handlers.mjs`
**Purpose**: Web search handlers (~6.3K chars). Implements `search_web` and `search_news` using the Serper.dev API.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: Serper.dev API (via fetch)

### `src/execution/handlers/workflow-handlers.mjs`
**Purpose**: Todo/workflow management handlers (~9K chars). Implements `create_todo_list`, `update_todo_item`, `get_todo_list`, checkpoint/rollback, undo operations.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: [`src/workspace/workspace-manager.mjs`](src/workspace/workspace-manager.mjs)

### `src/execution/handlers/workflow-surface-handlers.mjs`
**Purpose**: BubbleLab workflow surface handlers (~3.8K chars). Implements `create_workflow_surface`, `start_workflow`, `submit_interaction` for workflow automations bound to surfaces.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: [`src/services/workflow-service.mjs`](src/services/workflow-service.mjs)

---

## 6. Tool Definitions (`src/tools/definitions/`)

Each file exports an array of OpenAI-compatible tool/function schemas. These are registered by `ToolExecutor`.

| File | Tools Defined | Handler |
|------|--------------|---------|
| `async-task-tools.mjs` | `spawn_background_task`, `check_task_status`, `list_background_tasks`, `cancel_background_task` | `async-task-handlers.mjs` |
| `browser-tools.mjs` | `browse_open`, `browse_click`, `browse_type`, `browse_screenshot`, `browse_close` | `browser-handlers.mjs` |
| `chrome-ext-tools.mjs` | `chrome_list_tabs`, `chrome_navigate`, `chrome_screenshot`, etc. | `chrome-ext-handlers.mjs` |
| `core-tools.mjs` | `execute_javascript`, `remember`, `recall`, `list_memories` | `core-handlers.mjs` |
| `custom-tool-management.mjs` | `list_custom_tools`, `get_custom_tool`, `delete_custom_tool` + `WORKSPACE_TOOLS` | `custom-tools-manager.mjs` |
| `desktop-tools.mjs` | `mouse_move`, `mouse_click`, `keyboard_type`, `take_screenshot`, etc. | `desktop-automation-tools.mjs` |
| `embed-tools.mjs` | `embed_object` | `embed-handlers.mjs` |
| `enhancement-tools.mjs` | `evaluate_response_quality` | `enhancement-generator.mjs` |
| `file-tools.mjs` | `read_file`, `write_file`, `list_directory`, `search_files`, etc. | `file-tools.mjs` |
| `firecrawl-tools.mjs` | `firecrawl_scrape`, `firecrawl_crawl`, `firecrawl_search` | `firecrawl-handlers.mjs` |
| `image-tools.mjs` | `generate_image`, `edit_image`, `analyze_image`, `composite_images`, `resize_image` | `image-handlers.mjs` |
| `math-tools.mjs` | `evaluate_math`, `solve_equation`, `plot_function` | `math-handlers.mjs` |
| `mcp-tools.mjs` | `mcp_add_server`, `mcp_remove_server`, `mcp_list_servers` | `mcp-handlers.mjs` |
| `openclaw-tools.mjs` | `delegate_to_openclaw` | `openclaw-handlers.mjs` |
| `persona-tools.mjs` | `switch_persona`, `create_persona`, `list_personas`, `delete_persona` | `persona-handlers.mjs` |
| `recursive-tools.mjs` | `call_ai_assistant` | `core-handlers.mjs` |
| `shell-tools.mjs` | `run_command` | `shell-tools.mjs` |
| `skill-tools.mjs` | `list_skills`, `run_skill`, `install_skill` | `skill-handlers.mjs` |
| `structured-dev-tools.mjs` | `init_structured_dev`, `discover_features`, `define_interfaces`, `implement_feature`, etc. | `structured-dev-handlers.mjs` |
| `surface-tools.mjs` | `create_surface`, `add_surface_component`, `update_surface_component`, `delete_surface`, etc. | `surface-handlers.mjs` |
| `tts-tools.mjs` | `speak_text` | `tool-executor.mjs` (inline) |
| `ui-style-tools.mjs` | `set_ui_theme`, `set_ui_tokens`, `inject_css`, `reset_ui_style`, `get_ui_style_state` | `ui-style-handlers.mjs` |
| `web-tools.mjs` | `search_web`, `search_news` | `web-handlers.mjs` |
| `workflow-surface-tools.mjs` | `create_workflow_surface`, `start_workflow`, `submit_interaction` | `workflow-surface-handlers.mjs` |
| `workflow-tools.mjs` | `create_todo_list`, `update_todo_item`, `get_todo_list`, etc. + `RECOVERY_TOOLS` | `workflow-handlers.mjs` |

### `src/tools/tool-definitions.mjs`
**Purpose**: Barrel re-export file. Re-exports tool definitions from individual definition files in `definitions/` subdirectory.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)

---

## 7. Tool Implementations (`src/tools/`)

### `src/tools/file-tools.mjs`
**Purpose**: Native file system tools (~14K chars). Provides safe file operations with path validation (prevents escaping workspace). Implements read, write, list, search, move, copy, delete operations.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs), [`src/structured-dev/api-doc-smith.mjs`](src/structured-dev/api-doc-smith.mjs), [`src/structured-dev/knowledge-graph-builder.mjs`](src/structured-dev/knowledge-graph-builder.mjs), various handlers  
**Depends on**: [`src/config.mjs`](src/config.mjs), [`src/ui/console-styler.mjs`](src/ui/console-styler.mjs)

### `src/tools/shell-tools.mjs`
**Purpose**: Shell command execution (~1.7K chars). Provides safe shell command execution with blocked command patterns (prevents `rm -rf /`, `sudo`, destructive disk operations).  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: Node.js `child_process`

### `src/tools/desktop-automation-tools.mjs`
**Purpose**: Desktop automation using `@nut-tree-fork/nut-js` (~5.9K chars). Provides keyboard and mouse control, screen capture and analysis, and window management.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: `@nut-tree-fork/nut-js` (npm)

---

## 8. Server & WebSocket (`src/server/`)

### `src/server/web-server.mjs`
**Purpose**: Main Express + WebSocket server (~36K chars). Serves the web UI, handles WebSocket connections with authentication, sets up all WS handler routes, and integrates with all backend services. Primary entry point for web/UI mode.  
**Used by**: [`src/main.mjs`](src/main.mjs)  
**Depends on**: `express`, `ws`, [`src/server/ws-dispatcher.mjs`](src/server/ws-dispatcher.mjs), [`src/server/ws-helpers.mjs`](src/server/ws-helpers.mjs), [`src/server/chrome-ws-bridge.mjs`](src/server/chrome-ws-bridge.mjs), [`src/server/dynamic-router.mjs`](src/server/dynamic-router.mjs), all ws-handler files

### `src/server/server.mjs`
**Purpose**: Lightweight Express REST server (~2.9K chars). Provides a simpler HTTP API for library mode (non-WebSocket). Exposes `/chat` and `/status` endpoints.  
**Used by**: [`src/lib/index.mjs`](src/lib/index.mjs) (optional)  
**Depends on**: `express`

### `src/server/ws-dispatcher.mjs`
**Purpose**: WebSocket message type → handler routing (~1.7K chars). Maps incoming WebSocket message types (e.g., "chat", "get-settings") to registered handler functions.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs)  
**Depends on**: Nothing external

### `src/server/ws-helpers.mjs`
**Purpose**: WebSocket helper utilities (~15K chars). Converts internal history format to UI message format, generates directory tree structures, processes content for UI display, and parses Jest JSON output.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs), multiple ws-handler files  
**Depends on**: Node.js `fs`, `path`

### `src/server/chrome-ws-bridge.mjs`
**Purpose**: Chrome extension WebSocket bridge (~1.9K chars). Manages the WebSocket connection to the Chrome extension for browser automation commands.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs), [`src/execution/handlers/chrome-ext-handlers.mjs`](src/execution/handlers/chrome-ext-handlers.mjs)  
**Depends on**: Nothing external

### `src/server/dynamic-router.mjs`
**Purpose**: Dynamic route loading (~5K chars). Loads Express routes from JavaScript files in the workspace's `.ai-man/routes/` directory, enabling user-defined API endpoints.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs)  
**Depends on**: Node.js dynamic `import()`

### `src/server/llm-error-detector.mjs`
**Purpose**: LLM authentication/API key error detection (~3.7K chars). Detects when AI provider errors are caused by missing or invalid API keys and builds user-friendly error payloads.  
**Used by**: [`src/server/ws-handlers/chat-handler.mjs`](src/server/ws-handlers/chat-handler.mjs)  
**Depends on**: Nothing external

### `src/server/mcp-server.mjs`
**Purpose**: MCP server implementation (~2K chars). Exposes Oboto itself as an MCP tool provider, allowing other MCP clients to use Oboto's capabilities.  
**Used by**: [`src/main.mjs`](src/main.mjs) (optional)  
**Depends on**: `@modelcontextprotocol/sdk` (npm)

### `src/server/secrets-manager.mjs`
**Purpose**: Encrypted secrets storage (~12.7K chars). Stores API keys and credentials using AES-256-GCM encryption. Persists to `.ai-man/secrets.enc`. Supports list, get, set, delete operations.  
**Used by**: [`src/main.mjs`](src/main.mjs), [`src/cloud/cloud-auth.mjs`](src/cloud/cloud-auth.mjs), [`src/server/ws-handlers/secrets-handler.mjs`](src/server/ws-handlers/secrets-handler.mjs), [`src/server/ws-handlers/settings-handler.mjs`](src/server/ws-handlers/settings-handler.mjs)  
**Depends on**: Node.js `crypto`

### `src/server/server-status-adapter.mjs`
**Purpose**: Server status adapter (~1K chars). Status callback adapter that forwards status events to the `AiManEventBus`.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs)  
**Depends on**: [`src/lib/event-bus.mjs`](src/lib/event-bus.mjs)

### `src/server/workspace-content-server.mjs`
**Purpose**: Workspace file serving (~15K chars). Express middleware that serves files from the workspace directory, handles file uploads, and provides project metadata endpoints.  
**Used by**: [`src/main.mjs`](src/main.mjs), [`src/server/web-server.mjs`](src/server/web-server.mjs)  
**Depends on**: `express`, Node.js `fs`

---

## 9. WebSocket Handlers (`src/server/ws-handlers/`)

All handlers follow the pattern: `async function handleXxx(data, ctx)` where `ctx` includes `ws`, `assistant`, `broadcast`, and other service references.

### `src/server/ws-handlers/agent-loop-handler.mjs`
**Purpose**: Agent loop control. Handles `agent-loop-play`, `agent-loop-pause`, `agent-loop-stop`, `agent-loop-set-interval`, `get-agent-loop-state`, `agent-loop-answer`.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs) via ws-dispatcher  
**Depends on**: [`src/core/agent-loop-controller.mjs`](src/core/agent-loop-controller.mjs)

### `src/server/ws-handlers/chat-handler.mjs`
**Purpose**: Main chat message handling (~10K chars). Handles `chat` and `interrupt` messages. Streams AI responses back via WebSocket, processes tool calls, and handles LLM errors gracefully.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs) via ws-dispatcher  
**Depends on**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs), [`src/server/ws-helpers.mjs`](src/server/ws-helpers.mjs), [`src/server/llm-error-detector.mjs`](src/server/llm-error-detector.mjs)

### `src/server/ws-handlers/cloud-handler.mjs`
**Purpose**: Cloud and WebLLM handlers (~16K chars). Handles all `cloud:*` message types (auth, sync, workspace, files, realtime, agents) and `webllm:response`.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs) via ws-dispatcher  
**Depends on**: [`src/cloud/cloud-sync.mjs`](src/cloud/cloud-sync.mjs)

### `src/server/ws-handlers/conversation-handler.mjs`
**Purpose**: Conversation CRUD (~5K chars). Handles `list-conversations`, `create-conversation`, `switch-conversation`, `delete-conversation`.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs) via ws-dispatcher  
**Depends on**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs)

### `src/server/ws-handlers/file-handler.mjs`
**Purpose**: File operations (~7.3K chars). Handles `get-files`, `read-file`, `save-file`, `delete-file`, `copy-file`, `upload-file`, `create-dir`, `list-dirs`.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs) via ws-dispatcher  
**Depends on**: Node.js `fs`, [`src/server/ws-helpers.mjs`](src/server/ws-helpers.mjs)

### `src/server/ws-handlers/misc-handler.mjs`
**Purpose**: Miscellaneous handlers (~5K chars). Handles `get-history`, `delete-message`, `run-tests`, `code-completion-request`, `tool-confirmation-response`.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs) via ws-dispatcher  
**Depends on**: [`src/core/history-manager.mjs`](src/core/history-manager.mjs)

### `src/server/ws-handlers/openclaw-handler.mjs`
**Purpose**: OpenClaw management (~8.6K chars). Handles `openclaw-status`, `openclaw-config`, `openclaw-deploy`, `openclaw-check-prereqs`, `openclaw-install`.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs) via ws-dispatcher  
**Depends on**: [`src/integration/openclaw/manager.mjs`](src/integration/openclaw/manager.mjs)

### `src/server/ws-handlers/secrets-handler.mjs`
**Purpose**: Secret management (~3K chars). Handles `get-secrets`, `set-secret`, `delete-secret`.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs) via ws-dispatcher  
**Depends on**: [`src/server/secrets-manager.mjs`](src/server/secrets-manager.mjs)

### `src/server/ws-handlers/settings-handler.mjs`
**Purpose**: Settings management (~17K chars). Handles `get-settings`, `update-settings`, `get-status`, `set-cwd`, `refresh-models`. Includes AI settings persistence and model registry integration.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs) via ws-dispatcher  
**Depends on**: [`src/config.mjs`](src/config.mjs), [`src/core/model-registry.mjs`](src/core/model-registry.mjs), [`src/server/secrets-manager.mjs`](src/server/secrets-manager.mjs)

### `src/server/ws-handlers/setup-handler.mjs`
**Purpose**: First-run setup wizard (~7.5K chars). Handles `get-setup-status`, `save-setup`, `reset-setup`. Manages initial configuration flow.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs) via ws-dispatcher  
**Depends on**: Node.js `fs`

### `src/server/ws-handlers/skills-handler.mjs`
**Purpose**: Skills management (~5.3K chars). Handles `get-skills`, `search-clawhub`, `install-clawhub-skill`, `install-npm-skill`, `uninstall-skill`.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs) via ws-dispatcher  
**Depends on**: [`src/skills/skills-manager.mjs`](src/skills/skills-manager.mjs)

### `src/server/ws-handlers/style-handler.mjs`
**Purpose**: UI style commands (~1.8K chars). Handles `set-ui-theme`, `set-ui-tokens`, `reset-ui-style`, `get-ui-style-state`.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs) via ws-dispatcher  
**Depends on**: [`src/execution/handlers/ui-style-handlers.mjs`](src/execution/handlers/ui-style-handlers.mjs)

### `src/server/ws-handlers/surface-handler.mjs`
**Purpose**: Surface management (~28K chars). Handles all surface-related message types: `get-surfaces`, `create-surface`, `update-surface`, `delete-surface`, `pin-surface`, `rename-surface`, `duplicate-surface`, `surface-agent-request`, `surface-compilation-error`, `screenshot-captured`, and more.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs) via ws-dispatcher  
**Depends on**: [`src/surfaces/surface-manager.mjs`](src/surfaces/surface-manager.mjs), [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs)

### `src/server/ws-handlers/task-handler.mjs`
**Purpose**: Task and schedule management (~2.9K chars). Handles `get-tasks`, `get-task-output`, `cancel-task`, `get-schedules`, `pause-schedule`, `resume-schedule`, `delete-schedule`, `trigger-schedule`.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs) via ws-dispatcher  
**Depends on**: [`src/core/task-manager.mjs`](src/core/task-manager.mjs), [`src/core/scheduler-service.mjs`](src/core/scheduler-service.mjs)

### `src/server/ws-handlers/workflow-handler.mjs`
**Purpose**: Workflow management (~3.8K chars). Handles `start-workflow`, `submit-interaction`, `cancel-workflow`, `get-workflow-status`, `list-workflows`.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs) via ws-dispatcher  
**Depends on**: [`src/services/workflow-service.mjs`](src/services/workflow-service.mjs)

### `src/server/ws-handlers/workspace-handler.mjs`
**Purpose**: Workspace management (~5.7K chars). Handles `workspace:switch`, `workspace:status`, `service:status`. Manages switching the server to a new workspace directory and reporting service health.  
**Used by**: [`src/server/web-server.mjs`](src/server/web-server.mjs) via ws-dispatcher  
**Depends on**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs)

---

## 10. Library / NPM Package (`src/lib/`)

### `src/lib/index.mjs`
**Purpose**: Main npm package entry point (~15K chars). Exports `AiMan` and `Oboto` classes (wrappers around `EventicFacade`), plus all adapters, middleware, workflows, event bus, and utility classes. This is what consumers get when they `import '@sschepis/oboto'`.  
**Used by**: External npm consumers
**Depends on**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs), [`src/lib/event-bus.mjs`](src/lib/event-bus.mjs), [`src/lib/middleware.mjs`](src/lib/middleware.mjs), [`src/lib/workflows.mjs`](src/lib/workflows.mjs), [`src/lib/adapters/index.mjs`](src/lib/adapters/index.mjs), [`src/lib/cancellation-error.mjs`](src/lib/cancellation-error.mjs), [`src/lib/design-result.mjs`](src/lib/design-result.mjs), [`src/config.mjs`](src/config.mjs)

### `src/lib/event-bus.mjs`
**Purpose**: `AiManEventBus` extending Node.js `EventEmitter`. Provides typed event emission across the system.  
**Used by**: [`src/lib/index.mjs`](src/lib/index.mjs), [`src/server/server-status-adapter.mjs`](src/server/server-status-adapter.mjs), [`src/core/scheduler-service.mjs`](src/core/scheduler-service.mjs)  
**Depends on**: Node.js `events`

### `src/lib/middleware.mjs`
**Purpose**: `MiddlewareChain` for phase-based middleware execution. Allows registering middleware functions for lifecycle phases.  
**Used by**: [`src/lib/index.mjs`](src/lib/index.mjs)  
**Depends on**: Nothing external

### `src/lib/workflows.mjs`
**Purpose**: Pre-built workflow functions (~6.6K chars). Provides `designWorkflow`, `implementWorkflow`, `testWorkflow`, `reviewWorkflow` for common development tasks.  
**Used by**: [`src/lib/index.mjs`](src/lib/index.mjs)  
**Depends on**: [`src/lib/design-result.mjs`](src/lib/design-result.mjs)

### `src/lib/cancellation-error.mjs`
**Purpose**: Custom `CancellationError` class for `AbortSignal` cancellation handling.  
**Used by**: [`src/lib/index.mjs`](src/lib/index.mjs), [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs)  
**Depends on**: Nothing external

### `src/lib/design-result.mjs`
**Purpose**: `DesignResult` container class for design phase outputs.  
**Used by**: [`src/lib/workflows.mjs`](src/lib/workflows.mjs), [`src/lib/index.mjs`](src/lib/index.mjs)  
**Depends on**: Nothing external

### `src/lib/interfaces.d.ts`
**Purpose**: TypeScript type declarations (~14K chars). Defines interfaces for `AiManConfig`, `AiManInstance`, `StatusAdapter`, `MemoryAdapter`, `LLMAdapter`, and all other public API types.  
**Used by**: TypeScript consumers of the npm package  
**Depends on**: Nothing (type declarations only)

### `src/lib/README.md`
**Purpose**: Documentation for the library API (~7.3K chars). Usage examples and API reference.  
**Used by**: Documentation only  

### `src/lib/adapters/index.mjs`
**Purpose**: Barrel export for all adapters.  
**Used by**: [`src/lib/index.mjs`](src/lib/index.mjs)  
**Depends on**: [`src/lib/adapters/console-status-adapter.mjs`](src/lib/adapters/console-status-adapter.mjs), [`src/lib/adapters/memory-adapter.mjs`](src/lib/adapters/memory-adapter.mjs), [`src/lib/adapters/network-llm-adapter.mjs`](src/lib/adapters/network-llm-adapter.mjs)

### `src/lib/adapters/console-status-adapter.mjs`
**Purpose**: Status adapter that outputs to console. Implements `StatusAdapter` interface for CLI environments.  
**Used by**: [`src/lib/adapters/index.mjs`](src/lib/adapters/index.mjs)  
**Depends on**: Nothing external

### `src/lib/adapters/memory-adapter.mjs`
**Purpose**: In-memory storage adapter. Implements `MemoryAdapter` for non-persistent storage.  
**Used by**: [`src/lib/adapters/index.mjs`](src/lib/adapters/index.mjs)  
**Depends on**: Nothing external

### `src/lib/adapters/network-llm-adapter.mjs`
**Purpose**: Network LLM adapter. Implements `LLMAdapter` for connecting to remote LLM services.  
**Used by**: [`src/lib/adapters/index.mjs`](src/lib/adapters/index.mjs)  
**Depends on**: Nothing external

---

## 11. Integration — OpenClaw (`src/integration/openclaw/`)

### `src/integration/openclaw/client.mjs`
**Purpose**: OpenClaw WebSocket client (~13K chars). Manages WebSocket connection with device identity, end-to-end encryption, message queuing, and reconnection logic.  
**Used by**: [`src/integration/openclaw/manager.mjs`](src/integration/openclaw/manager.mjs)  
**Depends on**: `ws` (npm), Node.js `crypto`

### `src/integration/openclaw/manager.mjs`
**Purpose**: OpenClaw lifecycle manager (~19.5K chars). Handles configuration, process management (installing/starting/stopping OpenClaw), and client connection orchestration. Provides high-level API for OpenClaw interaction.  
**Used by**: [`src/main.mjs`](src/main.mjs), [`src/execution/handlers/openclaw-handlers.mjs`](src/execution/handlers/openclaw-handlers.mjs), [`src/server/ws-handlers/openclaw-handler.mjs`](src/server/ws-handlers/openclaw-handler.mjs)  
**Depends on**: [`src/integration/openclaw/client.mjs`](src/integration/openclaw/client.mjs)

### `src/integration/openclaw/DESIGN.md`
**Purpose**: Design document for OpenClaw integration (~4K chars).  
**Used by**: Documentation only

---

## 12. Project Management (`src/project-management/`)

### `src/project-management/index.mjs`
**Purpose**: Module entry point and barrel exports (~7K chars). Exports all project management classes and constants.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: All files in this directory

### `src/project-management/project-manifest.mjs`
**Purpose**: `ProjectManifest` manager (~19K chars). Handles creation, reading, and updating of `PROJECT_MAP.md` files. Generalized version of `ManifestManager` for any project type.  
**Used by**: [`src/project-management/index.mjs`](src/project-management/index.mjs), [`src/project-management/phase-controller.mjs`](src/project-management/phase-controller.mjs)  
**Depends on**: Node.js `fs`

### `src/project-management/phase-controller.mjs`
**Purpose**: Phase transition controller (~18K chars). Validates and enforces project lifecycle flow (Discovery → Design → Implementation → Testing → Deployment). Includes validation hooks.  
**Used by**: [`src/project-management/index.mjs`](src/project-management/index.mjs)  
**Depends on**: [`src/project-management/project-manifest.mjs`](src/project-management/project-manifest.mjs)

### `src/project-management/project-bootstrapper.mjs`
**Purpose**: Project bootstrapper (~18K chars). Discovers existing project documentation and bootstraps `PROJECT_MAP.md` with extracted features and constraints.  
**Used by**: [`src/project-management/index.mjs`](src/project-management/index.mjs)  
**Depends on**: [`src/project-management/project-manifest.mjs`](src/project-management/project-manifest.mjs)

### `src/project-management/surface-generator.mjs`
**Purpose**: Project dashboard surface generator (~23K chars). Creates dynamic UI surfaces for project dashboards and visualization. Generates React components for project status displays.  
**Used by**: [`src/project-management/index.mjs`](src/project-management/index.mjs)  
**Depends on**: [`src/project-management/project-manifest.mjs`](src/project-management/project-manifest.mjs)

### `src/project-management/task-scheduler.mjs`
**Purpose**: Task breakdown and scheduling (~19K chars). Handles dependency resolution using topological sorting, generates parallel execution plans.  
**Used by**: [`src/project-management/index.mjs`](src/project-management/index.mjs)  
**Depends on**: [`src/project-management/project-manifest.mjs`](src/project-management/project-manifest.mjs)

### `src/project-management/template-registry.mjs`
**Purpose**: Pre-defined project templates (~21K chars). Provides templates for different project types (web app, API, library, etc.) with default phases, deliverables, tasks, and constraints.  
**Used by**: [`src/project-management/index.mjs`](src/project-management/index.mjs)  
**Depends on**: [`src/project-management/project-manifest.mjs`](src/project-management/project-manifest.mjs)

---

## 13. Structured Development (`src/structured-dev/`)

### `src/structured-dev/flow-manager.mjs`
**Purpose**: Structured development flow manager (~15K chars). Enforces the Discovery → Interface → Implementation development loop. Validates transitions and coordinates with `ManifestManager`.  
**Used by**: [`src/execution/handlers/structured-dev-handlers.mjs`](src/execution/handlers/structured-dev-handlers.mjs)  
**Depends on**: [`src/structured-dev/manifest-manager.mjs`](src/structured-dev/manifest-manager.mjs), [`src/structured-dev/project-bootstrapper.mjs`](src/structured-dev/project-bootstrapper.mjs)

### `src/structured-dev/manifest-manager.mjs`
**Purpose**: `SYSTEM_MAP.md` manifest manager (~15.5K chars). Handles creation, reading, and updating of the living manifest file for structured development processes.  
**Used by**: [`src/structured-dev/flow-manager.mjs`](src/structured-dev/flow-manager.mjs), [`src/structured-dev/c4-visualizer.mjs`](src/structured-dev/c4-visualizer.mjs), [`src/structured-dev/implementation-planner.mjs`](src/structured-dev/implementation-planner.mjs)  
**Depends on**: [`src/ui/console-styler.mjs`](src/ui/console-styler.mjs)

### `src/structured-dev/project-bootstrapper.mjs`
**Purpose**: Project bootstrapper for structured dev (~19.5K chars). Discovers design documents (DESIGN.md, ARCHITECTURE.md, README.md) and pre-populates `SYSTEM_MAP.md`.  
**Used by**: [`src/structured-dev/flow-manager.mjs`](src/structured-dev/flow-manager.mjs)  
**Depends on**: [`src/ui/console-styler.mjs`](src/ui/console-styler.mjs)

### `src/structured-dev/implementation-planner.mjs`
**Purpose**: Implementation planner (~8.6K chars). Analyzes the System Map to generate parallel execution plans for multi-agent implementation.  
**Used by**: [`src/structured-dev/flow-manager.mjs`](src/structured-dev/flow-manager.mjs)  
**Depends on**: [`src/structured-dev/manifest-manager.mjs`](src/structured-dev/manifest-manager.mjs)

### `src/structured-dev/plan-executor.mjs`
**Purpose**: Plan executor (~4.1K chars). Orchestrates concurrent execution of multi-agent implementation plans.  
**Used by**: [`src/structured-dev/flow-manager.mjs`](src/structured-dev/flow-manager.mjs)  
**Depends on**: [`src/structured-dev/manifest-manager.mjs`](src/structured-dev/manifest-manager.mjs), [`src/ui/console-styler.mjs`](src/ui/console-styler.mjs)

### `src/structured-dev/c4-visualizer.mjs`
**Purpose**: C4 Architecture diagram generator (~5.7K chars). Generates C4 diagrams using Mermaid.js syntax from the System Map.  
**Used by**: [`src/structured-dev/flow-manager.mjs`](src/structured-dev/flow-manager.mjs)  
**Depends on**: [`src/structured-dev/manifest-manager.mjs`](src/structured-dev/manifest-manager.mjs)

### `src/structured-dev/api-doc-smith.mjs`
**Purpose**: API documentation generator (~2.8K chars). Generates API docs from source code.  
**Used by**: [`src/structured-dev/flow-manager.mjs`](src/structured-dev/flow-manager.mjs)  
**Depends on**: [`src/tools/file-tools.mjs`](src/tools/file-tools.mjs)

### `src/structured-dev/cicd-architect.mjs`
**Purpose**: CI/CD pipeline configuration generator (~4.6K chars). Generates CI/CD configs based on project analysis.  
**Used by**: [`src/structured-dev/flow-manager.mjs`](src/structured-dev/flow-manager.mjs)  
**Depends on**: [`src/tools/file-tools.mjs`](src/tools/file-tools.mjs)

### `src/structured-dev/containerization-wizard.mjs`
**Purpose**: Docker configuration generator (~2.9K chars). Generates Dockerfiles and docker-compose configurations.  
**Used by**: [`src/structured-dev/flow-manager.mjs`](src/structured-dev/flow-manager.mjs)  
**Depends on**: [`src/tools/file-tools.mjs`](src/tools/file-tools.mjs)

### `src/structured-dev/enhancement-generator.mjs`
**Purpose**: Enhancement suggestion generator (~7K chars). Analyzes codebase and generates improvement suggestions using AI.  
**Used by**: [`src/structured-dev/flow-manager.mjs`](src/structured-dev/flow-manager.mjs)  
**Depends on**: [`src/structured-dev/knowledge-graph-builder.mjs`](src/structured-dev/knowledge-graph-builder.mjs), [`src/tools/file-tools.mjs`](src/tools/file-tools.mjs)

### `src/structured-dev/knowledge-graph-builder.mjs`
**Purpose**: Codebase knowledge graph builder (~4.2K chars). Maps files, classes, and dependencies in the workspace.  
**Used by**: [`src/structured-dev/enhancement-generator.mjs`](src/structured-dev/enhancement-generator.mjs)  
**Depends on**: [`src/tools/file-tools.mjs`](src/tools/file-tools.mjs)

### `src/structured-dev/tutorial-generator.mjs`
**Purpose**: Tutorial generator (~2.2K chars). Generates tutorials from session history.  
**Used by**: [`src/structured-dev/flow-manager.mjs`](src/structured-dev/flow-manager.mjs)  
**Depends on**: [`src/tools/file-tools.mjs`](src/tools/file-tools.mjs)

---

## 14. Services (`src/services/`)

### `src/services/workflow-service.mjs`
**Purpose**: `WorkflowService` for BubbleLab workflow lifecycle management (~10K chars). Manages starting, tracking, pausing/resuming workflows, and handling user interactions when SurfaceBubble needs input.  
**Used by**: [`src/execution/handlers/workflow-surface-handlers.mjs`](src/execution/handlers/workflow-surface-handlers.mjs), [`src/server/ws-handlers/workflow-handler.mjs`](src/server/ws-handlers/workflow-handler.mjs)  
**Depends on**: `uuid` (npm)

---

## 15. Skills (`src/skills/`)

### `src/skills/skills-manager.mjs`
**Purpose**: `SkillsManager` for loading and managing AI skills (~18K chars). Discovers skills from workspace `skills/` directories, loads SKILL.md manifests, executes skill prompts, and manages skill installation from npm or ClawHub.  
**Used by**: [`src/execution/handlers/skill-handlers.mjs`](src/execution/handlers/skill-handlers.mjs), [`src/server/ws-handlers/skills-handler.mjs`](src/server/ws-handlers/skills-handler.mjs), [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: Node.js `fs`, `child_process`

---

## 16. Surfaces (`src/surfaces/`)

### `src/surfaces/surface-manager.mjs`
**Purpose**: `SurfaceManager` for dynamic UI page persistence (~15K chars). Handles creation, reading, updating, and deletion of Surface metadata and component source code. Surfaces are stored in `.surfaces/` directory in the workspace.  
**Used by**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs), [`src/execution/handlers/surface-handlers.mjs`](src/execution/handlers/surface-handlers.mjs), [`src/server/ws-handlers/surface-handler.mjs`](src/server/ws-handlers/surface-handler.mjs)  
**Depends on**: `uuid` (npm), Node.js `fs`

---

## 17. Reasoning & Consciousness

### `src/reasoning/fact-inference-engine.mjs`
**Purpose**: Fact storage and inference engine (~15K chars). Stores facts, applies inference rules, and builds derivation chains using `@aleph-ai/tinyaleph` resonance primitives for semantic matching.  
**Used by**: [`src/core/consciousness-processor.mjs`](src/core/consciousness-processor.mjs)  
**Depends on**: `@aleph-ai/tinyaleph` (npm)

### `src/reasoning/semantic-collapse.mjs`
**Purpose**: Semantic collapse engine (~14K chars). Maintains probability-weighted superpositions of interpretations, collapses them when evidence accumulates, and supports quantum-inspired semantic reasoning.  
**Used by**: [`src/core/consciousness-processor.mjs`](src/core/consciousness-processor.mjs)  
**Depends on**: `@aleph-ai/tinyaleph` (npm)

---

## 18. Quality (`src/quality/`)

### `src/quality/code-validator.mjs`
**Purpose**: Real-time code validation (~4.8K chars). Performs linting and type-checking on generated code to catch errors before delivery.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs) (optional quality gate)  
**Depends on**: Node.js `child_process`

---

## 19. Workspace (`src/workspace/`)

### `src/workspace/workspace-manager.mjs`
**Purpose**: Persistent workspace data manager (~7.2K chars). Stores and retrieves workspace-scoped data for multi-step tasks (todo lists, progress state, workspace metadata). Data persisted to `.ai-man/workspace.json`.  
**Used by**: [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs), [`src/core/agent-loop-controller.mjs`](src/core/agent-loop-controller.mjs), [`src/execution/handlers/workflow-handlers.mjs`](src/execution/handlers/workflow-handlers.mjs)  
**Depends on**: Node.js `fs`

---

## 20. Package Manager (`src/package/`)

### `src/package/package-manager.mjs`
**Purpose**: npm package installation manager (~10K chars). Installs npm packages with Node.js version compatibility checks. Handles `require()` in ESM context and caches installed packages.  
**Used by**: [`src/execution/handlers/core-handlers.mjs`](src/execution/handlers/core-handlers.mjs) (for `execute_javascript` tool)  
**Depends on**: Node.js `child_process`

---

## 21. Custom Tools (`src/custom-tools/`)

### `src/custom-tools/custom-tools-manager.mjs`
**Purpose**: Custom tool loading/saving/validation (~12K chars). Manages user-created tools stored in `.tools.json` files. Supports creating tools from JavaScript code, validating tool schemas, and registering them with the tool executor.  
**Used by**: [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs)  
**Depends on**: Node.js `fs`

---

## 22. UI — Console (`src/ui/`)

### `src/ui/console-styler.mjs`
**Purpose**: Enhanced console styling system (~17K chars). Provides modern, themed terminal output with gradients, icons, animations, boxen panels, and ora spinners. Uses chalk, gradient-string, boxen, ora, and figures.  
**Used by**: Nearly every module for CLI output — [`src/cli/cli-interface.mjs`](src/cli/cli-interface.mjs), [`src/core/status-reporter.mjs`](src/core/status-reporter.mjs), [`src/structured-dev/`](src/structured-dev/) modules, [`src/server/ws-handlers/`](src/server/ws-handlers/) modules, and many more  
**Depends on**: `chalk`, `gradient-string`, `boxen`, `ora`, `figures` (npm)

---

## 23. UI — Generative (`src/ui/generative/`)

TypeScript/React components for dynamically rendering UI from AI-generated manifests.

### `src/ui/generative/types.ts`
**Purpose**: TypeScript type definitions for generative UI. Defines `UiManifest`, `ComponentDefinition`, `IComponentRegistry` interfaces.  
**Used by**: All other files in this directory  
**Depends on**: Nothing external

### `src/ui/generative/componentRegistry.ts`
**Purpose**: `ComponentRegistry` for managing dynamically registered React components.  
**Used by**: [`src/ui/generative/uiRenderer.tsx`](src/ui/generative/uiRenderer.tsx)  
**Depends on**: `react`

### `src/ui/generative/errorBoundary.tsx`
**Purpose**: React `ErrorBoundary` component for catching rendering errors in dynamic components.  
**Used by**: [`src/ui/generative/uiRenderer.tsx`](src/ui/generative/uiRenderer.tsx)  
**Depends on**: `react`

### `src/ui/generative/manifestWatcher.ts`
**Purpose**: `ManifestWatcher` using chokidar to watch for changes in UI manifest files. Debounces updates and notifies subscribers.  
**Used by**: Application code that needs live UI updates  
**Depends on**: `chokidar` (npm)

### `src/ui/generative/uiRenderer.tsx`
**Purpose**: `UiRenderer` React component. Renders a `UiManifest` into actual React components using the component registry.  
**Used by**: Frontend application  
**Depends on**: [`src/ui/generative/componentRegistry.ts`](src/ui/generative/componentRegistry.ts), [`src/ui/generative/errorBoundary.tsx`](src/ui/generative/errorBoundary.tsx), [`src/ui/generative/types.ts`](src/ui/generative/types.ts)

---

## 24. Shared Utilities (`src/lib/` — new)

### `src/lib/markdown-utils.mjs`
**Purpose**: Shared markdown parsing/building utilities. Provides `parseMarkdownTable()`, `buildMarkdownTable()`, `extractColumns()`, `parseMarkdownSections()`, `extractBullets()`.  
**Used by**: [`src/lib/base-manifest.mjs`](src/lib/base-manifest.mjs), [`src/lib/base-bootstrapper.mjs`](src/lib/base-bootstrapper.mjs), [`src/structured-dev/manifest-manager.mjs`](src/structured-dev/manifest-manager.mjs)  
**Depends on**: Nothing external

### `src/lib/id-utils.mjs`
**Purpose**: Shared ID generation utilities. Provides `generateId(prefix)`, `generateSimpleId(tag)`, `generateTempSuffix()`.  
**Used by**: [`src/lib/base-manifest.mjs`](src/lib/base-manifest.mjs)  
**Depends on**: Nothing external

### `src/lib/scheduling-utils.mjs`
**Purpose**: Generic topological sort with parallel staging. Provides `topologicalSchedule(items, options)`.  
**Used by**: [`src/structured-dev/implementation-planner.mjs`](src/structured-dev/implementation-planner.mjs), [`src/project-management/task-scheduler.mjs`](src/project-management/task-scheduler.mjs)  
**Depends on**: Nothing external

### `src/lib/ws-utils.mjs`
**Purpose**: WebSocket message send helpers and handler utilities. Provides `wsSend(ws, type, payload)`, `wsSendError(ws, message, errorType)`, `requireService(ctx, path, label)` (dotted-path service resolver with auto-error), and `wsHandler(fn, options)` (higher-order function wrapping handlers with try/catch and optional service guard via `{ require: 'dotted.path' }`).
**Used by**: All 16 WebSocket handler files in [`src/server/ws-handlers/`](src/server/ws-handlers/)
**Depends on**: [`src/ui/console-styler.mjs`](src/ui/console-styler.mjs)

### `src/lib/json-file-utils.mjs`
**Purpose**: Safe JSON file read/write helpers with fallback support. Provides `readJsonFileSync(path, fallback)`, `readJsonFile(path, fallback)`, `writeJsonFileSync(path, data, indent)`, `writeJsonFile(path, data, indent)`.
**Used by**: [`src/custom-tools/custom-tools-manager.mjs`](src/custom-tools/custom-tools-manager.mjs), [`src/server/ws-handlers/settings-handler.mjs`](src/server/ws-handlers/settings-handler.mjs), [`src/core/mcp-client-manager.mjs`](src/core/mcp-client-manager.mjs), [`src/core/history-manager.mjs`](src/core/history-manager.mjs), [`src/workspace/workspace-manager.mjs`](src/workspace/workspace-manager.mjs), [`src/structured-dev/plan-executor.mjs`](src/structured-dev/plan-executor.mjs), [`src/ui/console-styler.mjs`](src/ui/console-styler.mjs), [`src/server/ws-handlers/setup-handler.mjs`](src/server/ws-handlers/setup-handler.mjs), [`src/server/ws-handlers/openclaw-handler.mjs`](src/server/ws-handlers/openclaw-handler.mjs)
**Depends on**: Node.js `fs`

### `src/lib/base-manifest.mjs`
**Purpose**: `BaseManifest` abstract base class for markdown-based manifest files. Provides shared `hasManifest()`, `readManifest()`, `writeManifest()`, `updateSection()`, `parseTableSection()`, `buildTable()`, `generateId()`, `createSnapshot()`, `listSnapshots()`, `restoreSnapshot()`.  
**Used by**: [`src/project-management/project-manifest.mjs`](src/project-management/project-manifest.mjs), [`src/structured-dev/manifest-manager.mjs`](src/structured-dev/manifest-manager.mjs)  
**Depends on**: [`src/lib/markdown-utils.mjs`](src/lib/markdown-utils.mjs), [`src/lib/id-utils.mjs`](src/lib/id-utils.mjs)

### `src/lib/base-bootstrapper.mjs`
**Purpose**: `BaseBootstrapper` abstract base class for document discovery and parsing. Provides shared `findDocFile()`, `parseDocument()`, `extractBullets()`, `extractInlineConstraints()`, `extractConstraintsFromBullets()`, `deduplicate()`.  
**Used by**: [`src/structured-dev/project-bootstrapper.mjs`](src/structured-dev/project-bootstrapper.mjs), [`src/project-management/project-bootstrapper.mjs`](src/project-management/project-bootstrapper.mjs)  
**Depends on**: [`src/lib/markdown-utils.mjs`](src/lib/markdown-utils.mjs)

> **Note**: Section 24 previously documented TypeScript stubs (`src/client/`, `src/service/`, `src/gateway/`, `src/types/nexus.d.ts`) that have been deleted as dead code.

---

## 25. Chrome Extension (`chrome-extension/`)

### `chrome-extension/manifest.json`
**Purpose**: Chrome extension manifest (Manifest V3). Declares "Oboto Chrome Controller" extension with permissions for tabs, scripting, debugger, etc.  
**Used by**: Chrome browser (extension loading)  
**Depends on**: Nothing external

### `chrome-extension/background.js`
**Purpose**: Service worker (~15K chars). Manages WebSocket connection to Oboto server, handles browser automation commands (tab management, navigation, screenshots, DOM inspection, JavaScript execution, network monitoring via CDP).  
**Used by**: Chrome extension runtime  
**Depends on**: Chrome extension APIs, WebSocket

### `chrome-extension/content.js`
**Purpose**: Content script (~8.7K chars). Injected into web pages for DOM interaction. Handles commands like `dom-query`, `dom-click`, `dom-fill`, `dom-extract`, `dom-screenshot`, `dom-scroll`.  
**Used by**: [`chrome-extension/background.js`](chrome-extension/background.js) (via `chrome.tabs.sendMessage`)  
**Depends on**: Chrome extension APIs

### `chrome-extension/README.md`
**Purpose**: Documentation for the Chrome extension.  
**Used by**: Documentation only

---

## 26. Frontend UI (`ui/src/`)

The frontend is a Vite + React + TypeScript application with TailwindCSS.

### Entry & Layout

| File | Purpose | Used by |
|------|---------|---------|
| `ui/src/main.tsx` | React app entry point, renders `<App />` | Vite build |
| `ui/src/App.tsx` | Main application component (~20K chars). Orchestrates all panels, tabs, sidebar, and hooks. | `main.tsx` |
| `ui/src/App.css` | Minimal app-level CSS | `App.tsx` |
| `ui/src/index.css` | Global styles (~24K chars, TailwindCSS + custom) | `main.tsx` |

### Layout Components (`ui/src/components/layout/`)

| File | Purpose |
|------|---------|
| `Header.tsx` | Top header bar with title, status, and controls |
| `Sidebar.tsx` | Left sidebar with navigation, conversations, surfaces |
| `TabBar.tsx` | Tab strip for switching between chat, surfaces, files, etc. |
| `StatusBar.tsx` | Bottom status bar with connection status, model info |
| `TaskSidebar.tsx` | Right sidebar for background task management |
| `FlexGrid/FlexGridContainer.tsx` | Flexible grid layout container for surfaces |
| `FlexGrid/types.ts` | FlexGrid type definitions |
| `FlexGrid/index.ts` | FlexGrid barrel export |

### Chat Components (`ui/src/components/chat/`)

| File | Purpose |
|------|---------|
| `MessageList.tsx` | Scrollable message list |
| `MessageItem.tsx` | Individual message rendering (user/assistant/system) |
| `InputArea.tsx` | Chat input with send button, file upload, voice |
| `MarkdownRenderer.tsx` | Markdown rendering with syntax highlighting |
| `ChartBlock.tsx` | Chart rendering within messages |
| `AgentActivityPanel.tsx` | Shows agent thinking/tool activity |

### Feature Components (`ui/src/components/features/`)

| File | Purpose |
|------|---------|
| `AgentLoopControls.tsx` | Play/pause/stop controls for agent loop |
| `AgentOrchestrator.tsx` | Multi-agent orchestration UI |
| `ApprovalBlock.tsx` | Tool confirmation dialog |
| `BackgroundSubstrate.tsx` | Animated background effects |
| `BrowserPreview.tsx` | Browser automation preview panel |
| `CloudPresenceBar.tsx` | Cloud presence/online users indicator |
| `CloudSyncIndicator.tsx` | Cloud sync status indicator |
| `CodeDiff.tsx` | Side-by-side code diff viewer |
| `ConfirmationDialog.tsx` | Generic confirmation dialog |
| `ConversationSwitcher.tsx` | Conversation list/switcher panel |
| `DecisionSurvey.tsx` | Decision survey UI for AI decisions |
| `DirectoryPicker.tsx` | Directory selection dialog |
| `EmbeddedObject.tsx` | Embedded media renderer (YouTube, etc.) |
| `FeatureDetailsDialog.tsx` | Feature details modal |
| `FileEditor.tsx` | In-browser file editor |
| `FileTree.tsx` | File tree browser |
| `GlobalPalette.tsx` | Command palette (Ctrl+K) |
| `GuakeTerminal.tsx` | Drop-down terminal (Guake-style) |
| `HtmlPreview.tsx` | HTML preview panel |
| `HtmlSandbox.tsx` | Sandboxed HTML renderer |
| `ImageViewer.tsx` | Image viewer/lightbox |
| `InteractiveTerminal.tsx` | Interactive terminal emulator |
| `KeyboardShortcutsHelp.tsx` | Keyboard shortcuts help overlay |
| `KnowledgeGraph.tsx` | Knowledge graph visualization |
| `LiveTelemetryGraph.tsx` | Real-time telemetry visualization |
| `LockScreen.tsx` | Lock screen overlay |
| `LogPanel.tsx` | Server log viewer |
| `NeuralVisualization.tsx` | Neural network visualization |
| `PdfViewer.tsx` | PDF file viewer |
| `ProgressOverlay.tsx` | Progress indicator overlay |
| `ProjectStatus.tsx` | Project status dashboard |
| `ScreenshotManager.tsx` | Screenshot capture/management |
| `SearchSubstrate.tsx` | Search UI overlay |
| `SecretVaultBlock.tsx` | Secret vault inline block |
| `SecretsPanel.tsx` | Secrets management panel |
| `SettingsDialog.tsx` | Main settings dialog |
| `SurfaceAutoFixBlock.tsx` | Surface error auto-fix UI |
| `SurfaceContextMenu.tsx` | Right-click context menu for surfaces |
| `SurfaceRenderer.tsx` | Dynamic surface rendering component |
| `TaskManagerPanel.tsx` | Background task management panel |
| `TelemetryGraph.tsx` | Telemetry graph component |
| `TestResultsPanel.tsx` | Test results display |
| `ThinkingStream.tsx` | AI thinking indicator/stream |
| `ToolCall.tsx` | Tool call display component |
| `VoiceWaveform.tsx` | Voice input waveform visualization |
| `WorkflowStatusBar.tsx` | Workflow execution status bar |

### Settings Sub-components (`ui/src/components/features/settings/`)

| File | Purpose |
|------|---------|
| `AIProviderSettings.tsx` | AI provider configuration (API keys, models) |
| `CloudSettings.tsx` | Cloud sync settings |
| `ModelRoutingSettings.tsx` | Model routing configuration |
| `PropertyGrid.tsx` | Generic property grid component |
| `SkillsSettings.tsx` | Skills management settings |

### Setup Wizard (`ui/src/components/features/SetupWizard/`)

| File | Purpose |
|------|---------|
| `SetupWizard.tsx` | Main setup wizard component |
| `WelcomeStep.tsx` | Welcome/intro step |
| `ProviderStep.tsx` | AI provider selection |
| `ApiKeyStep.tsx` | API key entry |
| `WorkspaceStep.tsx` | Workspace directory selection |
| `CloudStep.tsx` | Cloud configuration |
| `OpenClawStep.tsx` | OpenClaw setup |
| `ReviewStep.tsx` | Configuration review |
| `index.ts` | Barrel export |

### Surface Components (`ui/src/components/features/surface/`)

| File | Purpose |
|------|---------|
| `ComponentWrapper.tsx` | Wrapper for dynamically compiled surface components |
| `SurfaceErrorBoundary.tsx` | Error boundary for surface rendering |
| `surfaceApi.ts` | Surface API utilities |
| `surfaceCompiler.ts` | Runtime JSX/TSX compiler for surface components |

### Hooks (`ui/src/hooks/`)

| File | Purpose |
|------|---------|
| `useAgentLoop.ts` | Agent loop state management |
| `useChat.ts` | Chat state and message handling |
| `useCloudSync.ts` | Cloud sync state management |
| `useDisplayNames.ts` | Display name resolution |
| `useGuakeTerminal.ts` | Guake terminal toggle/state |
| `useKeyboardShortcuts.ts` | Keyboard shortcut handling |
| `useMessageActions.ts` | Message action handlers (copy, delete, etc.) |
| `useSecrets.ts` | Secrets management state |
| `useSendHandler.ts` | Chat send handler logic |
| `useSetupWizard.ts` | Setup wizard state/flow |
| `useSkills.ts` | Skills state management |
| `useSpeechRecognition.ts` | Browser speech recognition |
| `useSurface.ts` | Surface state management |
| `useSurfaceLifecycle.ts` | Surface lifecycle hooks |
| `useTabManager.ts` | Tab state management |
| `useTaskManager.ts` | Background task state |
| `useTheme.ts` | Theme state management |
| `useUIState.ts` | General UI state |
| `useWebLLM.ts` | Browser-side WebLLM integration |
| `useWorkflow.ts` | Workflow state management |
| `useWorkspaceState.ts` | Workspace state management |

### Services (`ui/src/services/`)

| File | Purpose |
|------|---------|
| `wsService.ts` | WebSocket client service — manages connection to backend |
| `mockAgent.ts` | Mock agent for testing/development |

### Surface Kit (`ui/src/surface-kit/`)

Reusable UI component library available to AI-generated surfaces.

| Category | Components |
|----------|-----------|
| `primitives/` | `Button`, `Checkbox`, `Input`, `Label`, `Select`, `Slider`, `Switch`, `TextArea` |
| `layout/` | `Card`, `ScrollArea`, `Separator`, `Stack` |
| `data/` | `Avatar`, `Badge`, `Progress`, `Skeleton`, `Table` |
| `charts/` | `AreaChart`, `BarChart`, `LineChart`, `PieChart`, `Sparkline` |
| `navigation/` | `Accordion`, `Tabs` |
| `overlay/` | `Dialog`, `DropdownMenu`, `Popover`, `Tooltip` |
| `feedback/` | `Alert`, `Toast` |
| `icons.ts` | Icon utility exports |
| `index.ts` | Barrel export for all surface-kit components |

### Other UI Files

| File | Purpose |
|------|---------|
| `ui/src/types/index.ts` | Frontend TypeScript type definitions |
| `ui/src/utils/resolveBackendUrl.ts` | Backend URL resolution utility |
| `ui/src/constants/commands.tsx` | Command palette command definitions |

---

## 27. Test Files

| File | Purpose |
|------|---------|
| `src/core/__tests__/agent-loop-controller.test.mjs` | Tests for `AgentLoopController` |
| `src/core/__tests__/conversation-lock.test.ts` | Tests for `ConversationLock` |
| `src/core/__tests__/conversation-manager.test.mjs` | Tests for `ConversationManager` |
| `src/core/__tests__/history-manager.test.mjs` | Tests for `HistoryManager` |
| `src/core/__tests__/task-checkpoint-manager.test.mjs` | Tests for `TaskCheckpointManager` |
| `src/server/__tests__/setup-handler.test.mjs` | Tests for setup WS handler |
| `src/server/__tests__/ws-dispatcher.test.mjs` | Tests for WS dispatcher |

| `src/ui/generative/__tests__/manifestWatcher.test.ts` | Tests for ManifestWatcher |
| `src/ui/generative/__tests__/uiRenderer.test.tsx` | Tests for UiRenderer |

---

## 28. Top-Level Config & Scripts

| File | Purpose |
|------|---------|
| `package.json` | NPM manifest. Package `@sschepis/oboto`, bin → `ai.mjs`, main → `src/lib/index.mjs` |
| `.env.example` | Example environment variables |
| `.gitignore` | Git ignore rules |
| `.npmignore` | NPM publish ignore rules |
| `jest.config.cjs` | Jest test configuration |
| `jest.setup.cjs` | Jest setup file |
| `tsconfig.json` | TypeScript configuration |
| `pnpm-workspace.yaml` | PNPM workspace config (monorepo: root + `ui/`) |
| `themes.json` | UI theme definitions |
| `README.md` | Project README |
| `REFACTOR_DESIGN.md` | Eventic refactor design notes |
| `ui/package.json` | Frontend package manifest (Vite + React) |
| `ui/eslint.config.js` | Frontend ESLint config |
| `ui/index.html` | Frontend HTML entry point |
| `ui/tailwind.config.js` | TailwindCSS configuration |

---

## Dependency Graph Summary

```
ai.mjs → src/main.mjs
  ├── src/config.mjs (env vars)
  ├── src/core/eventic-facade.mjs (main assistant)
  │   ├── src/core/eventic.mjs (engine)
  │   ├── src/core/eventic-ai-plugin.mjs → src/core/ai-provider.mjs
  │   ├── src/core/eventic-agent-loop-plugin.mjs
  │   ├── src/core/eventic-state-plugin.mjs
  │   │   ├── src/core/history-manager.mjs
  │   │   ├── src/core/conversation-manager.mjs
  │   │   └── src/core/task-checkpoint-manager.mjs → src/core/checkpoint-store.mjs
  │   ├── src/core/eventic-tools-plugin.mjs
  │   ├── src/execution/tool-executor.mjs
  │   │   ├── src/tools/definitions/*.mjs (schemas)
  │   │   ├── src/execution/handlers/*.mjs (implementations)
  │   │   ├── src/tools/file-tools.mjs
  │   │   ├── src/tools/shell-tools.mjs
  │   │   └── src/tools/desktop-automation-tools.mjs
  │   ├── src/core/consciousness-processor.mjs
  │   │   ├── src/reasoning/fact-inference-engine.mjs
  │   │   ├── src/reasoning/semantic-collapse.mjs
  │   │   ├── src/core/somatic-engine.mjs
  │   │   ├── src/core/somatic-narrative.mjs
  │   │   └── src/core/archetype-analyzer.mjs
  │   ├── src/core/mcp-client-manager.mjs
  │   ├── src/core/prompt-router.mjs
  │   ├── src/core/persona-manager.mjs
  │   ├── src/core/resolang-service.mjs
  │   ├── src/core/system-prompt.mjs
  │   ├── src/surfaces/surface-manager.mjs
  │   └── src/workspace/workspace-manager.mjs
  ├── src/core/agent-loop-controller.mjs
  ├── src/core/task-manager.mjs
  ├── src/core/scheduler-service.mjs
  ├── src/server/secrets-manager.mjs
  ├── src/server/workspace-content-server.mjs
  ├── src/cloud/cloud-sync.mjs
  │   ├── src/cloud/cloud-auth.mjs
  │   ├── src/cloud/cloud-client.mjs
  │   ├── src/cloud/cloud-realtime.mjs
  │   └── src/cloud/cloud-*-sync.mjs
  ├── src/integration/openclaw/manager.mjs
  │   └── src/integration/openclaw/client.mjs
  ├── src/server/web-server.mjs (web mode)
  │   ├── src/server/ws-dispatcher.mjs
  │   ├── src/server/ws-helpers.mjs
  │   └── src/server/ws-handlers/*.mjs
  └── src/cli/cli-interface.mjs (CLI mode)

src/lib/index.mjs (npm package entry)
  ├── src/core/eventic-facade.mjs
  ├── src/lib/event-bus.mjs
  ├── src/lib/middleware.mjs
  ├── src/lib/workflows.mjs
  └── src/lib/adapters/*

ui/src/App.tsx (frontend)
  ├── ui/src/hooks/*.ts
  ├── ui/src/services/wsService.ts → WebSocket → src/server/web-server.mjs
  ├── ui/src/components/layout/*.tsx
  ├── ui/src/components/chat/*.tsx
  ├── ui/src/components/features/*.tsx
  └── ui/src/surface-kit/*.tsx
```
