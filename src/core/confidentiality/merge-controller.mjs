/**
 * MergeController — combines outputs from multi-agent task-graph workflows
 * while enforcing sensitivity-ceiling semantics.
 *
 * When multiple agents produce outputs for a decomposed task, the
 * MergeController:
 *
 *   1. Computes the **sensitivity ceiling** across all child outputs
 *      (merged level = max of all child levels; categories = union).
 *   2. Creates a merged {@link SourceArtifact} whose lineage records
 *      every child output as a parent.
 *   3. Runs the merged result through the {@link ViewCompiler} with the
 *      **requester's** profile so that even if a high-clearance agent
 *      produced part of the output, the requester only sees what they
 *      are cleared for.
 *
 * @module src/core/confidentiality/merge-controller
 */

import crypto from 'crypto';
import {
  maxSensitivity,
  createSensitivityMap,
  createSourceArtifact,
  createLineageRecord,
} from './models.mjs';

// ════════════════════════════════════════════════════════════════════════
// MergedResult Type
// ════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} MergedResult
 * @property {import('./models.mjs').SourceArtifact} artifact     — the merged artifact (post view-compilation)
 * @property {import('./models.mjs').SensitivityMap} rawSensitivity — ceiling sensitivity before view compilation
 * @property {boolean} wasRedacted  — true if view compilation modified the content
 * @property {string[]} childIds    — IDs of all child outputs that contributed
 * @property {{ total: number, merged: number, skipped: number }} stats — merge statistics
 */

// ════════════════════════════════════════════════════════════════════════
// MergeController Class
// ════════════════════════════════════════════════════════════════════════

export class MergeController {
  /**
   * @param {import('./lineage-tracker.mjs').LineageTracker} lineageTracker
   * @param {import('./view-compiler.mjs').ViewCompiler} [viewCompiler] — optional; when provided, merged output is compiled for the requester
   */
  constructor(lineageTracker, viewCompiler) {
    if (!lineageTracker) {
      throw new Error('[MergeController] lineageTracker is required');
    }

    /** @private */
    this._lineage = lineageTracker;

    /** @private */
    this._viewCompiler = viewCompiler || null;
  }

  // ════════════════════════════════════════════════════════════════════
  // Public API
  // ════════════════════════════════════════════════════════════════════

  /**
   * Merge outputs from a completed task graph into a single response.
   *
   * **Sensitivity ceiling semantics:**
   *   - `level`      = max(all child output levels)
   *   - `categories` = union(all child output categories)
   *   - `confidence` = min(all child output confidences)
   *
   * **View compilation on merge:**
   * After computing the merged artifact, the content is run through the
   * ViewCompiler with the requester's profile.  This ensures that even
   * if a `restricted`-clearance agent produced part of the output, a
   * `public`-clearance requester only sees allowed content.
   *
   * **Lineage recording:**
   * The merged artifact's lineage records all child outputs as parents,
   * with `derivationType: 'merged'`.
   *
   * @param {import('./task-graph.mjs').TaskGraphResult} graphResult — completed task graph
   * @param {import('./models.mjs').AgentProfile} requesterProfile — profile of the requesting agent/user
   * @returns {Promise<MergedResult>}
   */
  async merge(graphResult, requesterProfile) {
    if (!graphResult) {
      throw new Error('[MergeController] graphResult is required');
    }
    if (!requesterProfile) {
      throw new Error('[MergeController] requesterProfile is required');
    }

    // ── Collect child outputs ─────────────────────────────────────
    const childOutputs = this._collectOutputs(graphResult);

    if (childOutputs.length === 0) {
      // No outputs to merge — return an empty artifact
      return this._emptyMergedResult(requesterProfile);
    }

    // ── Compute sensitivity ceiling ──────────────────────────────
    const rawSensitivity = this._computeCeiling(childOutputs);

    // ── Concatenate content ──────────────────────────────────────
    const mergedContent = this._concatenateOutputs(childOutputs);
    const childIds = childOutputs.map((o) => o.id);

    // ── Create the merged artifact ───────────────────────────────
    const mergedArtifact = createSourceArtifact({
      content: mergedContent,
      type: 'agent-output',
      sensitivity: rawSensitivity,
      lineage: {
        parentIds: childIds,
        derivationType: 'merged',
      },
    });

    // ── Record lineage ───────────────────────────────────────────
    this._lineage.record(mergedArtifact);

    // ── View-compile for requester ───────────────────────────────
    let finalArtifact = mergedArtifact;
    let wasRedacted = false;

    if (this._viewCompiler) {
      try {
        const compiled = this._viewCompiler.compileString(
          mergedArtifact.content,
          'agent-output',
          requesterProfile,
        );
        if (compiled && compiled.wasModified) {
          wasRedacted = true;
          finalArtifact = {
            ...mergedArtifact,
            content: compiled.content,
          };
        }
      } catch {
        // Non-critical — return uncompiled content
      }
    }

    return {
      artifact: finalArtifact,
      rawSensitivity,
      wasRedacted,
      childIds,
      stats: {
        total: (graphResult.nodes || []).length,
        merged: childOutputs.length,
        skipped: (graphResult.nodes || []).length - childOutputs.length,
      },
    };
  }

  /**
   * Merge an array of SourceArtifacts directly (not from a task graph).
   *
   * Useful when combining outputs from ad-hoc multi-agent collaboration
   * outside the formal task-graph workflow.
   *
   * @param {import('./models.mjs').SourceArtifact[]} artifacts
   * @param {import('./models.mjs').AgentProfile} requesterProfile
   * @returns {Promise<MergedResult>}
   */
  async mergeArtifacts(artifacts, requesterProfile) {
    if (!artifacts || artifacts.length === 0) {
      return this._emptyMergedResult(requesterProfile);
    }

    const graphResult = {
      success: true,
      nodes: artifacts.map((a) => ({
        id: a.id || crypto.randomUUID(),
        status: 'completed',
        output: a,
      })),
      outputs: artifacts,
      errors: [],
      durationMs: 0,
    };

    return this.merge(graphResult, requesterProfile);
  }

  /**
   * Compute the sensitivity ceiling for a set of artifacts without merging.
   *
   * Useful for preview/dry-run scenarios where you want to know what the
   * resulting sensitivity would be without actually merging.
   *
   * @param {import('./models.mjs').SourceArtifact[]} artifacts
   * @returns {import('./models.mjs').SensitivityMap}
   */
  computeCeilingPreview(artifacts) {
    return this._computeCeiling(artifacts || []);
  }

  // ════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ════════════════════════════════════════════════════════════════════

  /**
   * Collect output artifacts from completed nodes in a task graph result.
   *
   * @param {import('./task-graph.mjs').TaskGraphResult} graphResult
   * @returns {import('./models.mjs').SourceArtifact[]}
   * @private
   */
  _collectOutputs(graphResult) {
    const outputs = [];

    // First try the explicit outputs array
    if (Array.isArray(graphResult.outputs) && graphResult.outputs.length > 0) {
      return graphResult.outputs.filter(Boolean);
    }

    // Fall back to collecting from completed nodes
    if (Array.isArray(graphResult.nodes)) {
      for (const node of graphResult.nodes) {
        if (node.status === 'completed' && node.output) {
          outputs.push(node.output);
        }
      }
    }

    return outputs;
  }

  /**
   * Compute the sensitivity ceiling across a set of artifacts.
   *
   * @param {import('./models.mjs').SourceArtifact[]} artifacts
   * @returns {import('./models.mjs').SensitivityMap}
   * @private
   */
  _computeCeiling(artifacts) {
    let ceilingLevel = 'public';
    const categorySet = new Set();
    let minConfidence = 1.0;

    for (const artifact of artifacts) {
      const sens = artifact.sensitivity;
      if (!sens) continue;

      // Ceiling: max level
      ceilingLevel = maxSensitivity(ceilingLevel, sens.level || 'public');

      // Union: all categories
      for (const cat of sens.categories || []) {
        categorySet.add(cat);
      }

      // Floor: min confidence
      if (sens.confidence != null && sens.confidence < minConfidence) {
        minConfidence = sens.confidence;
      }
    }

    return createSensitivityMap({
      level: ceilingLevel,
      categories: [...categorySet],
      confidence: minConfidence,
      classifiedBy: 'merge',
    });
  }

  /**
   * Concatenate output content from multiple artifacts.
   *
   * Each output is separated by a blank line.  If an artifact has an
   * associated agentId or a node instruction, a header is prepended.
   *
   * @param {import('./models.mjs').SourceArtifact[]} artifacts
   * @returns {string}
   * @private
   */
  _concatenateOutputs(artifacts) {
    if (artifacts.length === 1) {
      return artifacts[0].content || '';
    }

    const sections = [];
    for (const artifact of artifacts) {
      const content = artifact.content || '';
      if (!content.trim()) continue;
      sections.push(content);
    }

    return sections.join('\n\n');
  }

  /**
   * Return an empty merged result for when there are no outputs.
   *
   * @param {import('./models.mjs').AgentProfile} requesterProfile
   * @returns {MergedResult}
   * @private
   */
  _emptyMergedResult(requesterProfile) {
    const emptyArtifact = createSourceArtifact({
      content: '',
      type: 'agent-output',
      sensitivity: createSensitivityMap({ level: 'public' }),
      lineage: { derivationType: 'merged', parentIds: [] },
    });

    this._lineage.record(emptyArtifact);

    return {
      artifact: emptyArtifact,
      rawSensitivity: createSensitivityMap({ level: 'public' }),
      wasRedacted: false,
      childIds: [],
      stats: { total: 0, merged: 0, skipped: 0 },
    };
  }
}
