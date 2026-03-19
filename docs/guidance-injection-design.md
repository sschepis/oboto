# Guidance Injection Design

> **Status**: Design  
> **Author**: Architecture Team  
> **Date**: 2026-03-16  

## 1. Feature Overview

Guidance injection allows users to inject commentary, guidance, and questions into the agent **while it is actively processing a task**. Messages are queued asynchronously and consumed at the next natural checkpoint in the agent loop, ensuring the LLM receives user intent without interrupting mid-call execution.

### Use Cases

| Scenario | Example |
|---|---|
| **Course correction** | Agent is writing tests but user wants integration tests, not unit tests |
| **Priority change** | User realizes a different file should be modified first |
| **Additional context** | User remembers a constraint the agent does not know about |
| **Clarifying question** | User sees the agent heading in the wrong direction and wants to redirect |
| **Encouragement / acknowledgment** | User confirms the agent is on the right track |

### Design Principles

1. **Non-disruptive** — never abort an in-flight LLM call; wait for the next loop iteration
2. **Queue-based** — multiple messages accumulate; all are drained atomically at the next checkpoint
3. **Provider-agnostic** — the queue lives on [`EventicFacade`](src/core/eventic-facade.mjs) and is consumed identically by every provider
4. **Clearly delineated** — injected text is wrapped in `[USER GUIDANCE]` blocks so the LLM can distinguish it from system guidance
5. **Observable** — events are emitted at every lifecycle point: queued, consumed, acknowledged

---

## 2. Architecture

```mermaid
sequenceDiagram
    participant User
    participant CLI as CLI Interface
    participant WS as WebSocket Handler
    participant Facade as EventicFacade
    participant Queue as guidanceQueue array
    participant Loop as Agent Loop - Eventic or LMScript
    participant LLM

    User->>CLI: types guidance while agent is busy
    CLI->>Facade: queueChimeIn - message, source: cli -
    Facade->>Queue: push - timestamp, source, message -
    Facade-->>CLI: returns queue length
    Note over Facade: emits guidance:queued event

    User->>WS: sends chime-in WebSocket message
    WS->>Facade: queueChimeIn - message, source: ws -
    Facade->>Queue: push - timestamp, source, message -
    Note over Facade: emits guidance:queued event

    Loop->>Queue: drainGuidanceQueue at loop checkpoint
    Queue-->>Loop: returns array of entries and clears queue
    Note over Facade: emits guidance:consumed event
    Loop->>Loop: format as USER GUIDANCE blocks
    Loop->>LLM: prompt with injected guidance
    LLM-->>Loop: response acknowledging guidance
    Note over Facade: emits guidance:acknowledged event
```

### Component Ownership

| Component | Responsibility |
|---|---|
| [`EventicFacade`](src/core/eventic-facade.mjs) | Owns the queue, public API, event emission |
| [`EventicAgentLoopPlugin`](src/core/eventic-agent-loop-plugin.mjs) | Drains queue in `ACTOR_CRITIC_LOOP` handler, injects into prompt |
| [`LMScriptProvider`](src/core/agentic/lmscript/lmscript-provider.mjs) | Drains queue in `_agentLoop()` while loop, injects into observation |
| [`agent-loop-handler.mjs`](src/server/ws-handlers/agent-loop-handler.mjs) | WebSocket surface for chime-in |
| [`agent-commands.mjs`](src/execution/cli-commands/agent-commands.mjs) | CLI surface for chime-in |
| [`cli-interface.mjs`](src/cli/cli-interface.mjs) | Detects busy state, routes input to `queueChimeIn` |

---

## 3. Detailed Design

### 3.1 Guidance Queue — EventicFacade

The queue is a simple array on the facade instance. Each entry is a timestamped object.

#### Data Structure

```javascript
// Single guidance entry
{
    id: 'guid-1710622453877-0',   // unique ID for tracking
    message: 'Focus on integration tests, not unit tests',
    source: 'cli' | 'ws' | 'api',
    timestamp: '2026-03-16T21:54:13.877Z',
    metadata: {}                   // extensible - e.g. ws client ID
}
```

#### New/Modified Methods on EventicFacade

**[`queueChimeIn(message, options)`](src/core/eventic-facade.mjs:318)** — replace existing stub:

```javascript
queueChimeIn(message, options = {}) {
    if (!message || typeof message !== 'string' || !message.trim()) {
        return { queued: false, reason: 'Empty message' };
    }

    const entry = {
        id: `guid-${Date.now()}-${this._guidanceQueue.length}`,
        message: message.trim(),
        source: options.source || 'api',
        timestamp: new Date().toISOString(),
        metadata: options.metadata || {}
    };

    this._guidanceQueue.push(entry);

    if (this.eventBus) {
        this.eventBus.emit('guidance:queued', {
            id: entry.id,
            source: entry.source,
            queueLength: this._guidanceQueue.length,
            timestamp: entry.timestamp
        });
    }

    consoleStyler.log('system',
        `📨 Guidance queued (${this._guidanceQueue.length} pending): "${message.substring(0, 80)}..."`
    );

    return {
        queued: true,
        id: entry.id,
        queueLength: this._guidanceQueue.length
    };
}
```

**`drainGuidanceQueue()`** — new method, called by agent loops:

```javascript
drainGuidanceQueue() {
    if (this._guidanceQueue.length === 0) return [];

    const entries = [...this._guidanceQueue];
    this._guidanceQueue = [];

    if (this.eventBus) {
        this.eventBus.emit('guidance:consumed', {
            count: entries.length,
            ids: entries.map(e => e.id),
            timestamp: new Date().toISOString()
        });
    }

    return entries;
}
```

**`getGuidanceQueue()`** — read-only accessor:

```javascript
getGuidanceQueue() {
    return [...this._guidanceQueue];
}
```

**Constructor change** — initialize the queue array:

```javascript
// In constructor, after this._isBusy = false;
this._guidanceQueue = [];
```

### 3.2 Prompt Injection Format

All providers use a consistent format when injecting guidance into the LLM prompt:

```
[USER GUIDANCE]: The user has injected the following guidance while you were working.
Acknowledge each point and adjust your approach accordingly.

[GUIDANCE 1] (cli, 2026-03-16T21:54:13Z):
Focus on integration tests, not unit tests

[GUIDANCE 2] (ws, 2026-03-16T21:55:02Z):
Also make sure to test the error handling path

[END USER GUIDANCE]
```

#### Formatting Function — shared utility

A new exported function in [`eventic-agent-loop-plugin.mjs`](src/core/eventic-agent-loop-plugin.mjs) or a new file `src/core/guidance-formatter.mjs`:

```javascript
/**
 * Format drained guidance entries into a prompt block.
 * @param {Array} entries — from drainGuidanceQueue()
 * @returns {string} formatted block, or empty string if no entries
 */
export function formatGuidanceBlock(entries) {
    if (!entries || entries.length === 0) return '';

    const lines = [
        '[USER GUIDANCE]: The user has injected the following guidance while you were working.',
        'Acknowledge each point and adjust your approach accordingly.',
        ''
    ];

    entries.forEach((entry, i) => {
        const ts = entry.timestamp ? entry.timestamp.substring(0, 19) + 'Z' : 'unknown';
        lines.push(`[GUIDANCE ${i + 1}] (${entry.source}, ${ts}):`);
        lines.push(entry.message);
        lines.push('');
    });

    lines.push('[END USER GUIDANCE]');
    return lines.join('\n');
}
```

### 3.3 Eventic Agent Loop Integration

**File**: [`src/core/eventic-agent-loop-plugin.mjs`](src/core/eventic-agent-loop-plugin.mjs)  
**Location**: `ACTOR_CRITIC_LOOP` handler, after line 624 (after existing `guidance` injection, before `pendingErrors` injection)

The integration follows the exact same pattern as [`ctx.pendingErrors`](src/core/eventic-agent-loop-plugin.mjs:627) — drain a queue and inject into the prompt:

```javascript
// Inside ACTOR_CRITIC_LOOP handler, after the existing guidance injection

// Drain user guidance queue (chime-in messages)
const facade = ctx.facade || engine.context?.facade;
if (facade && typeof facade.drainGuidanceQueue === 'function') {
    const guidanceEntries = facade.drainGuidanceQueue();
    if (guidanceEntries.length > 0) {
        const guidanceBlock = formatGuidanceBlock(guidanceEntries);
        prompt = `${guidanceBlock}\n\n${prompt}`;
        log(`Injected ${guidanceEntries.length} user guidance message(s) into context`);
        emitCommentary(`📨 Received ${guidanceEntries.length} guidance message(s) from user`);
    }
}
```

**Context propagation**: The `ctx.facade` reference must be set during `AGENT_START`. Add to the context setup around line 370:

```javascript
ctx.facade = engine.context?.facade || null;
```

### 3.4 LMScript Provider Integration

**File**: [`src/core/agentic/lmscript/lmscript-provider.mjs`](src/core/agentic/lmscript/lmscript-provider.mjs)  
**Location**: Inside [`_agentLoop()`](src/core/agentic/lmscript/lmscript-provider.mjs:176), at the top of the while loop (after the abort check at line 193)

```javascript
// Inside the while loop, after _checkAbort

// Drain user guidance queue
const facade = this._deps.facade;
if (facade && typeof facade.drainGuidanceQueue === 'function') {
    const guidanceEntries = facade.drainGuidanceQueue();
    if (guidanceEntries.length > 0) {
        const guidanceBlock = formatGuidanceBlock(guidanceEntries);
        // Prepend guidance to the current observation so the LLM sees it
        observation = `${guidanceBlock}\n\n${observation}`;
        emitStatus(`Received ${guidanceEntries.length} guidance message(s) from user`);
    }
}
```

### 3.5 WebSocket Handler

**File**: [`src/server/ws-handlers/agent-loop-handler.mjs`](src/server/ws-handlers/agent-loop-handler.mjs)

Add a new handler for the `agent-chime-in` message type:

```javascript
async function handleAgentChimeIn(data, ctx) {
    const { ws, assistant } = ctx;
    const message = data.payload?.message;

    if (!message || typeof message !== 'string' || !message.trim()) {
        wsSendError(ws, 'chime-in requires a non-empty message');
        return;
    }

    if (!assistant || typeof assistant.queueChimeIn !== 'function') {
        wsSendError(ws, 'Agent does not support chime-in');
        return;
    }

    const result = assistant.queueChimeIn(message, {
        source: 'ws',
        metadata: { clientId: data.payload?.clientId }
    });

    wsSend(ws, 'chime-in-ack', {
        ...result,
        isBusy: assistant.isBusy()
    });
}
```

Register in the handlers export:

```javascript
export const handlers = {
    // ... existing handlers ...
    'agent-chime-in': handleAgentChimeIn
};
```

#### WebSocket Protocol

**Client → Server**:
```json
{
    "type": "agent-chime-in",
    "payload": {
        "message": "Focus on integration tests instead",
        "clientId": "optional-client-identifier"
    }
}
```

**Server → Client** (acknowledgment):
```json
{
    "type": "chime-in-ack",
    "payload": {
        "queued": true,
        "id": "guid-1710622453877-0",
        "queueLength": 1,
        "isBusy": true
    }
}
```

### 3.6 CLI Command

**File**: [`src/execution/cli-commands/agent-commands.mjs`](src/execution/cli-commands/agent-commands.mjs)

Add a new `chimein` command to the registry returned by [`createAgentCommands()`](src/execution/cli-commands/agent-commands.mjs:17):

```javascript
chimein: {
    help: 'Inject guidance into the running agent. Usage: chimein <message>',
    usage: 'chimein <message>',
    async execute(args, stdin) {
        const message = args.join(' ') || stdin;
        if (!message) {
            return {
                output: 'chimein: usage: chimein <guidance message>\n' +
                    '  Injects guidance into the agent while it is processing.\n' +
                    '  The agent will see your message at its next checkpoint.',
                exitCode: 1
            };
        }

        // Access facade via toolExecutor's assistant reference
        const facade = toolExecutor.assistant;
        if (!facade || typeof facade.queueChimeIn !== 'function') {
            return {
                output: '[error] chimein: agent does not support guidance injection',
                exitCode: 1
            };
        }

        const result = facade.queueChimeIn(message, { source: 'cli' });
        if (result.queued) {
            return {
                output: `Guidance queued (${result.queueLength} pending). ` +
                    `The agent will see it at its next checkpoint.`,
                exitCode: 0
            };
        }
        return {
            output: `[error] chimein: ${result.reason}`,
            exitCode: 1
        };
    }
}
```

### 3.7 CLI Interface — Busy-State Input Routing

**File**: [`src/cli/cli-interface.mjs`](src/cli/cli-interface.mjs)

The current [`startInteractiveMode()`](src/cli/cli-interface.mjs:16) blocks on `assistant.runStream()` — the readline callback does not fire again until the stream completes. To support typing guidance mid-task, modify the flow:

**Option A — Separate input listener** (recommended):

Instead of using `rl.question()` which blocks, use `rl.on('line', ...)` which fires for every line regardless of whether a previous handler is still running:

```javascript
async startInteractiveMode(assistant, workingDir) {
    // ... existing setup ...

    this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    let processing = false;

    return new Promise((resolve) => {
        const showPrompt = () => {
            const prefix = processing ? '💬 [GUIDANCE] ' : '👤 [YOU] ';
            this.rl.setPrompt(prefix);
            this.rl.prompt();
        };

        this.rl.on('line', async (userInput) => {
            if (!userInput || userInput.trim() === '') {
                showPrompt();
                return;
            }

            if (userInput.toLowerCase() === 'exit') {
                consoleStyler.log('system', 'Goodbye!', { box: true });
                await assistant.saveSession('.ai-session');
                resolve();
                return;
            }

            // If agent is busy, route to guidance queue
            if (processing && assistant.isBusy()) {
                const result = assistant.queueChimeIn(userInput.trim(), {
                    source: 'cli'
                });
                if (result.queued) {
                    consoleStyler.log('system',
                        `📨 Guidance queued (${result.queueLength} pending)`
                    );
                }
                showPrompt();
                return;
            }

            // Normal processing
            processing = true;
            showPrompt(); // Show guidance prompt while busy

            try {
                if (assistant.runStream) {
                    consoleStyler.log('working', 'Thinking...');
                    await assistant.runStream(userInput, (chunk) => {
                        process.stdout.write(chunk);
                    });
                    console.log('\n');
                } else {
                    const response = await assistant.run(userInput);
                    consoleStyler.log('ai', response);
                }
            } catch (error) {
                consoleStyler.log('error', error.message);
            }

            processing = false;
            showPrompt();
        });

        this.rl.on('close', () => resolve());
        showPrompt();
    });
}
```

The key insight: when `processing` is true and `assistant.isBusy()` returns true, any typed input is routed to [`queueChimeIn()`](src/core/eventic-facade.mjs:318) instead of starting a new `run()` call. The prompt changes from `👤 [YOU]` to `💬 [GUIDANCE]` to signal this mode shift.

---

## 4. Event Specification

All events are emitted via [`eventBus`](src/lib/event-bus.mjs) on the facade.

| Event | Payload | Emitted When |
|---|---|---|
| `guidance:queued` | `{ id, source, queueLength, timestamp }` | User calls `queueChimeIn()` |
| `guidance:consumed` | `{ count, ids, timestamp }` | Agent loop drains the queue |
| `guidance:acknowledged` | `{ count, requestId, timestamp }` | Agent produces response that consumed guidance |

The `guidance:acknowledged` event is emitted by the agent loop after the LLM responds to a prompt that contained guidance. In the Eventic loop, this happens after the `engine.ai.ask()` call returns when guidance was injected. In LMScript, after `_callLLMForAction()` returns when guidance was injected.

---

## 5. API Specification

### 5.1 Facade Public API

```typescript
interface EventicFacade {
    /** Queue a guidance message for the running agent */
    queueChimeIn(message: string, options?: {
        source?: 'cli' | 'ws' | 'api';
        metadata?: Record<string, unknown>;
    }): { queued: boolean; id?: string; queueLength?: number; reason?: string };

    /** Drain all pending guidance - called by agent loops */
    drainGuidanceQueue(): GuidanceEntry[];

    /** Read the current queue without draining */
    getGuidanceQueue(): GuidanceEntry[];
}

interface GuidanceEntry {
    id: string;
    message: string;
    source: 'cli' | 'ws' | 'api';
    timestamp: string;
    metadata: Record<string, unknown>;
}
```

### 5.2 WebSocket API

| Direction | Message Type | Payload |
|---|---|---|
| Client → Server | `agent-chime-in` | `{ message: string, clientId?: string }` |
| Server → Client | `chime-in-ack` | `{ queued: boolean, id?: string, queueLength?: number, isBusy: boolean }` |
| Server → Client | `guidance-event` | `{ event: 'queued' or 'consumed' or 'acknowledged', ...payload }` |

### 5.3 CLI API

| Command | Description |
|---|---|
| `chimein <message>` | Queue guidance from the LMScript CLI executor |
| Typing while busy | Automatically routed to guidance queue in interactive mode |

---

## 6. Edge Cases and Error Handling

| Edge Case | Handling |
|---|---|
| Guidance queued when agent is idle | Queue stores it; it will be consumed on the next `run()` call. The `chime-in-ack` response includes `isBusy: false` so the client can warn the user. |
| Empty message | `queueChimeIn()` returns `{ queued: false, reason: 'Empty message' }` |
| Very long guidance message | Truncate to 2000 characters to avoid prompt overflow. Log a warning. |
| Many queued messages | Cap at 10 entries. Reject additional entries with `{ queued: false, reason: 'Queue full' }`. Oldest entries are preserved. |
| Agent finishes before consuming guidance | Unconsumed entries remain in the queue for the next run. Emit `guidance:expired` if entries are older than 5 minutes when drained. |
| Multiple providers | Queue lives on facade, not on providers. Provider switch does not lose queue. |
| `drainGuidanceQueue()` called concurrently | JavaScript is single-threaded; no race condition. The splice-and-clear is atomic. |
| Guidance during precheck | The precheck in `AGENT_START` does not drain guidance. Guidance is only consumed in `ACTOR_CRITIC_LOOP` and `_agentLoop()`. |

---

## 7. Implementation Plan

### File-by-File Changes

#### 1. [`src/core/eventic-facade.mjs`](src/core/eventic-facade.mjs)

| Line/Area | Change |
|---|---|
| Constructor (~line 177) | Add `this._guidanceQueue = [];` |
| Line 318-321 | Replace `queueChimeIn()` stub with full implementation |
| After line 321 | Add `drainGuidanceQueue()` method |
| After `drainGuidanceQueue` | Add `getGuidanceQueue()` method |

#### 2. New file: `src/core/guidance-formatter.mjs`

Create a new module with the `formatGuidanceBlock()` utility function. This keeps the formatting logic DRY between Eventic and LMScript providers.

#### 3. [`src/core/eventic-agent-loop-plugin.mjs`](src/core/eventic-agent-loop-plugin.mjs)

| Line/Area | Change |
|---|---|
| Line 1 imports | Add `import { formatGuidanceBlock } from './guidance-formatter.mjs';` |
| `AGENT_START` handler (~line 370) | Add `ctx.facade = engine.context?.facade ?? null;` |
| `ACTOR_CRITIC_LOOP` handler (~line 624) | After existing `guidance` injection, before `pendingErrors`, add guidance queue drain + injection block |
| After LLM response with guidance | Emit `guidance:acknowledged` event |

#### 4. [`src/core/agentic/lmscript/lmscript-provider.mjs`](src/core/agentic/lmscript/lmscript-provider.mjs)

| Line/Area | Change |
|---|---|
| Imports | Add `import { formatGuidanceBlock } from '../../guidance-formatter.mjs';` |
| `_agentLoop()` while loop (~line 193) | After `_checkAbort()`, add guidance queue drain and inject into `observation` |

#### 5. [`src/server/ws-handlers/agent-loop-handler.mjs`](src/server/ws-handlers/agent-loop-handler.mjs)

| Line/Area | Change |
|---|---|
| After line 57 | Add `handleAgentChimeIn()` function |
| Line 60-67 handlers export | Add `'agent-chime-in': handleAgentChimeIn` |

#### 6. [`src/execution/cli-commands/agent-commands.mjs`](src/execution/cli-commands/agent-commands.mjs)

| Line/Area | Change |
|---|---|
| Inside `createAgentCommands()` return object | Add `chimein` command entry |

#### 7. [`src/cli/cli-interface.mjs`](src/cli/cli-interface.mjs)

| Line/Area | Change |
|---|---|
| `startInteractiveMode()` (line 16-103) | Refactor from `rl.question()` callback pattern to `rl.on('line', ...)` event pattern. Add busy-state detection and guidance routing. |

### Implementation Order

1. **`guidance-formatter.mjs`** — pure function, no dependencies, testable in isolation
2. **`eventic-facade.mjs`** — queue infrastructure, `queueChimeIn()`, `drainGuidanceQueue()`, `getGuidanceQueue()`
3. **`eventic-agent-loop-plugin.mjs`** — Eventic loop integration (primary provider)
4. **`lmscript-provider.mjs`** — LMScript loop integration (secondary provider)
5. **`agent-loop-handler.mjs`** — WebSocket surface
6. **`agent-commands.mjs`** — CLI command surface
7. **`cli-interface.mjs`** — interactive CLI busy-state routing

### Testing Strategy

| Test | Scope |
|---|---|
| Unit: `formatGuidanceBlock()` | Verify formatting with 0, 1, N entries |
| Unit: `queueChimeIn()` | Verify validation, queue growth, event emission |
| Unit: `drainGuidanceQueue()` | Verify atomic drain, empty-after-drain, event emission |
| Integration: Eventic loop | Mock facade with queued guidance, verify prompt contains `[USER GUIDANCE]` |
| Integration: LMScript loop | Mock facade with queued guidance, verify observation contains `[USER GUIDANCE]` |
| Integration: WebSocket | Send `agent-chime-in` message, verify `chime-in-ack` response |
| E2E: CLI interactive | Start agent, type guidance mid-task, verify agent acknowledges it |
