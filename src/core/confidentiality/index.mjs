/**
 * Confidentiality-Aware LLM Routing and Derivation System — barrel export.
 *
 * Phases 1–4: Data models, sensitivity tagger, policy engine, view compiler,
 * task graph/router, lineage tracker, and merge controller.
 *
 * @module src/core/confidentiality
 */

// ── Data Models & Utilities ───────────────────────────────────────────
export {
  // Constants
  SENSITIVITY_LEVELS,
  SENSITIVITY_RANK,
  ARTIFACT_TYPES,
  DEFAULT_ALLOW_ACTION,

  // Comparison utilities
  compareSensitivity,
  maxSensitivity,

  // Factory functions
  createSensitivityMap,
  createSourceArtifact,
  createLineageRecord,
  createAgentProfile,
  createPolicy,

  // Clearance checks
  isClearedForLevel,
  isClearedForCategories,
  checkClearance,
} from './models.mjs';

// ── Sensitivity Tagger ────────────────────────────────────────────────
export { SensitivityTagger } from './sensitivity-tagger.mjs';

// ── Policy Engine ─────────────────────────────────────────────────────
export { PolicyEngine } from './policy-engine.mjs';

// ── View Compiler (Phase 2) ──────────────────────────────────────────
export { ViewCompiler } from './view-compiler.mjs';

// ── Task Graph & Router (Phase 3 — Multi-Agent Routing) ──────────────
export { TaskGraph, createTaskNode, NODE_STATUSES } from './task-graph.mjs';
export { TaskRouter } from './task-router.mjs';

// ── Lineage Tracker & Merge Controller (Phase 4 — Lineage & Merge) ──
export { LineageTracker } from './lineage-tracker.mjs';
export { MergeController } from './merge-controller.mjs';
