# System Manifest (SYSTEM_MAP.md)
Last Updated: 2026-02-20T08:00:00.000Z

## 1. Global Invariants
| ID | Invariant | Description |
|---|---|---|
| INV-REF-001 | Zero Functionality Change | The external behavior of the system must remain exactly the same. |
| INV-REF-002 | Iterative Process | Changes should be applied in small, verifiable steps. |
| INV-REF-003 | Safety First | If a refactor risks breaking functionality, do not proceed without comprehensive testing. |
| INV-REF-004 | Public API Stability | Public API signatures must remain stable unless explicitly refactored with backward compatibility. |
| INV-REF-005 | Test Integrity | Existing tests must pass after every iteration. |

## 2. Feature Registry
| Feature ID | Name | Status | Phase | Lock Level | Priority | Dependencies |
|---|---|---|---|---|---|---|
| FEAT-REF-001 | Codebase Entropy Reduction | Active | Implementation | None | Critical | FEAT-REF-002, FEAT-REF-003, FEAT-REF-004, FEAT-REF-005, FEAT-REF-006, FEAT-REF-007 |
| FEAT-REF-002 | Deduplication & Shared Utilities | Active | Implementation | None | High | - |
| FEAT-REF-003 | Design Pattern Application | Active | Implementation | None | Medium | FEAT-REF-002 |
| FEAT-REF-004 | Consistent Conventions & Formatting | Active | Discovery | None | Low | - |
| FEAT-REF-005 | Dead Code Removal | Active | Implementation | None | Medium | - |
| FEAT-REF-006 | Bug Fixes | Active | Discovery | None | High | - |
| FEAT-REF-007 | Large File Refactoring (>500 lines) | Active | Implementation | None | High | - |

## 3. Dependency Graph
- FEAT-REF-001: Codebase Entropy Reduction
  - FEAT-REF-002: Deduplication & Shared Utilities
  - FEAT-REF-003: Design Pattern Application
  - FEAT-REF-004: Consistent Conventions & Formatting
  - FEAT-REF-005: Dead Code Removal
  - FEAT-REF-006: Bug Fixes
  - FEAT-REF-007: Large File Refactoring (>500 lines)

## 4. State Snapshots
- [2026-02-20T07:25:00.000Z] Initial State Created (bootstrapped from REFACTOR_DESIGN.md)
- [2026-02-20T08:00:00.000Z] Refactored AssistantFacade, removed dead ai-assistant.mjs
