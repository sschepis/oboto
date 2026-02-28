# Refactor Plan: Decompose src/server/web-server.mjs

## Goal
Reduce the size and complexity of `src/server/web-server.mjs` (881 lines) by extracting distinct responsibilities into dedicated modules.

## Strategy
Break down the monolithic server file into a composition of specialized services.

## Modules to Extract

### 1. `src/server/terminal-service.mjs` [COMPLETED]
**Responsibility:** Manage PTY sessions and terminal WebSocket connections.
**Functions to Move:**
- `setupTerminalWebSocket`
- `setupPythonPty`
- `setupDumbShell`
- `pty` import logic

### 2. `src/server/event-broadcaster.mjs` [COMPLETED]
**Responsibility:** Wire up Event Bus events to WebSocket broadcasts.
**Logic to Move:**
- The large `if (eventBus) { ... }` block containing all `eventBus.on(...)` subscriptions.
- `broadcast` helper function (or pass it in).
- `broadcastFileTree` helper.

### 3. `src/server/client-connection.mjs` [COMPLETED]
**Responsibility:** Handle new WebSocket client connections and initial state sync.
**Logic to Move:**
- `wss.on('connection', ...)` handler logic.
- Sending initial history, conversation list, workspace status, etc.

### 4. `src/server/cloud-loader.mjs` [COMPLETED]
**Responsibility:** Lazy-load and initialize CloudSync.
**Logic to Move:**
- `initCloudSync` function.
- `cloudSyncHolder` logic.

## Proposed Structure (`src/server/web-server.mjs`)
The main file will become an orchestrator:
1. Initialize Express & HTTP Server.
2. Initialize WebSocket Servers.
3. Call `TerminalService.attach(terminalWss)`.
4. Call `EventBroadcaster.attach(eventBus, wss)`.
5. Call `ClientConnectionHandler.attach(wss, assistant)`.
6. Start listening.

## Execution Steps
- [x] Create `src/server/terminal-service.mjs`.
- [x] Create `src/server/event-broadcaster.mjs`.
- [x] Create `src/server/client-connection.mjs`.
- [x] Create `src/server/cloud-loader.mjs`.
- [x] Refactor `src/server/web-server.mjs` to import and use these new modules.
- [x] Verify functionality (especially Terminal and UI updates).

## Status
**Completed on 2026-02-26.**
Reduced `src/server/web-server.mjs` from 881 lines to 219 lines.
