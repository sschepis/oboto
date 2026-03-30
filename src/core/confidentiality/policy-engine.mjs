/**
 * PolicyEngine — evaluates declarative policy rules against artifacts
 * and agent profiles to determine appropriate actions (allow, redact,
 * mask, summarize, block).
 *
 * Policies are loaded from a JSON file or a built-in defaults module.
 * Evaluation returns the highest-priority matching action.
 *
 * @module src/core/confidentiality/policy-engine
 */

import fs from 'fs';
import {
  createPolicy,
  compareSensitivity,
  DEFAULT_ALLOW_ACTION,
  checkClearance,
} from './models.mjs';

// ════════════════════════════════════════════════════════════════════════
// Built-in Default Policies
// ════════════════════════════════════════════════════════════════════════

/**
 * Minimal built-in policies that apply when no workspace policies file
 * is found. These provide baseline protection for credentials and PII.
 *
 * @type {import('./models.mjs').Policy[]}
 */
const BUILTIN_POLICIES = [
  createPolicy({
    id: 'builtin-block-restricted',
    name: 'Block restricted content from non-restricted agents',
    priority: 1,
    condition: { sensitivityLevel: 'restricted' },
    action: { type: 'block' },
  }),
  createPolicy({
    id: 'builtin-redact-credentials',
    name: 'Redact credentials from agents without credentials clearance',
    priority: 10,
    condition: { categories: ['credentials'], sensitivityLevel: 'confidential' },
    action: { type: 'redact', params: { replacement: '[REDACTED:credential]' } },
  }),
  createPolicy({
    id: 'builtin-mask-pii',
    name: 'Mask PII for agents without PII clearance',
    priority: 20,
    condition: { categories: ['pii'], sensitivityLevel: 'internal' },
    action: { type: 'mask', params: { replacement: '[PII:***]' } },
  }),
  createPolicy({
    id: 'builtin-redact-financial',
    name: 'Redact financial data from agents without financial clearance',
    priority: 15,
    condition: { categories: ['financial'], sensitivityLevel: 'confidential' },
    action: { type: 'redact', params: { replacement: '[REDACTED:financial]' } },
  }),
];

// ════════════════════════════════════════════════════════════════════════
// PolicyEngine Class
// ════════════════════════════════════════════════════════════════════════

export class PolicyEngine {
  /**
   * @param {import('./models.mjs').Policy[]} [policies] — initial policy set sorted by priority
   */
  constructor(policies = []) {
    /** @type {import('./models.mjs').Policy[]} */
    this._policies = policies.length > 0
      ? [...policies].sort((a, b) => a.priority - b.priority)
      : [...BUILTIN_POLICIES].sort((a, b) => a.priority - b.priority);
  }

  /**
   * Load policies from a JSON file. If the file does not exist,
   * falls back to built-in policies silently.
   *
   * @param {string} [filePath] — path to policies JSON file
   * @returns {Promise<void>}
   */
  async loadPolicies(filePath) {
    if (!filePath) {
      return; // keep current policies
    }

    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        console.warn(`[PolicyEngine] Policies file must contain a JSON array. Keeping defaults.`);
        return;
      }

      // Validate and wrap each policy with defaults
      this._policies = parsed
        .map(p => createPolicy(p))
        .sort((a, b) => a.priority - b.priority);

    } catch (err) {
      if (err.code === 'ENOENT') {
        // File not found — silently keep built-in defaults
        return;
      }
      console.warn(`[PolicyEngine] Failed to load policies from "${filePath}":`, err.message);
    }
  }

  /**
   * Evaluate which action to take for an artifact given an agent profile.
   *
   * The engine iterates through policies in priority order (lower = higher
   * priority). The first matching policy's action is returned. If no policy
   * matches, the default 'allow' action is returned.
   *
   * A policy matches when:
   * 1. The artifact's sensitivity level >= the policy's condition level
   * 2. The artifact's categories overlap with the policy's condition categories
   * 3. The artifact type matches (if specified)
   * 4. The agent's trust domain matches (if specified)
   * 5. The agent is NOT cleared for the artifact's sensitivity
   *
   * @param {import('./models.mjs').SourceArtifact} artifact
   * @param {import('./models.mjs').AgentProfile} profile
   * @returns {import('./models.mjs').PolicyAction}
   */
  evaluate(artifact, profile) {
    // Quick path: if agent is cleared for everything in this artifact, allow
    const clearanceResult = checkClearance(profile, artifact.sensitivity);
    if (clearanceResult.cleared) {
      return DEFAULT_ALLOW_ACTION;
    }

    // Evaluate policies in priority order
    for (const policy of this._policies) {
      if (this._matches(policy, artifact, profile)) {
        return policy.action;
      }
    }

    // No policy matched but agent lacks clearance → default block
    // Use debug-level logging to avoid noise in normal multi-agent workflows
    // where agents routinely encounter content above their clearance.
    if (typeof console.debug === 'function') {
      console.debug(`[PolicyEngine] No matching policy for "${artifact.sensitivity.level}" content — applying implicit block`);
    }
    return { type: 'block' };
  }

  /**
   * Evaluate all matching policies for an artifact + profile pair.
   * Returns all matching actions, not just the first one.
   * Useful for diagnostics and audit.
   *
   * @param {import('./models.mjs').SourceArtifact} artifact
   * @param {import('./models.mjs').AgentProfile} profile
   * @returns {Array<{ policy: import('./models.mjs').Policy, action: import('./models.mjs').PolicyAction }>}
   */
  evaluateAll(artifact, profile) {
    const matches = [];
    for (const policy of this._policies) {
      if (this._matches(policy, artifact, profile)) {
        matches.push({ policy, action: policy.action });
      }
    }
    return matches;
  }

  /**
   * Get the current loaded policies.
   *
   * @returns {import('./models.mjs').Policy[]}
   */
  getPolicies() {
    return [...this._policies];
  }

  /**
   * Add a policy at runtime.
   *
   * @param {import('./models.mjs').Policy} policy
   */
  addPolicy(policy) {
    const normalized = createPolicy(policy);
    this._policies.push(normalized);
    this._policies.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Remove a policy by ID.
   *
   * @param {string} policyId
   * @returns {boolean} true if removed
   */
  removePolicy(policyId) {
    const before = this._policies.length;
    this._policies = this._policies.filter(p => p.id !== policyId);
    return this._policies.length < before;
  }

  // ════════════════════════════════════════════════════════════════════
  // Private
  // ════════════════════════════════════════════════════════════════════

  /**
   * Check if a policy's condition matches an artifact + agent profile.
   *
   * @param {import('./models.mjs').Policy} policy
   * @param {import('./models.mjs').SourceArtifact} artifact
   * @param {import('./models.mjs').AgentProfile} profile
   * @returns {boolean}
   * @private
   */
  _matches(policy, artifact, profile) {
    const { condition } = policy;
    const { sensitivity } = artifact;

    // ── Sensitivity level check ────────────────────────────────
    if (condition.sensitivityLevel) {
      // Artifact must be AT or ABOVE the condition's sensitivity level
      if (compareSensitivity(sensitivity.level, condition.sensitivityLevel) < 0) {
        return false;
      }
    }

    // ── Category check ─────────────────────────────────────────
    if (condition.categories && condition.categories.length > 0) {
      // At least one of the policy's categories must be present in the artifact
      const hasOverlap = condition.categories.some(
        cat => sensitivity.categories.includes(cat)
      );
      if (!hasOverlap) {
        return false;
      }
    }

    // ── Artifact type check ────────────────────────────────────
    if (condition.artifactType) {
      if (artifact.type !== condition.artifactType) {
        return false;
      }
    }

    // ── Agent trust domain check ───────────────────────────────
    if (condition.agentTrustDomain) {
      if (profile.trustDomain !== condition.agentTrustDomain) {
        return false;
      }
    }

    return true;
  }
}
