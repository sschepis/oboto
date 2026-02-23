# Oboto (ai-man) — Duplicate Code Analysis

> **Generated**: 2026-02-23  
> **Based on**: [`docs/SOURCE_FILE_INVENTORY.md`](SOURCE_FILE_INVENTORY.md)

This document identifies all significant duplicate code across the project, categorized by severity and type.

---

## Executive Summary

The project contains **7 major duplication clusters** and **4 pervasive micro-patterns** that are copy-pasted across dozens of files. The most severe duplication is between the `src/project-management/` and `src/structured-dev/` modules, which are parallel implementations of nearly identical concepts (bootstrapping, manifests, scheduling, phase control). Consolidating these could eliminate ~2,000 lines of code.

### Impact Summary

| Severity | Count | Estimated Duplicate LOC |
|----------|-------|------------------------|
| 🔴 HIGH (structural duplication) | 4 | ~1,800 lines |
| 🟡 MEDIUM (algorithmic duplication) | 3 | ~400 lines |
| 🔵 LOW (micro-patterns) | 4 | ~200 lines |
| ⚪ DEAD CODE | 3 | ~180 lines |
| **Total** | **14** | **~2,580 lines** |

---

## 🔴 HIGH — Structural Duplication

These are cases where entire classes or modules are near-copies of each other with minor variations.

---

### DUP-1: `ProjectBootstrapper` — Two Parallel Implementations

| File | Class | Lines | Manifest Target |
|------|-------|-------|-----------------|
| [`src/project-management/project-bootstrapper.mjs`](../src/project-management/project-bootstrapper.mjs) | `ProjectBootstrapper` | 557 | `PROJECT_MAP.md` |
| [`src/structured-dev/project-bootstrapper.mjs`](../src/structured-dev/project-bootstrapper.mjs) | `ProjectBootstrapper` | 523 | `SYSTEM_MAP.md` |

**Overlap**: ~70% code similarity. Both implementations:

| Method (project-management) | Method (structured-dev) | Logic Similarity |
|----------------------------|------------------------|------------------|
| `bootstrap()` | `bootstrap()` | ~80% — same flow: find doc → parse → extract → create manifest |
| `findProjectDoc()` | `discoverDesignFile()` | ~60% — same glob patterns for markdown/txt/pdf |
| `parseDocument()` | `parseDesignDoc()` | ~90% — **identical** markdown parser (heading extraction, section splitting) |
| `extractBullets()` | `extractFeaturesFromBullets()` | ~85% — same bullet-point regex extraction |
| `detectConstraints()` | `detectConstraints()` | ~70% — same keyword scanning patterns |

**Key difference**: The project-management version is generalized (goals, deliverables, risks) while structured-dev is software-specific (features, invariants, phases). Both parse markdown documents into structured data using the same techniques.

**Recommendation**: Create a shared `BaseBootstrapper` class with the common document parsing logic. Both versions extend it with domain-specific extraction.

---

### DUP-2: `ProjectManifest` vs `ManifestManager` — Dual Manifest Systems

| File | Class | Lines | Manifest File |
|------|-------|-------|---------------|
| [`src/project-management/project-manifest.mjs`](../src/project-management/project-manifest.mjs) | `ProjectManifest` | 565 | `PROJECT_MAP.md` |
| [`src/structured-dev/manifest-manager.mjs`](../src/structured-dev/manifest-manager.mjs) | `ManifestManager` | 400 | `SYSTEM_MAP.md` |

**Overlap**: ~65% code similarity. Duplicated methods:

| Method | `ProjectManifest` Line | `ManifestManager` Line | Similarity |
|--------|----------------------|----------------------|------------|
| `hasManifest()` | ✓ | ✓ | 95% — identical fs.existsSync check |
| `readManifest()` | ✓ | ✓ | 90% — identical readFile + return |
| `createManifest()` | `createManifest()` | `init()` / `initFromBootstrap()` | 70% — same template string building |
| `updateSection()` | ✓ | ✓ | 85% — identical regex replace + snapshot |
| `createSnapshot()` | L505 | L334 | 90% — identical snapshot-dir creation + file copy |
| `listSnapshots()` | L541 | L395 | 95% — identical readdir + sort |
| `restoreSnapshot()` | L551 | L367 | 90% — identical copyFile restore |
| `buildTable()` | L496 | inline (L207, L297) | 80% — same header+separator+rows pattern |
| `.cursorrules` creation | L200-230 | L89-98, L179-183 | 60% — different templates, same creation logic |

**Key difference**: `ProjectManifest` tracks goals/deliverables/tasks/risks/decisions (general PM). `ManifestManager` tracks features/invariants/phases (software dev). The underlying file operations are identical.

**Recommendation**: Extract a `BaseManifest` class with shared `readManifest()`, `hasManifest()`, `updateSection()`, `createSnapshot()`, `listSnapshots()`, `restoreSnapshot()`, and `buildTable()`. Both classes extend it with domain-specific sections.

---

### DUP-3: Topological Sort / Execution Planning — Two Implementations

| File | Method | Lines | Data Source |
|------|--------|-------|-------------|
| [`src/project-management/task-scheduler.mjs`](../src/project-management/task-scheduler.mjs):179 | `createExecutionPlan()` | ~160 | `ProjectManifest` tasks |
| [`src/structured-dev/implementation-planner.mjs`](../src/structured-dev/implementation-planner.mjs):129 | `scheduleTasks()` | ~95 | `ManifestManager` features |

**Overlap**: ~75% algorithmic similarity. Both implement:

1. Build adjacency list from dependency graph
2. Calculate in-degree for each node
3. Initialize ready queue with in-degree-0 nodes
4. While ready queue is not empty:
   - Sort by priority/heuristic
   - Take up to `numParallel`/`numDevelopers` tasks
   - Add to current stage
   - Decrement in-degrees of dependents
   - Add newly-ready tasks to queue
5. Detect cycles via remaining non-zero in-degrees

The `TaskScheduler` version adds critical path calculation and output file saving. The `ImplementationPlanner` version sorts by dependent count as heuristic.

**Recommendation**: Extract a shared `topologicalSchedule(nodes, getDeps, numParallel, sortFn)` utility function. Both planners call it with their domain-specific configuration.

---

### DUP-4: Phase/Flow Control — Parallel Lifecycle Management

| File | Class | Lines | Domain |
|------|-------|-------|--------|
| [`src/project-management/phase-controller.mjs`](../src/project-management/phase-controller.mjs) | `PhaseController` | 552 | General projects (INITIATION→PLANNING→EXECUTION→MONITORING→CLOSING) |
| [`src/structured-dev/flow-manager.mjs`](../src/structured-dev/flow-manager.mjs) | `FlowManager` | 460 | Software dev (DESIGN→REVIEW→IMPLEMENT→VERIFY→DEPLOY) |

**Overlap**: ~50% structural similarity. Both share:

| Pattern | `PhaseController` | `FlowManager` |
|---------|-------------------|----------------|
| Phase enum definition | `PROJECT_PHASES` | `static PHASES` |
| Phase transition validation | `validateTransition()` | implicit in submit/approve methods |
| Hook execution | `executeHooks(event, context)` L91 | `executeHooks(event, context)` L52 |
| Status update generation | `getProgressReport()` | `generateStatusUpdate()` |
| Manifest read/write | via `this.manifest` | via `this.manifestManager` |

**Key difference**: `FlowManager` has a design-review-approval workflow (submit → critique → approve → lock interfaces). `PhaseController` has a simpler linear phase model with requirements checking.

**Recommendation**: Extract a shared `BasePhaseManager` with hook execution, phase tracking, and manifest integration. Both classes extend it with domain-specific workflows.

---

## 🟡 MEDIUM — Algorithmic Duplication

These are cases where the same algorithm or pattern is reimplemented across multiple files.

---

### DUP-5: Markdown Table Parsing — 5+ Independent Implementations

The exact same pattern — split lines by `|`, filter empties, extract columns — is reimplemented in at least 5 files:

| File | Line(s) | Context |
|------|---------|---------|
| [`src/project-management/project-manifest.mjs`](../src/project-management/project-manifest.mjs):287-314 | `parseTableSection()` — generic parser with header detection |
| [`src/project-management/surface-generator.mjs`](../src/project-management/surface-generator.mjs):30-32, 138-140, 202-204, 255-257, 436-438, 538-540 | **6 separate inline parsers** for different table sections |
| [`src/structured-dev/manifest-manager.mjs`](../src/structured-dev/manifest-manager.mjs):207-229, 297-324 | 2 inline parsers for invariants and features tables |
| [`src/structured-dev/project-bootstrapper.mjs`](../src/structured-dev/project-bootstrapper.mjs):329 | Inline parser for feature extraction |
| [`src/server/ws-helpers.mjs`](../src/server/ws-helpers.mjs):267, 293 | 2 inline parsers for project data extraction |

**Total**: ~11 separate inline markdown table parsers doing essentially:
```javascript
const lines = text.split('\n').filter(l => l.trim().startsWith('|'));
// skip header + separator
const cols = line.split('|').map(c => c.trim()).filter(c => c);
```

**Recommendation**: Create a shared `parseMarkdownTable(text)` utility that returns `{ headers: string[], rows: Record<string, string>[] }`. All 11 call sites collapse to a single import.

---

### DUP-6: Markdown Table Building — 3 Implementations

| File | Method/Location | Pattern |
|------|----------------|---------|
| [`src/project-management/project-manifest.mjs`](../src/project-management/project-manifest.mjs):496 | `buildTable(headers, rows)` — generic, reusable |
| [`src/structured-dev/manifest-manager.mjs`](../src/structured-dev/manifest-manager.mjs):207-229 | Inline: `headerRow` + `separatorRow` + data rows (invariants) |
| [`src/structured-dev/manifest-manager.mjs`](../src/structured-dev/manifest-manager.mjs):297-324 | Inline: `headerRow` + `separatorRow` + data rows (features) |

All three build markdown tables with the same `| col1 | col2 |` + `|---|---|` + `| data | data |` pattern.

**Recommendation**: Use `ProjectManifest.buildTable()` (or extract it as a standalone utility) and import it everywhere.

---

### DUP-7: ID Generation — 12+ Copy-Pasted Patterns

The pattern `Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, N)` is copy-pasted across:

| File | Line | Pattern |
|------|------|---------|
| [`src/core/resolang-service.mjs`](../src/core/resolang-service.mjs):124 | `Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9)` |
| [`src/core/resolang-service.mjs`](../src/core/resolang-service.mjs):253 | Same pattern again |
| [`src/core/checkpoint-store.mjs`](../src/core/checkpoint-store.mjs):101,212,303 | 3 instances of `Date.now()-Math.random().toString(36).substr(2, 5)` for temp files |
| [`src/core/task-manager.mjs`](../src/core/task-manager.mjs):23 | `task-${Date.now()}-${Math.random().toString(36).substr(2, 4)}` |
| [`src/core/eventic-tools-plugin.mjs`](../src/core/eventic-tools-plugin.mjs):48 | `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` |
| [`src/core/scheduler-service.mjs`](../src/core/scheduler-service.mjs):92 | `schedule-${Date.now()}-${Math.random().toString(36).substr(2, 4)}` |
| [`src/core/ai-provider.mjs`](../src/core/ai-provider.mjs):805 | `webllm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` |
| [`src/project-management/project-manifest.mjs`](../src/project-management/project-manifest.mjs):135-136 | `generateId(prefix)` method — **the only reusable version** |

**Recommendation**: Move `ProjectManifest.generateId()` to a shared utility (e.g., `src/lib/utils.mjs`) and import everywhere. Or use `crypto.randomUUID()` for Node 19+.

---

## 🔵 LOW — Micro-Pattern Duplication

These are small patterns repeated pervasively but are individually low-impact.

---

### DUP-8: `.cursorrules` File Creation — 2 Templates

| File | Line | Template |
|------|------|----------|
| [`src/project-management/project-manifest.mjs`](../src/project-management/project-manifest.mjs):200-230 | General project rules template |
| [`src/structured-dev/manifest-manager.mjs`](../src/structured-dev/manifest-manager.mjs):9-26, 89-98 | `CURSOR_RULES_TEMPLATE` — software-specific rules |

Both independently write `.cursorrules` files with different templates but the same `fs.promises.writeFile()` logic. If both modules are used in the same workspace, they'll overwrite each other's `.cursorrules`.

**Recommendation**: Unify `.cursorrules` creation into a single function that merges rules from multiple sources, or make the templates composable.

---

### DUP-9: `ws.send(JSON.stringify({...}))` — Pervasive WebSocket Boilerplate

Across all 16 WebSocket handler files in `src/server/ws-handlers/`, the pattern:
```javascript
ws.send(JSON.stringify({ type: 'some-type', payload: data }));
```
appears **60+ times** without any helper function.

**Files affected**: All files in [`src/server/ws-handlers/`](../src/server/ws-handlers/)

**Recommendation**: Create a helper like:
```javascript
function send(ws, type, payload) { ws.send(JSON.stringify({ type, payload })); }
```
This already partially exists in `ws-helpers.mjs` but isn't used by the handlers.

---

### DUP-10: `fs.promises.readFile(path, 'utf8')` — 60 Instances

The exact pattern `await fs.promises.readFile(somePath, 'utf8')` appears 60 times across the codebase with no centralized wrapper.

**Recommendation**: Not critical — this is a standard Node.js API call. But a `readTextFile(path)` utility would reduce repetition and provide a single point for adding error handling or encoding logic.

---

### DUP-11: `consoleStyler` Import — 57 Files

```javascript
import consoleStyler from '../ui/console-styler.mjs';
```

This is imported in 57 files. While not strictly "duplicate code," it's a cross-cutting concern that could benefit from dependency injection rather than direct imports, especially for testing.

**Not actionable** — this is a standard module import pattern and isn't truly duplication.

---

## ⚪ DEAD CODE — Unused Files

These files are either never imported, contain only stubs, or duplicate exports.

---

### DEAD-1: `src/core/conversation-lock.mjs` — Never Imported

| File | Lines | Status |
|------|-------|--------|
| [`src/core/conversation-lock.mjs`](../src/core/conversation-lock.mjs) | 63 | **Zero imports anywhere in the project** |

Exports a `ConversationLock` class for per-conversation serialization. Well-implemented but never used. This was likely written as a planned enhancement for concurrent conversation handling but never integrated.

**Recommendation**: Either integrate it into `ConversationController`/`ConversationManager` (where it would be useful) or delete it.

---

### DEAD-2: TypeScript Stub Files — Never Used

| File | Lines | Content |
|------|-------|---------|
| [`src/gateway/openClawGateway.ts`](../src/gateway/openClawGateway.ts) | 10 | Empty stub class, zero references |
| [`src/service/nexusService.ts`](../src/service/nexusService.ts) | 39 | Stub class, referenced only by its own test |
| [`src/client/main.ts`](../src/client/main.ts) | 18 | Placeholder re-export |
| [`src/client/projectManager.ts`](../src/client/projectManager.ts) | 44 | Placeholder class, referenced only by its own test |
| [`src/types/nexus.d.ts`](../src/types/nexus.d.ts) | 19 | Type declarations for unused Nexus concept |

Total: ~130 lines of dead stub code. These appear to be remnants of a planned "Nexus" feature that was never implemented.

**Recommendation**: Delete these files (and their tests) or implement the Nexus feature.

---

### DEAD-3: `src/core/assistant-facade.mjs` — Trivial Re-export

| File | Lines | Content |
|------|-------|---------|
| [`src/core/assistant-facade.mjs`](../src/core/assistant-facade.mjs) | 4 | Re-exports `EventicFacade` as `AssistantFacade` and `MiniAIAssistant` |

This file exists only for backward compatibility. It's referenced by JSDoc `@import` comments in 3 files but never actually imported at runtime.

**Recommendation**: Update the JSDoc references to point to `eventic-facade.mjs` directly and delete this file.

---

## Consolidation Roadmap

### Phase 1: Quick Wins (Low Risk, High Impact)
1. **Extract `parseMarkdownTable()` utility** → eliminates 11 inline parsers (~100 LOC saved)
2. **Extract `buildMarkdownTable()` utility** → eliminates 3 implementations (~30 LOC saved)
3. **Extract `generateId(prefix)` utility** → eliminates 12 copy-pasted patterns (~50 LOC saved)
4. **Add `wsSend(ws, type, payload)` helper** → simplifies 60+ WebSocket sends
5. **Delete dead code** (DEAD-1, DEAD-2, DEAD-3) → removes ~200 lines of unused code

### Phase 2: Moderate Refactor (Medium Risk)
6. **Create `BaseManifest` class** → unify `ProjectManifest` and `ManifestManager` (~400 LOC saved)
7. **Create `BaseBootstrapper` class** → unify both `ProjectBootstrapper` implementations (~300 LOC saved)
8. **Extract `topologicalSchedule()` utility** → unify `TaskScheduler` and `ImplementationPlanner` (~100 LOC saved)

### Phase 3: Architecture Decision (Higher Risk)
9. **Decide**: Should `src/project-management/` and `src/structured-dev/` be merged into one module?
   - **Option A**: Merge into a single `src/dev-management/` module with a config flag for general vs. software projects
   - **Option B**: Keep separate but have both extend shared base classes (Phase 2)
   - **Option C**: Deprecate `src/project-management/` as an experimental branch and standardize on `src/structured-dev/`

---

## Summary Table

| ID | Severity | Files Involved | Duplicate LOC | Effort to Fix |
|----|----------|---------------|---------------|---------------|
| DUP-1 | 🔴 HIGH | 2 bootstrappers | ~500 | Medium |
| DUP-2 | 🔴 HIGH | 2 manifest managers | ~400 | Medium |
| DUP-3 | 🔴 HIGH | 2 schedulers/planners | ~200 | Low |
| DUP-4 | 🔴 HIGH | 2 phase/flow controllers | ~300 | High |
| DUP-5 | 🟡 MEDIUM | 5+ files, 11 parsers | ~150 | Low |
| DUP-6 | 🟡 MEDIUM | 3 table builders | ~50 | Low |
| DUP-7 | 🟡 MEDIUM | 12+ ID generators | ~50 | Low |
| DUP-8 | 🔵 LOW | 2 cursorrules templates | ~30 | Low |
| DUP-9 | 🔵 LOW | 16 WS handler files | ~100 | Low |
| DUP-10 | 🔵 LOW | 60 readFile calls | ~60 | Skip |
| DUP-11 | 🔵 LOW | 57 consoleStyler imports | N/A | Skip |
| DEAD-1 | ⚪ DEAD | conversation-lock.mjs | 63 | Trivial |
| DEAD-2 | ⚪ DEAD | 5 TypeScript stubs | ~130 | Trivial |
| DEAD-3 | ⚪ DEAD | assistant-facade.mjs | 4 | Trivial |
