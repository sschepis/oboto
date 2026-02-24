# Workspace-Switch Conversation Reset Fix

## Problem Summary

When a user switches workspaces (CWD), the conversation/chat history does not reset. The UI continues showing the old workspace's messages because:

1. **`handleSetCwd`** in `settings-handler.mjs:299-371` calls `assistant.changeWorkingDirectory()` but never calls `assistant.loadConversation()`, so server-side conversation state remains stale.
2. **`changeWorkingDirectory()`** in `eventic-facade.mjs:311-331` updates `workingDir`, re-inits `toolExecutor`, and switches `personaManager`, but never re-initializes `conversationManager`, `historyManager`, or `consciousness`.
3. **UI `setCwd()`** in `useChat.ts:364-370` sends a WS message but never clears `messages` state or requests fresh conversation history.

## Existing Infrastructure (No Changes Needed)

These mechanisms already work correctly and will be leveraged by the fix:

| Component | Location | What It Does |
|-----------|----------|--------------|
| `loadConversation()` | `eventic-facade.mjs:347-417` | Re-initializes `conversationManager`, loads history from disk, sets up system prompt, syncs with `aiProvider.conversationHistory`, emits `server:history-loaded` and `server:conversation-switched` via eventBus |
| `ConversationManager.switchWorkspace()` | `conversation-manager.mjs:68-78` | Saves current conversations, clears in-memory map, resets to default, initializes at new dir |
| `history-loaded` listener | `useChat.ts:141-143` | `setMessages(payload as Message[])` — replaces all UI messages |
| `conversation-list` listener | `useChat.ts:269-271` | `setConversations(payload as ConversationInfo[])` |
| `conversation-switched` listener | `useChat.ts:272-277` | `setActiveConversation(p.name)` |

---

## Exact Changes Required

### 1. `src/core/eventic-facade.mjs` — `changeWorkingDirectory()` method

**Lines 311-331.** Add `conversationManager.switchWorkspace()`, `consciousness` re-init, and `resoLangService` workspace update.

```javascript
// BEFORE (lines 311-331):
async changeWorkingDirectory(newDir) {
    const resolvedPath = path.resolve(newDir);
    this.workingDir = resolvedPath;
    try {
        process.chdir(resolvedPath);
    } catch (e) {
        console.warn(`[EventicFacade] Could not chdir to ${resolvedPath}`);
    }
    
    if (this.personaManager) {
        await this.personaManager.switchWorkspace(this.workingDir);
    }

    this._initToolExecutor();
    // Update the tools plugin to point to the new executor
    if (this.toolsPlugin) {
        this.toolsPlugin.toolExecutor = this.toolExecutor;
    }

    return this.workingDir;
}

// AFTER:
async changeWorkingDirectory(newDir) {
    const resolvedPath = path.resolve(newDir);
    this.workingDir = resolvedPath;
    try {
        process.chdir(resolvedPath);
    } catch (e) {
        console.warn(`[EventicFacade] Could not chdir to ${resolvedPath}`);
    }
    
    if (this.personaManager) {
        await this.personaManager.switchWorkspace(this.workingDir);
    }

    // Re-initialize conversation manager for the new workspace
    // This saves current conversations, clears memory, and loads from new dir
    if (this.conversationManager) {
        await this.conversationManager.switchWorkspace(this.workingDir);
    }

    // Re-initialize consciousness processor for the new workspace
    if (this.consciousness) {
        this.consciousness = new ConsciousnessProcessor({ persistDir: this.workingDir });
        if (this.engine && this.engine.context) {
            this.engine.context.consciousness = this.consciousness;
        }
    }

    // Update ResoLang service workspace
    if (this.resoLangService) {
        this.resoLangService = new ResoLangService(this.workingDir);
        this.memoryAdapter = this.resoLangService;
    }

    // Update MCP client manager workspace
    if (this.mcpClientManager) {
        this.mcpClientManager = new McpClientManager(this.workingDir);
    }

    this._initToolExecutor();
    // Update the tools plugin to point to the new executor
    if (this.toolsPlugin) {
        this.toolsPlugin.toolExecutor = this.toolExecutor;
    }

    // Update Eventic engine context
    if (this.engine && this.engine.context) {
        this.engine.context.workingDir = this.workingDir;
    }

    return this.workingDir;
}
```

**Rationale:** `conversationManager.switchWorkspace()` already handles saving current state, clearing memory, and re-initializing at the new path. The other managers (`consciousness`, `resoLangService`, `mcpClientManager`) are constructed with `workingDir` and need to be reset. This ensures `loadConversation()` (called next in `handleSetCwd`) operates on a fresh `conversationManager` pointing at the new workspace.

### 2. `src/server/ws-handlers/settings-handler.mjs` — `handleSetCwd` function

**After line 329** (after `restoreAISettings`), add a call to `assistant.loadConversation()` and emit the conversation list. Also add conversation loading to the early-return path (browser reload case).

```javascript
// BEFORE (lines 299-371):
async function handleSetCwd(data, ctx) {
    const { ws, assistant, broadcast, schedulerService } = ctx;
    try {
        const newPath = data.payload;

        const resolvedNew = path.resolve(newPath);
        if (assistant.workingDir && path.resolve(assistant.workingDir) === resolvedNew) {
            consoleStyler.log('system', `set-cwd skipped — already in ${resolvedNew}`);
            // Still send back status, file tree, and surfaces so the UI isn't left hanging
            try {
                const info = await getProjectInfo(resolvedNew);
                wsSend(ws, 'status-update', info);
                const tree = await getDirectoryTree(resolvedNew, 2);
                wsSend(ws, 'file-tree', tree);
                if (assistant.toolExecutor?.surfaceManager) {
                    try {
                        const surfaces = await assistant.toolExecutor.surfaceManager.listSurfaces();
                        wsSend(ws, 'surface-list', surfaces);
                    } catch { wsSend(ws, 'surface-list', []); }
                }
            } catch (e) {
                // Non-fatal
            }
            return;
        }

        const actualPath = await assistant.changeWorkingDirectory(newPath);

        // Restore AI settings saved for this workspace
        restoreAISettings(actualPath, assistant);

        wsSend(ws, 'status', `Changed working directory to ${actualPath}`);
        // ... rest of handler ...
    }
}

// AFTER:
async function handleSetCwd(data, ctx) {
    const { ws, assistant, broadcast, schedulerService } = ctx;
    try {
        const newPath = data.payload;

        const resolvedNew = path.resolve(newPath);
        if (assistant.workingDir && path.resolve(assistant.workingDir) === resolvedNew) {
            consoleStyler.log('system', `set-cwd skipped — already in ${resolvedNew}`);
            // Still send back status, file tree, surfaces, AND conversation state
            // so the UI isn't left hanging (happens on browser reload)
            try {
                const info = await getProjectInfo(resolvedNew);
                wsSend(ws, 'status-update', info);
                const tree = await getDirectoryTree(resolvedNew, 2);
                wsSend(ws, 'file-tree', tree);
                if (assistant.toolExecutor?.surfaceManager) {
                    try {
                        const surfaces = await assistant.toolExecutor.surfaceManager.listSurfaces();
                        wsSend(ws, 'surface-list', surfaces);
                    } catch { wsSend(ws, 'surface-list', []); }
                }
            } catch (e) {
                // Non-fatal
            }

            // ── NEW: Load conversation state on browser reload ──
            try {
                await assistant.loadConversation();
                const conversations = await assistant.listConversations();
                wsSend(ws, 'conversation-list', conversations);
            } catch (e) {
                consoleStyler.log('warning', `Failed to load conversation on reload: ${e.message}`);
            }
            return;
        }

        const actualPath = await assistant.changeWorkingDirectory(newPath);

        // Restore AI settings saved for this workspace
        restoreAISettings(actualPath, assistant);

        // ── NEW: Load conversation for the new workspace ──
        // loadConversation() re-initializes conversationManager, loads history
        // from disk, sets up system prompt, and emits history-loaded +
        // conversation-switched events via eventBus (which broadcast to all clients).
        try {
            await assistant.loadConversation();
            const conversations = await assistant.listConversations();
            broadcast('conversation-list', conversations);
        } catch (e) {
            consoleStyler.log('warning', `Failed to load conversation for workspace: ${e.message}`);
        }

        wsSend(ws, 'status', `Changed working directory to ${actualPath}`);
        // ... rest of handler unchanged ...
    }
}
```

**Key detail:** `loadConversation()` emits `server:history-loaded` and `server:conversation-switched` via `eventBus`. The `web-server.mjs` bridges these events to WebSocket broadcasts, so all connected clients automatically receive the new history. We additionally send `conversation-list` so the sidebar conversation list updates.

**Early-return path:** On browser reload (same CWD), we call `loadConversation()` to re-send conversation state to the newly connected client. We use `wsSend` (not `broadcast`) for the conversation list since this is a single-client restore. However, `loadConversation()` emits via `eventBus` which broadcasts — this is acceptable since re-sending current state to all clients is idempotent.

### 3. `ui/src/hooks/useChat.ts` — `setCwd()` function

**Lines 364-370.** Add optimistic message clearing when workspace changes.

```typescript
// BEFORE:
const setCwd = (path: string) => {
    // Persist immediately so it survives page refresh even before server confirms
    localStorage.setItem(LS_CWD_KEY, path);
    if (isConnected) {
        wsService.setCwd(path);
    }
};

// AFTER:
const setCwd = (newPath: string) => {
    // Persist immediately so it survives page refresh even before server confirms
    localStorage.setItem(LS_CWD_KEY, newPath);
    if (isConnected) {
        // Optimistically clear messages while waiting for server to send new history.
        // The server will emit history-loaded with the new workspace's conversation,
        // which replaces messages via the existing history-loaded listener.
        setMessages([]);
        setConversations([]);
        setActiveConversation('chat');
        wsService.setCwd(newPath);
    }
};
```

**Rationale:** Without optimistic clearing, there is a brief window where old workspace messages remain visible while the server processes the workspace switch. Clearing immediately provides instant visual feedback. The `history-loaded` event from the server will then populate with the correct history. If the workspace switch fails, the server sends an error — messages would be empty, which is acceptable (user can switch back).

---

## Event Flow Diagram

```
┌──────────┐                    ┌──────────────┐                  ┌──────────────────┐
│  UI      │                    │  Server      │                  │  EventicFacade   │
│ useChat  │                    │  handleSetCwd│                  │                  │
└────┬─────┘                    └──────┬───────┘                  └────────┬─────────┘
     │                                 │                                   │
     │ setCwd /new/path                │                                   │
     │ ─ setMessages empty             │                                   │
     │ ─ setConversations empty        │                                   │
     │ ─ setActiveConversation chat    │                                   │
     │ ─ wsService.setCwd             │                                   │
     │────────────────────────────────>│                                   │
     │                                 │                                   │
     │                                 │ changeWorkingDirectory            │
     │                                 │──────────────────────────────────>│
     │                                 │                                   │
     │                                 │         ┌─────────────────────────┤
     │                                 │         │ chdir                   │
     │                                 │         │ personaManager.switch   │
     │                                 │         │ conversationManager     │
     │                                 │         │   .switchWorkspace      │
     │                                 │         │   - save old convos    │
     │                                 │         │   - clear memory       │
     │                                 │         │   - init new dir       │
     │                                 │         │ re-init consciousness  │
     │                                 │         │ re-init resoLangService│
     │                                 │         │ re-init mcpClient      │
     │                                 │         │ _initToolExecutor      │
     │                                 │         │ update engine context  │
     │                                 │         └─────────────────────────┤
     │                                 │                                   │
     │                                 │ <─────── return actualPath        │
     │                                 │                                   │
     │                                 │ restoreAISettings                 │
     │                                 │                                   │
     │                                 │ loadConversation                  │
     │                                 │──────────────────────────────────>│
     │                                 │         ┌─────────────────────────┤
     │                                 │         │ conversationManager     │
     │                                 │         │   .initialize           │
     │                                 │         │   .migrateFromLegacy    │
     │                                 │         │ build system prompt     │
     │                                 │         │ sync historyManager     │
     │                                 │         │ sync aiProvider history │
     │                                 │         │ sync toolExecutor       │
     │                                 │         │ sync statePlugin        │
     │                                 │         └─────────────────────────┤
     │                                 │                                   │
     │     eventBus: history-loaded    │ <─── eventBus.emit               │
     │<────────────────────────────────│       server:history-loaded       │
     │ setMessages with new history    │                                   │
     │                                 │                                   │
     │  eventBus: conversation-switched│ <─── eventBus.emit               │
     │<────────────────────────────────│       server:conversation-switched│
     │ setActiveConversation           │                                   │
     │                                 │                                   │
     │                                 │ listConversations                 │
     │                                 │──────────────────────────────────>│
     │  broadcast: conversation-list   │ <─── result                      │
     │<────────────────────────────────│                                   │
     │ setConversations                │                                   │
     │                                 │                                   │
     │  wsSend: status-update          │                                   │
     │<────────────────────────────────│                                   │
     │ setProjectStatus + persist CWD  │                                   │
     │                                 │                                   │
     │  wsSend: file-tree              │                                   │
     │<────────────────────────────────│                                   │
     │ setFileTree                     │                                   │
     │                                 │                                   │
     │  wsSend: surface-list           │                                   │
     │<────────────────────────────────│                                   │
```

---

## Edge Case Handling

### 1. First-time workspace open (no `.ai-man/` or `.conversations/` dir)

- `ConversationManager.switchWorkspace()` calls `initialize()` which creates `.conversations/` via `mkdir({ recursive: true })`.
- `loadConversation()` calls `conversationManager.initialize()` again (idempotent) and `migrateFromLegacy()` (no-op if no `.conversation.json`).
- Result: Empty default "chat" conversation created. `history-loaded` emits with just the system prompt message. UI shows clean slate.

### 2. Browser reload (CWD same — early-return path)

- `handleSetCwd` detects same CWD at line 305, enters early-return path.
- **New code** calls `loadConversation()` which re-loads history from disk and emits `history-loaded`.
- `wsSend` sends `conversation-list` to just the reconnecting client.
- Result: UI fully restores previous conversation state.

### 3. Rapid workspace switching

- Each `changeWorkingDirectory()` call runs `conversationManager.switchWorkspace()` which calls `saveAll()` before clearing memory. This ensures no data loss.
- `loadConversation()` is called after `changeWorkingDirectory()` completes, so the workspace is fully settled.
- If a second `setCwd` arrives while the first is still processing, the `handleSetCwd` function runs sequentially per WebSocket message (Node.js event loop — no true concurrency for a single WS connection). The second call will simply overwrite the state from the first.
- UI optimistic clearing means the user sees a blank chat immediately, regardless of server processing time.

### 4. Workspace with no saved conversations

- Same as "first-time" case. `ConversationManager.initialize()` creates a default "chat" conversation with an empty HistoryManager.
- `loadConversation()` initializes the system prompt and emits `history-loaded` with `[systemPromptMessage]`.
- UI displays no chat messages (system prompt is typically filtered or hidden by the UI).

### 5. Error during workspace switch

- If `changeWorkingDirectory()` throws, the catch block in `handleSetCwd` sends an error to the client via `wsSendError()`.
- The UI will have already cleared messages optimistically. The error is displayed to the user. They can switch to another workspace or reload.
- No partial state corruption since `conversationManager.switchWorkspace()` saves before clearing.

---

## Risks and Concerns

### Low Risk
- **`loadConversation()` is called twice during early-return path**: Once via this fix, and potentially again if other code paths trigger it. This is safe — `loadConversation()` is idempotent (re-initializes, re-loads, re-emits).
- **`history-loaded` broadcasts to all clients**: On browser reload (early-return path), `loadConversation()` emits via `eventBus` which broadcasts. If multiple browser tabs are open, they all receive the event. This is acceptable — they all show the same workspace state.

### Medium Risk
- **Parameter naming collision in `setCwd`**: The UI function parameter is renamed from `path` to `newPath` to avoid shadowing the `path` import in the module. Verify no callers depend on the parameter name (they don't — it's positional).
- **`consciousness` re-creation**: Creating a new `ConsciousnessProcessor` discards any in-memory state from the old workspace. This is the correct behavior (each workspace has its own consciousness state), but verify `ConsciousnessProcessor` loads from `persistDir` on construction if prior state exists.
- **`conversationManager.switchWorkspace()` + `loadConversation()`**: Both call `conversationManager.initialize()`. The second call in `loadConversation()` is a no-op since `_conversations` already has the default conversation loaded. However, `loadConversation()` also calls `migrateFromLegacy()` which is useful for first-time migration.

### Mitigations
- Keep the diff minimal — only add calls, no restructuring.
- The fix uses existing, tested methods (`loadConversation()`, `switchWorkspace()`).
- All new code is wrapped in try/catch with warning-level logging.

---

## Files Modified Summary

| File | Change | Lines Affected |
|------|--------|----------------|
| `src/core/eventic-facade.mjs` | Add `conversationManager.switchWorkspace()`, `consciousness` re-init, `resoLangService` re-init, `mcpClientManager` re-init, engine context update to `changeWorkingDirectory()` | ~311-331 — expand to ~311-355 |
| `src/server/ws-handlers/settings-handler.mjs` | Add `loadConversation()` + `listConversations()` calls in both early-return and main paths of `handleSetCwd` | ~306-330 |
| `ui/src/hooks/useChat.ts` | Optimistic clearing of `messages`, `conversations`, `activeConversation` in `setCwd()` | ~364-370 |

**Total estimated diff: ~30 lines added across 3 files. No lines removed. No refactoring.**
