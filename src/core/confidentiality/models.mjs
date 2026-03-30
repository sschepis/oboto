/**
 * Core data models for the Confidentiality-Aware LLM Routing and Derivation System.
 *
 * Defines type definitions and factory functions for:
 * - SourceArtifact — envelope wrapping any content entering/exiting an agent
 * - SensitivityMap — classification metadata for content sensitivity
 * - AgentProfile   — clearance and trust boundary for an agent
 * - Policy         — declarative rules for the PolicyEngine
 * - LineageRecord  — provenance chain for artifact tracking
 *
 * @module src/core/confidentiality/models
 */

import crypto from 'crypto';

// ════════════════════════════════════════════════════════════════════════
// Sensitivity Level Ordering
// ════════════════════════════════════════════════════════════════════════

/**
 * Ordered sensitivity levels from least to most sensitive.
 * @type {string[]}
 */
export const SENSITIVITY_LEVELS = ['public', 'internal', 'confidential', 'restricted'];

/**
 * Map of level name to numeric rank for comparison.
 * @type {Object.<string, number>}
 */
export const SENSITIVITY_RANK = Object.fromEntries(
  SENSITIVITY_LEVELS.map((level, idx) => [level, idx])
);

/**
 * Compare two sensitivity levels.
 * @param {string} a
 * @param {string} b
 * @returns {number} negative if a < b, 0 if equal, positive if a > b
 */
export function compareSensitivity(a, b) {
  return (SENSITIVITY_RANK[a] ?? 0) - (SENSITIVITY_RANK[b] ?? 0);
}

/**
 * Return the higher (more sensitive) of two levels.
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
export function maxSensitivity(a, b) {
  return compareSensitivity(a, b) >= 0 ? a : b;
}

// ════════════════════════════════════════════════════════════════════════
// SensitivityMap
// ════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} SpanAnnotation
 * @property {number} start — character offset start
 * @property {number} end   — character offset end
 * @property {string} label — human-readable label, e.g. 'API key'
 */

/**
 * @typedef {Object} SensitivityMap
 * @property {string}   level        — 'public' | 'internal' | 'confidential' | 'restricted'
 * @property {string[]} categories   — e.g. ['pii', 'credentials', 'financial', 'proprietary-code']
 * @property {Object.<string, SpanAnnotation[]>} spans — per-category character-offset spans
 * @property {number}   confidence   — 0-1 classifier confidence
 * @property {string}   classifiedBy — 'auto' | 'user' | 'policy'
 * @property {string}   classifiedAt — ISO 8601
 */

/**
 * Create a default (public, no categories) SensitivityMap.
 *
 * @param {Partial<SensitivityMap>} [overrides]
 * @returns {SensitivityMap}
 */
export function createSensitivityMap(overrides = {}) {
  return {
    level: 'public',
    categories: [],
    spans: {},
    confidence: 1.0,
    classifiedBy: 'auto',
    classifiedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════
// LineageRecord
// ════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} LineageRecord
 * @property {string}   artifactId      — this artifact's ID
 * @property {string[]} parentIds       — IDs of artifacts that contributed to this one
 * @property {string}   derivationType  — 'original' | 'redacted-view' | 'llm-derived' |
 *                                        'tool-result' | 'merged'
 * @property {string}   agentId         — agent that produced this artifact
 * @property {string}   turnId          — turn within the agent loop
 * @property {string}   timestamp       — ISO 8601
 * @property {SensitivityMap} inheritedSensitivity — computed ceiling of parent sensitivities
 */

/**
 * Create a LineageRecord with defaults.
 *
 * @param {Partial<LineageRecord>} [overrides]
 * @returns {LineageRecord}
 */
export function createLineageRecord(overrides = {}) {
  return {
    artifactId: overrides.artifactId || crypto.randomUUID(),
    parentIds: [],
    derivationType: 'original',
    agentId: '',
    turnId: '',
    timestamp: new Date().toISOString(),
    inheritedSensitivity: createSensitivityMap(),
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════
// SourceArtifact
// ════════════════════════════════════════════════════════════════════════

/**
 * Valid artifact types.
 * @type {string[]}
 */
export const ARTIFACT_TYPES = [
  'user-input',
  'history-entry',
  'tool-result',
  'system-prompt',
  'agent-output',
  'file-content',
];

/**
 * @typedef {Object} SourceArtifact
 * @property {string}         id          — UUID v4
 * @property {string}         content     — the raw text/data
 * @property {string}         type        — one of ARTIFACT_TYPES
 * @property {SensitivityMap} sensitivity — classification metadata
 * @property {LineageRecord}  lineage     — provenance chain
 * @property {string}         createdAt   — ISO 8601
 * @property {string}         [agentId]   — owning agent ID
 * @property {string}         [turnId]    — turn identifier within the agent loop
 */

/**
 * Create a SourceArtifact.
 *
 * @param {Object} opts
 * @param {string} opts.content  — raw text/data
 * @param {string} opts.type     — artifact type
 * @param {string} [opts.agentId]
 * @param {string} [opts.turnId]
 * @param {Partial<SensitivityMap>} [opts.sensitivity]
 * @param {Partial<LineageRecord>} [opts.lineage]
 * @returns {SourceArtifact}
 */
export function createSourceArtifact({ content, type, agentId, turnId, sensitivity, lineage } = {}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  return {
    id,
    content: content || '',
    type: type || 'user-input',
    sensitivity: createSensitivityMap(sensitivity),
    lineage: createLineageRecord({ artifactId: id, agentId, turnId, ...lineage }),
    createdAt: now,
    agentId: agentId || undefined,
    turnId: turnId || undefined,
  };
}

// ════════════════════════════════════════════════════════════════════════
// AgentProfile
// ════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} AgentProfile
 * @property {string}   clearanceLevel      — max sensitivity level this agent may see
 *                                            ('public' | 'internal' | 'confidential' | 'restricted')
 * @property {string[]} allowedCategories   — categories the agent is cleared for
 *                                            (e.g. ['pii'] means it CAN see PII; ['*'] = all)
 * @property {string[]} deniedCategories    — explicit deny-list (takes precedence over allowed)
 * @property {string}   trustDomain         — namespace for inter-agent trust evaluation
 *                                            (e.g. 'workspace', 'external', 'sandbox')
 * @property {Object}   [providerConstraints]
 * @property {string[]} [providerConstraints.allowedModels] — allowlist of model IDs
 * @property {boolean}  [providerConstraints.localOnly]     — restrict to local models only
 */

/**
 * Create a default AgentProfile.
 * Default grants full access for backward compatibility.
 *
 * @param {Partial<AgentProfile>} [overrides]
 * @returns {AgentProfile}
 */
export function createAgentProfile(overrides = {}) {
  return {
    clearanceLevel: 'restricted',
    allowedCategories: ['*'],
    deniedCategories: [],
    trustDomain: 'workspace',
    providerConstraints: undefined,
    ...overrides,
  };
}

/**
 * Check whether an agent profile is cleared for a given sensitivity level.
 *
 * @param {AgentProfile} profile
 * @param {string} level — sensitivity level to check
 * @returns {boolean}
 */
export function isClearedForLevel(profile, level) {
  return compareSensitivity(profile.clearanceLevel, level) >= 0;
}

/**
 * Check whether an agent profile is cleared for a given set of categories.
 *
 * @param {AgentProfile} profile
 * @param {string[]} categories — categories to check
 * @returns {boolean}
 */
export function isClearedForCategories(profile, categories) {
  if (!categories || categories.length === 0) return true;

  for (const cat of categories) {
    // Denied categories take precedence
    if (profile.deniedCategories.includes(cat)) return false;

    // Allowed = ['*'] means all categories are allowed
    if (!profile.allowedCategories.includes('*') && !profile.allowedCategories.includes(cat)) {
      return false;
    }
  }
  return true;
}

/**
 * Full clearance check: level + categories.
 *
 * @param {AgentProfile} profile
 * @param {SensitivityMap} sensitivity
 * @returns {{ cleared: boolean, reason: string }}
 */
export function checkClearance(profile, sensitivity) {
  if (!isClearedForLevel(profile, sensitivity.level)) {
    return {
      cleared: false,
      reason: `Agent clearance "${profile.clearanceLevel}" is insufficient for "${sensitivity.level}" content`,
    };
  }

  if (!isClearedForCategories(profile, sensitivity.categories)) {
    const blocked = sensitivity.categories.filter(
      cat => profile.deniedCategories.includes(cat) ||
        (!profile.allowedCategories.includes('*') && !profile.allowedCategories.includes(cat))
    );
    return {
      cleared: false,
      reason: `Agent is not cleared for categories: ${blocked.join(', ')}`,
    };
  }

  return { cleared: true, reason: '' };
}

// ════════════════════════════════════════════════════════════════════════
// Policy
// ════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} PolicyCondition
 * @property {string}   [sensitivityLevel] — match artifacts at or above this level
 * @property {string[]} [categories]       — match artifacts with any of these categories
 * @property {string}   [artifactType]     — match specific artifact types
 * @property {string}   [agentTrustDomain] — match agents in a specific trust domain
 */

/**
 * @typedef {Object} PolicyAction
 * @property {string} type — 'redact' | 'mask' | 'summarize' | 'block' | 'allow'
 * @property {Object} [params]
 * @property {string} [params.replacement]   — replacement text for redact/mask
 * @property {string} [params.summaryPrompt] — LLM prompt for summarize action
 */

/**
 * @typedef {Object} Policy
 * @property {string}          id        — unique policy ID
 * @property {string}          name      — human-readable name
 * @property {number}          priority  — lower = higher priority
 * @property {PolicyCondition} condition — when this policy applies
 * @property {PolicyAction}    action    — what to do
 */

/**
 * Create a Policy object with defaults.
 *
 * @param {Partial<Policy>} [overrides]
 * @returns {Policy}
 */
export function createPolicy(overrides = {}) {
  return {
    id: overrides.id || crypto.randomUUID(),
    name: overrides.name || 'Unnamed Policy',
    priority: overrides.priority ?? 100,
    condition: {
      sensitivityLevel: undefined,
      categories: undefined,
      artifactType: undefined,
      agentTrustDomain: undefined,
      ...(overrides.condition || {}),
    },
    action: {
      type: 'allow',
      params: undefined,
      ...(overrides.action || {}),
    },
  };
}

/**
 * Default allow-all action (returned when no policy matches).
 * @type {PolicyAction}
 */
export const DEFAULT_ALLOW_ACTION = Object.freeze({ type: 'allow', params: undefined });
