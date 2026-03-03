# Log Issues — Task List

Identified from runtime log analysis on 2026-03-01. Tasks ordered by severity.

---

## 🔴 Critical: Fix Server Crash from VM2 Unhandled Rejection

### Task 1: Harden `executeJavaScript` VM2 error handling
**File:** `src/execution/handlers/core-handlers.mjs`  
**What:** The async IIFE wrapper (`wrappedCode`) can reject with a `ReferenceError` that escapes the `try/catch` as an unhandled promise rejection. Ensure the `await vm.run(wrappedCode)` result is properly caught, including rejections from the inner async IIFE.  
**Action:**
- Wrap the `vm.run()` call with an explicit `.catch()` to convert sandbox errors into caught exceptions
- Add a safety net: if `toolResult` is a thenable, ensure its rejection is caught before it can escape as an unhandled rejection

### Task 2: Add `ReferenceError` / sandbox errors to the transient-error safe-list
**File:** `src/main.mjs`  
**What:** The `unhandledRejection` handler (line 223) counts non-transient errors toward a 10-per-minute crash threshold. VM2 sandbox `ReferenceError`s (`is not defined`) are not system-fatal and should not contribute to the crash counter.  
**Action:**
- Add `msg.includes('is not defined')` (or similar pattern for VM sandbox errors) to the transient error check at line 246
- Consider adding a broader `msg.includes('Execution error:')` check to catch all re-thrown VM errors

### Task 3: Add `surfaceApi` stub to VM2 sandbox
**File:** `src/execution/handlers/core-handlers.mjs`  
**What:** AI-generated code may reference `surfaceApi` (a front-end-only module). Provide a no-op stub in the sandbox to prevent `ReferenceError`.  
**Action:**
- Add `surfaceApi: {}` to the `sandbox` object at line 157
- Consider also adding `UI: {}` and other front-end globals as stubs

---

## 🟡 Warning: Monolithic JS Bundle (3.8 MB)

### Task 4: Configure Vite manual chunks for code splitting
**File:** `ui/vite.config.ts`  
**What:** All 3,778 modules compile into a single 3.8 MB JS file. Vite explicitly warns about this.  
**Action:**
- Add `build.rollupOptions.output.manualChunks` to split vendor libraries (react, react-dom, katex, codemirror, sucrase, etc.) into separate chunks
- Verify that lazy-loaded routes/features produce separate chunks after the change
- Run `pnpm --filter ui build` and verify chunk sizes are below 500 kB

---

## 🟡 Warning: Mixed Static/Dynamic Import of surfaceCompiler

### Task 5: Unify import style for `surfaceCompiler.ts`
**Files:** `ui/src/components/features/PluginHost.tsx`, `ui/src/components/features/surface/ComponentWrapper.tsx`  
**What:** `surfaceCompiler.ts` is dynamically imported by `PluginHost.tsx` and statically imported by `ComponentWrapper.tsx`. Vite warns the dynamic import won't produce a separate chunk.  
**Action:**
- Decide on one import strategy: either make both static (simplest, since it's already bundled) or make both dynamic via `React.lazy()`
- If both static: change the `import()` in `PluginHost.tsx` to a regular `import` statement
- If both dynamic: change the `import` in `ComponentWrapper.tsx` to use `React.lazy()` or `import()`

---

## 🟡 Warning: Recurring Task Workspace Mismatch

### Task 6: Fix `optimize_ecdsa_error_rate` recurring task workspace configuration
**Files:** `src/core/scheduler-service.mjs`, runtime schedule configuration  
**What:** The recurring task repeatedly tries to access files at `/Users/sschepis/Development/ecdsa/` while the workspace is set to `/Users/sschepis/Development/tinyaleph/apps/ecdsa`. Every file read/write is blocked by the security sandbox, causing the task to silently fail every 5 minutes and waste API credits.  
**Action:**
- Either update the task's workspace path to match where the ECDSA files actually reside, or remove/pause the schedule
- Verify via the `manage_recurring_task` tool or by editing the persisted schedule data

### Task 7: Add circuit breaker for repeatedly-failing recurring tasks
**File:** `src/core/scheduler-service.mjs` or `src/core/task-checkpoint-manager.mjs`  
**What:** A recurring task that fails N consecutive times should auto-pause itself instead of running indefinitely.  
**Action:**
- Track consecutive failure count per schedule
- After 3-5 consecutive failures, auto-pause the schedule and emit a notification
- Log a warning explaining why the schedule was paused

### Task 8: Add exponential backoff for Gemini 503 errors
**Files:** AI provider / agentic provider code  
**What:** The Gemini API returns `503 UNAVAILABLE` (high demand), but the task immediately retries or re-spawns without backoff.  
**Action:**
- Add exponential backoff (e.g., 2s → 4s → 8s → 16s) for 503/429 status codes from Gemini
- Cap at a reasonable maximum (e.g., 60s)

---

## 🟠 Minor: Dual API Key Warning

### Task 9: Remove duplicate Gemini API key
**File:** `.env` (not tracked) or `.env.example`  
**What:** Both `GOOGLE_API_KEY` and `GEMINI_API_KEY` are set, producing a stderr warning on every startup.  
**Action:**
- Keep only `GOOGLE_API_KEY` (which takes precedence) and remove `GEMINI_API_KEY`, or vice versa
- Update `.env.example` documentation to clarify which key to use

---

## 🟢 Info: vm2 Deprecation

### Task 10: Evaluate migration from `vm2` to a maintained sandbox
**File:** `src/execution/handlers/core-handlers.mjs`  
**What:** `vm2` is deprecated and has known sandbox-escape CVEs (CVE-2023-37466, CVE-2023-37903).  
**Action:**
- Evaluate `isolated-vm` as a replacement (better security, actively maintained)
- Scope the migration: the sandbox interface is localized to `executeJavaScript()` (~40 lines), making it a contained change
- This is lower priority but should be tracked for a future security audit

---

## Summary

| # | Severity | Task | File(s) |
|---|----------|------|---------|
| 1 | 🔴 Critical | Harden VM2 error handling | `core-handlers.mjs` |
| 2 | 🔴 Critical | Add sandbox errors to safe-list | `main.mjs` |
| 3 | 🔴 Critical | Add `surfaceApi` stub to sandbox | `core-handlers.mjs` |
| 4 | 🟡 Warning | Configure Vite code splitting | `vite.config.ts` |
| 5 | 🟡 Warning | Unify surfaceCompiler import style | `PluginHost.tsx`, `ComponentWrapper.tsx` |
| 6 | 🟡 Warning | Fix recurring task workspace | scheduler config |
| 7 | 🟡 Warning | Add circuit breaker for failing tasks | `scheduler-service.mjs` |
| 8 | 🟡 Warning | Add Gemini 503 backoff | AI provider |
| 9 | 🟠 Minor | Remove duplicate API key | `.env` |
| 10 | 🟢 Info | Evaluate vm2 replacement | `core-handlers.mjs` |
