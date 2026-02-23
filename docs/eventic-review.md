# Eventic Integration Architecture Review

## Overview
A review of the current Eventic integration (`src/core/eventic.mjs`, `src/core/eventic-facade.mjs`, and associated plugins) reveals that while the system successfully adopts the event-driven dispatch mechanism, several critical anti-patterns remain regarding dependency injection and state management.

## Findings

### 1. Event Dispatching & State Transitions (✅ Good)
The system properly decomposes the agent loop into discrete event handlers:
- `AGENT_START`
- `ACTOR_CRITIC_LOOP`
- `EXECUTE_TOOLS`
- `CRITIC_EVALUATE_TOOLS`
- `EVALUATE_TEXT_RESPONSE`

It uses recursive `dispatch()` calls (e.g., `dispatch('ACTOR_CRITIC_LOOP')` or `dispatch('EXECUTE_TOOLS')`) to transition between states. This correctly leverages Eventic's non-procedural philosophy.

### 2. Context & State Management (⚠️ Mixed)
- **Good**: Most ephemeral state (`turnNumber`, `toolCallCount`, `completedActions`, `errors`) is correctly stored on `ctx` instead of class instances.
- **Anti-Pattern**: The `ConsciousnessProcessor` is initialized lazily inside `AGENT_START`. It manually calculates its directory using `ctx.facade ? ctx.facade.workingDir : process.cwd()`. This logic violates inversion of control and should be handled externally or via an Eventic plugin.

### 3. Hardcoding Dependencies & Bypassing Plugin Architecture (❌ Anti-Pattern)
- **Anti-Pattern**: `EventicFacade` injects `facade: this` directly into `eventic.context`. This tightly couples the Eventic engine back to the legacy wrapper.
- **Anti-Pattern**: `EventicAgentLoopPlugin` constantly reaches into `ctx.facade` to access system primitives (e.g., `ctx.facade.allTools`, `ctx.facade.workingDir`, `ctx.facade.eventBus`). 
- **Anti-Pattern**: Tool definitions are pulled from the facade rather than from the tools plugin (`EventicToolsPlugin`). Eventic has no built-in knowledge of the tools because the loop fetches them procedurally from the legacy interface.

## Action Plan (Corrections to be made in Code Mode)

1. **Remove Facade Injection**:
   - Remove `facade: this` from the Eventic initialization in `eventic-facade.mjs`.

2. **Decouple EventicAgentLoopPlugin**:
   - Replace all `ctx.facade.*` references.
   - Inject `workingDir` and `eventBus` strictly into `eventic.context`.
   - Instantiate `ConsciousnessProcessor` during engine setup and inject it directly into the context (`ctx.consciousness = new ConsciousnessProcessor(...)`).

3. **Refactor EventicToolsPlugin**:
   - Augment `EventicToolsPlugin.install(eventic)` to expose a native method (e.g., `eventic.getAvailableTools = () => this.toolExecutor.getAllToolDefinitions()`).
   - Modify `EventicAgentLoopPlugin` to call `engine.getAvailableTools()` instead of relying on `ctx.facade.allTools`.

By applying these fixes, the Eventic implementation will be fully decoupled, modular, and adherent to the core event-driven philosophy outlined in `eventic.mjs`.

## Resolution

All three anti-patterns identified in the Action Plan have been addressed:

1. **`facade: this` removed from Eventic initialization** — `eventic-facade.mjs` no longer injects the facade instance into the Eventic context.
2. **`EventicAgentLoopPlugin` no longer references `ctx.facade`** — all `ctx.facade.*` accesses have been replaced with direct context properties (`ctx.workingDir`, `ctx.eventBus`, etc.) and proper plugin APIs.
3. **`EventicToolsPlugin` exposes `engine.getAvailableTools()`** — the tools plugin now installs a native `getAvailableTools()` method on the engine, and the agent-loop plugin consumes it instead of reaching through the legacy facade.