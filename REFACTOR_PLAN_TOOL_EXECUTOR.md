# Refactor Plan: Decompose src/execution/tool-executor.mjs

## Goal
Reduce the size and complexity of `src/execution/tool-executor.mjs` (~730 lines) by extracting distinct responsibilities into dedicated modules.

## Strategy
Break down the `ToolExecutor` into a composition of specialized services for registration, execution, security, and confirmation.

## Modules to Extract

### 1. `src/execution/tool-registry.mjs`
**Responsibility:** Manage the registration of core, custom, plugin, and MCP tools.
**Logic to Move:**
- `registerBuiltInTools` method (and the large list of registrations).
- `toolRegistry` map management.
- `registerTool`, `registerPluginTool`, `unregisterPluginTool`.
- `getAllToolDefinitions`.
- `getToolFunction`.

### 2. `src/execution/tool-security.mjs`
**Responsibility:** Handle security checks and path validation.
**Logic to Move:**
- `_validatePathAccess` method.
- `allowedPaths` management.
- `requestConfirmation` and `resolveConfirmation` (or delegate to a ConfirmationManager).
- `pendingConfirmations` map.

### 3. `src/execution/tool-runner.mjs`
**Responsibility:** Execute tools with timeouts, cancellation, and error handling.
**Logic to Move:**
- `executeTool` and `_executeToolInner` methods.
- Timeout management (`TOOL_TIMEOUTS`).
- `dryRun` logic (or keep it in a shared config).
- Plugin execution wrapper.
- MCP execution wrapper.

## Proposed Structure (`src/execution/tool-executor.mjs`)
The `ToolExecutor` will become a high-level facade:
1. Initialize `ToolRegistry`.
2. Initialize `ToolSecurity`.
3. Initialize `ToolRunner` (injected with Registry and Security).
4. Delegate `executeTool` calls to `ToolRunner`.

## Execution Steps
1. Create `src/execution/tool-security.mjs`.
2. Create `src/execution/tool-registry.mjs`.
3. Create `src/execution/tool-runner.mjs`.
4. Refactor `src/execution/tool-executor.mjs` to use these new modules.
5. Verify tool execution functionality.
