# Multi-Agent Architecture

Oboto is not a single-threaded chatbot. It is a **multi-agent system** where the primary chat conversation acts as a command hub, background agents execute tasks autonomously, recurring schedules fire periodically, and named conversations serve as parallel workstreams—all sharing a unified workspace memory.

This document covers the four pillars of Oboto's multi-agent capability:

1. [**Multiple Conversations**](#1-multiple-conversations) — parallel named conversations per workspace
2. [**Background Tasks**](#2-background-tasks) — one-shot asynchronous agent invocations
3. [**Recurring Tasks**](#3-recurring-tasks) — scheduled periodic agent invocations
4. [**The Agent Loop**](#4-the-agent-loop) — an autonomous background heartbeat

---

## 1. Multiple Conversations

### Concept

Each workspace supports multiple named conversations. There is always a **default conversation** called `chat` that cannot be deleted. Additional conversations can be created and deleted freely.

Conversations are **not isolated silos**. They share:

- **Workspace state** (`WorkspaceManager`) — task goals, progress, next steps
- **Holographic memory** (`ResoLangService`) — the `.memory.json` knowledge base
- **Persona** — the active persona applies to all conversations
- **Consciousness state** — somatic engine, fact inference, archetype analysis
- **Tools** — the full tool registry is available in every conversation

Only the **conversation history** (`HistoryManager`) is per-conversation. Switching conversations swaps which history the assistant reads from and writes to; everything else persists.

### Parent-Child Model

The default `chat` conversation is the **parent**. All other conversations are **children** that behave like asynchronous agents reporting to a central command.

```
┌──────────────────────────────────────────┐
│           Workspace (shared)             │
│  ┌─────────────────────────────────────┐ │
│  │  Memory · Persona · Consciousness  │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │  "chat"  │  │"research"│  │"deploy"│ │
│  │ (parent) │◀─┤ (child)  │  │(child) │ │
│  │          │◀─┼──────────┘  │        │ │
│  │          │◀─┤             └────────┘ │
│  └──────────┘  │  report_to_parent()    │
│                └────────────────────────┘│
└──────────────────────────────────────────┘
```

Child conversations can **report** important findings back to the parent using the `report_to_parent` tool. This appends a system message to the `chat` history so the agent (and user) always have visibility into what happened in other conversations.

### Persistence

Conversations are stored as JSON files in `.conversations/`:

```
<workspace>/
  .conversations/
    chat.json        ← default, always exists
    research.json    ← user-created
    deploy.json      ← user-created
  .memory.json       ← shared workspace memory
```

Legacy workspaces with a single `.conversation.json` file are automatically migrated to `.conversations/chat.json` on first load.

### Components

| Component | File | Role |
|---|---|---|
| `ConversationManager` | [`src/core/conversation-manager.mjs`](../../src/core/conversation-manager.mjs) | CRUD operations, parent-child reporting, persistence, legacy migration |
| `MiniAIAssistant` | [`src/core/ai-assistant.mjs`](../../src/core/ai-assistant.mjs) | Orchestrates conversation switching, delegates to `ConversationManager` |
| WebSocket handlers | [`src/server/web-server.mjs`](../../src/server/web-server.mjs) | `list-conversations`, `create-conversation`, `switch-conversation`, `delete-conversation` |
| `ConversationSwitcher` | [`ui/src/components/features/ConversationSwitcher.tsx`](../../ui/src/components/features/ConversationSwitcher.tsx) | UI dropdown for conversation management |

### API

**Tools available to the agent:**

| Tool | Description |
|---|---|
| `report_to_parent` | Report findings from a child conversation back to the default `chat` conversation. Includes `summary`, `status`, and `key_findings` parameters. |

**WebSocket messages:**

| Message Type | Direction | Payload |
|---|---|---|
| `list-conversations` | Client → Server | *(none)* |
| `conversation-list` | Server → Client | `Array<{name, messageCount, isActive, isDefault}>` |
| `create-conversation` | Client → Server | `{name: string}` |
| `switch-conversation` | Client → Server | `{name: string}` |
| `conversation-switched` | Server → Client | `{name, previousConversation, history}` |
| `delete-conversation` | Client → Server | `{name: string}` |

---

## 2. Background Tasks

### Concept

The agent can **spawn background tasks** — one-shot asynchronous AI invocations that run independently of the foreground conversation. Each background task gets its own `MiniAIAssistant` instance with the full tool suite, running in the same workspace.

Background tasks are ideal for:

- Long-running operations (code generation, analysis, testing)
- Parallel workstreams (research one topic while discussing another)
- Delegating sub-problems the agent identifies during conversation

### Lifecycle

```
    spawn_background_task
           │
           ▼
       ┌────────┐
       │ queued  │
       └───┬────┘
           │  _executeTask()
           ▼
       ┌─────────┐     cancel_background_task
       │ running  │──────────────────────────┐
       └───┬──┬──┘                           │
           │  │                              ▼
           │  └──── error ──►┌────────┐ ┌───────────┐
           │                 │ failed │ │ cancelled │
           ▼                 └────────┘ └───────────┘
       ┌───────────┐
       │ completed │
       └───────────┘
```

### Components

| Component | File | Role |
|---|---|---|
| `TaskManager` | [`src/core/task-manager.mjs`](../../src/core/task-manager.mjs) | Spawns, tracks, cancels tasks; manages output logs and progress |
| Async task handlers | [`src/execution/handlers/async-task-handlers.mjs`](../../src/execution/handlers/async-task-handlers.mjs) | Tool handler implementations |
| Async task definitions | [`src/tools/definitions/async-task-tools.mjs`](../../src/tools/definitions/async-task-tools.mjs) | Tool schemas |

### Tools

| Tool | Description |
|---|---|
| `spawn_background_task` | Spawn a new background task. Returns a task ID immediately. |
| `check_task_status` | Check status and result of a task by ID. |
| `list_background_tasks` | List all tasks, optionally filtered by status (`all`, `running`, `completed`, `failed`, `cancelled`, `queued`). |
| `cancel_background_task` | Cancel a running or queued task. |
| `get_task_output` | Get the real-time output log of a task. |
| `wait_for_task` | Block until a task completes. Configurable timeout (default: 5 minutes). |

### Concurrency

The `TaskManager` supports configurable concurrency limits (`maxConcurrent`, default: 3). Tasks beyond the limit are queued and executed as slots free up. Each task receives its own `AbortController` for cancellation support.

### Event Bus Integration

Task lifecycle events are broadcast via the `AiManEventBus`:

| Event | Payload |
|---|---|
| `task:spawned` | `{taskId, description, status, createdAt, metadata}` |
| `task:started` | `{taskId}` |
| `task:progress` | `{taskId, progress, status}` |
| `task:output` | `{taskId, line, index}` |
| `task:completed` | `{taskId, description, result}` |
| `task:failed` | `{taskId, description, error}` |
| `task:cancelled` | `{taskId}` |

---

## 3. Recurring Tasks

### Concept

Recurring tasks are **scheduled periodic AI invocations** managed by the `SchedulerService`. Unlike one-shot background tasks, recurring tasks fire on a configurable interval and persist across server restarts.

Use cases:

- Periodic code quality checks
- Monitoring build health
- Automated documentation updates
- Regular security scans
- Scheduled data fetching or reporting

### Persistence

Schedules are persisted to `<workspace>/.ai-man/schedules.json` and automatically restored on server startup. This means recurring tasks survive restarts—they pick up where they left off.

### Lifecycle

```
    create_recurring_task
           │
           ▼
       ┌────────┐
       │ active  │◄──── resume
       └───┬────┘
           │  
           │  each intervalMs
           ▼
    ┌──────────────┐
    │ _trigger()   │──── spawns a background task via TaskManager
    └──────┬───────┘
           │
           ├── maxRuns reached? ──► auto-pause
           │
           ├── skipIfRunning && previous still running? ──► skip this tick
           │
           └── continue timer
```

### Components

| Component | File | Role |
|---|---|---|
| `SchedulerService` | [`src/core/scheduler-service.mjs`](../../src/core/scheduler-service.mjs) | Schedule CRUD, timer management, persistence, workspace switching |
| Async task handlers | [`src/execution/handlers/async-task-handlers.mjs`](../../src/execution/handlers/async-task-handlers.mjs) | Tool handler implementations |

### Tools

| Tool | Description |
|---|---|
| `create_recurring_task` | Create a new recurring schedule with `name`, `description`, `query`, `interval_minutes`, optional `max_runs`, and `skip_if_running` flag. |
| `list_recurring_tasks` | List all schedules, optionally filtered by status (`all`, `active`, `paused`). |
| `manage_recurring_task` | Perform actions on a schedule: `pause`, `resume`, `delete`, or `trigger_now`. |

### Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | string | *(required)* | Human-readable name |
| `description` | string | *(required)* | What the task does |
| `query` | string | *(required)* | The prompt/instructions to execute |
| `interval_minutes` | number | *(required)* | Run every N minutes |
| `max_runs` | number | `null` | Optional limit on total runs |
| `skip_if_running` | boolean | `true` | Skip a tick if the previous invocation is still running |
| `tags` | string[] | `[]` | Metadata tags for filtering |

### Event Bus Integration

| Event | Payload |
|---|---|
| `schedule:created` | Full schedule record |
| `schedule:fired` | `{scheduleId, taskId, runCount}` |
| `schedule:paused` | `{scheduleId}` |
| `schedule:resumed` | `{scheduleId}` |
| `schedule:deleted` | `{scheduleId}` |

---

## 4. The Agent Loop

### Concept

The **Agent Loop** is Oboto's autonomous heartbeat — a recurring background invocation that runs independently of user interaction. Unlike recurring tasks (which execute a static query), the agent loop dynamically assembles a **briefing packet** for each tick that includes:

- Recent foreground conversation history
- Active schedules and their results
- Running and recently completed background tasks
- Holographic memory recall (relevant to current persona mission)
- Consciousness state (known facts, somatic summary, archetypes)
- Answers to previously asked blocking questions

This makes the agent loop **context-aware**: it knows what the user has been doing, what tasks are in flight, and what the agent's current cognitive state is.

### State Machine

```
     play()
       │
       ▼
   ┌─────────┐     pause()      ┌────────┐
   │ playing  │────────────────►│ paused  │
   └────┬────┘                  └───┬────┘
        │                           │
        │         resume()          │
        │◄──────────────────────────┘
        │
        │  stop()
        ▼
   ┌─────────┐
   │ stopped  │
   └─────────┘
```

- **Playing**: Timer fires every `intervalMs` (default: 180 seconds). Each tick spawns a background task.
- **Paused**: Timer stopped, state preserved. Can resume.
- **Stopped**: Fully stopped, invocation counter resets on next play.

### Briefing Packet Structure

Each tick assembles a structured context document with these sections:

| Section | Content |
|---|---|
| Header | Invocation number, timestamp, interval |
| Active Persona | Current persona name |
| Current State | Working directory, foreground status, time since last user activity |
| Recent Conversation | Last 3 foreground exchanges (truncated to 300 chars each) |
| Active Schedules | All schedules with status, last run, run count |
| Background Tasks | Running and recently completed tasks |
| Memory Context | Top 5 holographic memory recalls relevant to persona mission |
| Known Facts | Total facts count, recent inferences |
| Inner State | Somatic summary from consciousness processor |
| Archetype Field | Top 3 active archetypes |
| Previous Q&A | Answers to previously asked blocking questions |
| Directive | OODA loop instructions, communication protocol |
| Foreground Guard | If user is active: read-only mode. If idle: full autonomy. |

### Blocking Questions

The agent loop supports a **blocking question** mechanism. If the background agent absolutely needs user input:

1. The agent calls the `ask_blocking_question` tool
2. The agent loop **pauses** automatically
3. The question is injected into the main chat conversation and broadcast to the UI
4. The user answers in the chat interface
5. The answer is injected into the chat history and emitted to the waiting background agent
6. The agent loop **resumes** automatically

This creates a clean interrupt-driven communication channel between autonomous agents and the user.

### Components

| Component | File | Role |
|---|---|---|
| `AgentLoopController` | [`src/core/agent-loop-controller.mjs`](../../src/core/agent-loop-controller.mjs) | Play/pause/stop, briefing packet assembly, question handling, result injection |
| UI controls | [`ui/src/components/features/AgentLoopControls.tsx`](../../ui/src/components/features/AgentLoopControls.tsx) | Play/pause/stop buttons, interval slider |

### Tools

| Tool | Description |
|---|---|
| `ask_blocking_question` | Ask the user a blocking question that pauses the agent loop until answered. |

### WebSocket Messages

| Message Type | Direction | Payload |
|---|---|---|
| `agent-loop-play` | Client → Server | `{intervalMs?}` |
| `agent-loop-pause` | Client → Server | *(none)* |
| `agent-loop-stop` | Client → Server | *(none)* |
| `agent-loop-set-interval` | Client → Server | `{intervalMs}` |
| `get-agent-loop-state` | Client → Server | *(none)* |
| `agent-loop-answer` | Client → Server | `{questionId, answer}` |
| `agent-loop:state-changed` | Server → Client | `{state, intervalMs, invocationCount, pendingQuestions}` |
| `agent-loop:chat-message` | Server → Client | `{id, role, content, isAgentLoop, invocationNumber}` |
| `agent-loop:question` | Server → Client | `{questionId, question, taskId}` |
| `agent-loop:invocation` | Server → Client | `{invocationNumber, state, foregroundBusy, taskId}` |

### Foreground Safety

The agent loop is aware of foreground activity:

- **`setForegroundBusy(true)`** is called by the web server when a user chat is in progress
- When the foreground is busy, the briefing packet instructs the background agent to **limit itself to read-only observation and planning**
- When the user is idle, the agent is given full autonomy to create surfaces, delegate tasks, update plans, etc.

This prevents conflicts between the autonomous agent and active user interaction.

---

## How They Work Together

The four systems form a layered multi-agent architecture:

```
┌─────────────────────────────────────────────────────┐
│                    User Interface                    │
│  ConversationSwitcher · AgentLoopControls · Chat     │
└────────────────────────┬────────────────────────────┘
                         │ WebSocket
┌────────────────────────▼────────────────────────────┐
│                     Web Server                       │
│  Routes messages to conversations, manages agent     │
│  loop state, broadcasts events                       │
└───────┬─────────────┬─────────────┬─────────────────┘
        │             │             │
   ┌────▼─────┐ ┌─────▼──────┐ ┌───▼──────────────┐
   │ Conver-  │ │  Task      │ │ Scheduler        │
   │ sation   │ │  Manager   │ │ Service          │
   │ Manager  │ │            │ │                  │
   │          │ │ spawns AI  │ │ fires tasks on   │
   │ switches │ │ instances  │ │ intervals        │
   │ history  │ │ for work   │ │                  │
   └──────────┘ └─────┬──────┘ └───────┬──────────┘
                      │                │
                      │   ┌────────────┘
                      │   │
                 ┌────▼───▼─────────────────────┐
                 │     Agent Loop Controller     │
                 │                               │
                 │  Builds briefing packets      │
                 │  Spawns tasks via TaskManager  │
                 │  Injects results into chat    │
                 │  Handles blocking questions    │
                 └───────────────────────────────┘
```

**Typical workflow:**

1. User creates a "research" conversation for investigating a library
2. Agent loop is running, periodically checking project status
3. During research, the agent spawns a `spawn_background_task` to run tests
4. The research conversation uses `report_to_parent` to send findings back to the main `chat`
5. A `create_recurring_task` monitors build health every 30 minutes
6. The agent loop notices a failing test in its next tick and reports it to the user

All of this happens with shared memory, shared workspace state, and unified event broadcasting — making Oboto a truly multi-agent development environment.
