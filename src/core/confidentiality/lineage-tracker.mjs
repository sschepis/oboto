/**
 * LineageTracker — tracks the provenance DAG of all SourceArtifacts
 * flowing through the confidentiality subsystem.
 *
 * Every artifact produced within an agent turn (user input, tool result,
 * LLM output, merged result) is recorded with its parent artifacts.
 * The tracker computes **inherited sensitivity** using ceiling semantics:
 *
 *   output sensitivity = max(all parent sensitivities)
 *   output categories  = union(all parent categories)
 *
 * This ensures that derived content never has *lower* sensitivity than
 * any of its inputs — a fundamental invariant of the system.
 *
 * Usage from {@link AgentLoop}:
 *   - Input recording   → `derivationType: 'original'`
 *   - Tool result        → `derivationType: 'tool-result'`, parent = input artifact
 *   - LLM output         → `derivationType: 'llm-derived'`, parents = all prompt artifacts
 *   - Merged output      → `derivationType: 'merged'`, parents = child outputs
 *
 * @module src/core/confidentiality/lineage-tracker
 */

import {
  SENSITIVITY_RANK,
  compareSensitivity,
  maxSensitivity,
  createSensitivityMap,
  createLineageRecord,
  isClearedForLevel,
  isClearedForCategories,
  checkClearance,
} from './models.mjs';

// ════════════════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════════════════

/** Default maximum number of lineage records kept in memory. */
const DEFAULT_MAX_RECORDS = 10_000;

// ════════════════════════════════════════════════════════════════════════
// LineageTracker Class
// ════════════════════════════════════════════════════════════════════════

export class LineageTracker {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.maxRecords=10000] — maximum records kept in memory
   * @param {boolean} [opts.persist=false]   — whether to persist records (placeholder for Phase 6)
   */
  constructor(opts = {}) {
    /** @type {Map<string, import('./models.mjs').LineageRecord>} */
    this._records = new Map();

    /** @type {Map<string, import('./models.mjs').SensitivityMap>} */
    this._sensitivities = new Map();

    /** @type {number} */
    this._maxRecords = opts.maxRecords ?? DEFAULT_MAX_RECORDS;

    /** @type {boolean} */
    this._persist = opts.persist ?? false;
  }

  // ════════════════════════════════════════════════════════════════════
  // Public API
  // ════════════════════════════════════════════════════════════════════

  /**
   * Record a new artifact's lineage.
   *
   * Automatically computes `inheritedSensitivity` as the ceiling
   * of all parent sensitivities (max level, union categories).
   *
   * @param {import('./models.mjs').SourceArtifact} artifact — the artifact to record
   * @returns {import('./models.mjs').LineageRecord} — the recorded lineage entry
   */
  record(artifact) {
    if (!artifact || !artifact.id) {
      throw new Error('[LineageTracker] artifact with id is required');
    }

    const parentIds = artifact.lineage?.parentIds || [];
    const inheritedSensitivity = this.computeInheritedSensitivity(
      parentIds,
      artifact.sensitivity,
    );

    const lineageRecord = createLineageRecord({
      artifactId: artifact.id,
      parentIds: [...parentIds],
      derivationType: artifact.lineage?.derivationType || 'original',
      agentId: artifact.agentId || artifact.lineage?.agentId || '',
      turnId: artifact.turnId || artifact.lineage?.turnId || '',
      timestamp: artifact.createdAt || new Date().toISOString(),
      inheritedSensitivity,
    });

    // Store the record and the artifact's effective sensitivity
    this._records.set(artifact.id, lineageRecord);
    this._sensitivities.set(artifact.id, inheritedSensitivity);

    // Evict oldest records if we exceed the cap
    this._evictIfNeeded();

    return lineageRecord;
  }

  /**
   * Compute the inherited sensitivity level for an artifact
   * based on its parent artifacts.
   *
   * **Ceiling semantics:**
   *   - `level` = max of all parent levels and the artifact's own level
   *   - `categories` = union of all parent categories and the artifact's own
   *   - `confidence` = min of all parent confidences (most uncertain wins)
   *
   * @param {string[]} parentIds — IDs of parent artifacts
   * @param {import('./models.mjs').SensitivityMap} [ownSensitivity] — the artifact's direct classification
   * @returns {import('./models.mjs').SensitivityMap} — the computed ceiling sensitivity
   */
  computeInheritedSensitivity(parentIds, ownSensitivity) {
    let ceilingLevel = ownSensitivity?.level || 'public';
    const categorySet = new Set(ownSensitivity?.categories || []);
    let minConfidence = ownSensitivity?.confidence ?? 1.0;

    for (const pid of parentIds) {
      const parentSensitivity = this._sensitivities.get(pid);
      if (!parentSensitivity) continue;

      // Take the maximum sensitivity level
      ceilingLevel = maxSensitivity(ceilingLevel, parentSensitivity.level);

      // Union of categories
      for (const cat of parentSensitivity.categories || []) {
        categorySet.add(cat);
      }

      // Take the minimum confidence (most uncertain)
      if (parentSensitivity.confidence != null && parentSensitivity.confidence < minConfidence) {
        minConfidence = parentSensitivity.confidence;
      }
    }

    return createSensitivityMap({
      level: ceilingLevel,
      categories: [...categorySet],
      confidence: minConfidence,
      classifiedBy: parentIds.length > 0 ? 'lineage' : (ownSensitivity?.classifiedBy || 'auto'),
    });
  }

  /**
   * Query the full provenance chain for an artifact.
   *
   * Walks the parent DAG from root(s) to the target artifact,
   * returning records in topological order (roots first).
   *
   * @param {string} artifactId
   * @returns {import('./models.mjs').LineageRecord[]} — ordered from root to leaf
   */
  getProvenance(artifactId) {
    const visited = new Set();
    const result = [];

    const dfs = (id) => {
      if (visited.has(id)) return;
      visited.add(id);

      const record = this._records.get(id);
      if (!record) return;

      // Visit parents first (topological order — roots before leaves)
      for (const pid of record.parentIds || []) {
        dfs(pid);
      }
      result.push(record);
    };

    dfs(artifactId);
    return result;
  }

  /**
   * Check if an artifact can be shared with an agent profile.
   *
   * Uses **inherited sensitivity** (not just direct classification)
   * to ensure that derived content respects the sensitivity ceiling.
   *
   * @param {string} artifactId
   * @param {import('./models.mjs').AgentProfile} profile
   * @returns {{ allowed: boolean, reason: string }}
   */
  checkShareability(artifactId, profile) {
    const sensitivity = this._sensitivities.get(artifactId);
    if (!sensitivity) {
      // Unknown artifact — allow by default (not tracked)
      return { allowed: true, reason: 'Artifact not tracked — allowed by default' };
    }

    const clearance = checkClearance(profile, sensitivity);
    return {
      allowed: clearance.cleared,
      reason: clearance.reason || 'Artifact within agent clearance',
    };
  }

  /**
   * Get the effective (inherited) sensitivity for a tracked artifact.
   *
   * @param {string} artifactId
   * @returns {import('./models.mjs').SensitivityMap | null}
   */
  getEffectiveSensitivity(artifactId) {
    return this._sensitivities.get(artifactId) || null;
  }

  /**
   * Get a lineage record by artifact ID.
   *
   * @param {string} artifactId
   * @returns {import('./models.mjs').LineageRecord | null}
   */
  getRecord(artifactId) {
    return this._records.get(artifactId) || null;
  }

  /**
   * Return diagnostic summary for observability.
   *
   * @returns {{ totalRecords: number, maxRecords: number, derivationTypes: Object.<string, number> }}
   */
  getDiagnostics() {
    const derivationTypes = {};
    for (const record of this._records.values()) {
      const dt = record.derivationType || 'unknown';
      derivationTypes[dt] = (derivationTypes[dt] || 0) + 1;
    }

    return {
      totalRecords: this._records.size,
      maxRecords: this._maxRecords,
      derivationTypes,
    };
  }

  /**
   * Serialize all records for persistence.
   *
   * @returns {{ records: Array, sensitivities: Array }}
   */
  serialize() {
    return {
      records: [...this._records.entries()].map(([id, rec]) => ({ id, ...rec })),
      sensitivities: [...this._sensitivities.entries()].map(([id, sens]) => ({ id, ...sens })),
    };
  }

  /**
   * Restore records from a serialized state.
   *
   * @param {{ records?: Array, sensitivities?: Array }} data
   */
  restore(data) {
    if (!data) return;

    if (Array.isArray(data.records)) {
      for (const entry of data.records) {
        const id = entry.id || entry.artifactId;
        if (!id) continue;
        this._records.set(id, entry);
      }
    }

    if (Array.isArray(data.sensitivities)) {
      for (const entry of data.sensitivities) {
        const id = entry.id;
        if (!id) continue;
        // Strip the 'id' field before storing as SensitivityMap
        const { id: _id, ...sensitivity } = entry;
        this._sensitivities.set(id, sensitivity);
      }
    }
  }

  /**
   * Remove all records. Useful for testing or workspace reset.
   */
  clear() {
    this._records.clear();
    this._sensitivities.clear();
  }

  /**
   * The total number of tracked artifacts.
   * @type {number}
   */
  get size() {
    return this._records.size;
  }

  // ════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ════════════════════════════════════════════════════════════════════

  /**
   * Evict the oldest records when capacity is exceeded.
   * @private
   */
  _evictIfNeeded() {
    while (this._records.size > this._maxRecords) {
      const oldestKey = this._records.keys().next().value;
      if (oldestKey === undefined) break;
      this._records.delete(oldestKey);
      this._sensitivities.delete(oldestKey);
    }
  }
}
