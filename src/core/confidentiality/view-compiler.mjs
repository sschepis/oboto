/**
 * ViewCompiler — compiles policy-compliant views of content artifacts
 * for a given agent profile.
 *
 * Sits between raw content sources (history, system prompt sections,
 * pre-routed files) and the LLM, applying redaction, masking, or
 * generalization according to evaluated {@link PolicyAction}s.
 *
 * The compiler uses a three-step pipeline per artifact:
 *   1. **Classify** — run the {@link SensitivityTagger} to get a SensitivityMap
 *   2. **Evaluate** — ask the {@link PolicyEngine} for the appropriate action
 *   3. **Transform** — apply redaction, masking, or blocking
 *
 * @module src/core/confidentiality/view-compiler
 */

import {
  createSourceArtifact,
  createAgentProfile,
  checkClearance,
} from './models.mjs';

// ════════════════════════════════════════════════════════════════════════
// CompiledView Type
// ════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} CompiledView
 * @property {string}   id             — original artifact ID
 * @property {string}   content        — the transformed (redacted/masked) content
 * @property {string}   originalType   — original artifact type
 * @property {import('./models.mjs').SensitivityMap} sensitivity — classification
 * @property {string}   actionApplied  — 'allow' | 'redact' | 'mask' | 'block'
 * @property {boolean}  wasModified    — whether the content was changed
 */

// ════════════════════════════════════════════════════════════════════════
// ViewCompiler Class
// ════════════════════════════════════════════════════════════════════════

export class ViewCompiler {
  /**
   * @param {import('./policy-engine.mjs').PolicyEngine} policyEngine
   * @param {import('./sensitivity-tagger.mjs').SensitivityTagger} tagger
   */
  constructor(policyEngine, tagger) {
    /** @private */
    this._policyEngine = policyEngine;
    /** @private */
    this._tagger = tagger;
  }

  // ════════════════════════════════════════════════════════════════════
  // Public API
  // ════════════════════════════════════════════════════════════════════

  /**
   * Compile a set of artifacts into a policy-compliant view for an agent.
   *
   * @param {import('./models.mjs').SourceArtifact[]} artifacts
   * @param {import('./models.mjs').AgentProfile} profile
   * @returns {CompiledView[]}
   */
  compile(artifacts, profile) {
    const safeProfile = profile || createAgentProfile();
    return artifacts.map(artifact => this._compileOne(artifact, safeProfile));
  }

  /**
   * Compile conversation history entries.
   *
   * Each history entry (a `{ role, content, ... }` message object) is
   * wrapped as a SourceArtifact, classified, policy-evaluated, and
   * transformed. The returned array preserves the original shape (role,
   * tool_call_id, etc.) with only `content` replaced.
   *
   * @param {Array<Object>} history — raw conversation history messages
   * @param {import('./models.mjs').AgentProfile} profile
   * @returns {Array<Object>} — history with redacted/masked content
   */
  compileHistory(history, profile) {
    if (!history || history.length === 0) return history || [];
    const safeProfile = profile || createAgentProfile();

    return history.map(entry => {
      // Skip non-content messages (tool_calls, etc.) and system messages
      // System messages are compiled via buildSystemPrompt's viewCompiler path
      if (!entry.content || typeof entry.content !== 'string') {
        return entry;
      }

      // Skip transient messages — they're ephemeral and already controlled
      if (entry._transient) {
        return entry;
      }

      const result = this.compileString(
        entry.content,
        'history-entry',
        safeProfile,
      );

      if (!result.wasModified) {
        return entry;
      }

      // Return a shallow copy with transformed content
      return { ...entry, content: result.content };
    });
  }

  /**
   * Compile a single string, returning the filtered version.
   *
   * Convenience method for inline use in prompt building and
   * individual content transformation.
   *
   * @param {string} content
   * @param {string} artifactType — one of ARTIFACT_TYPES
   * @param {import('./models.mjs').AgentProfile} profile
   * @param {Object} [metadata] — optional metadata (e.g. { path: '...' })
   * @returns {{ content: string, sensitivity: import('./models.mjs').SensitivityMap, wasModified: boolean, actionApplied: string }}
   */
  compileString(content, artifactType, profile, metadata = {}) {
    if (!content || typeof content !== 'string') {
      return {
        content: content || '',
        sensitivity: null,
        wasModified: false,
        actionApplied: 'allow',
      };
    }

    const safeProfile = profile || createAgentProfile();

    // Step 1: Classify
    const sensitivity = this._tagger.classify(content, artifactType, metadata);

    // Step 2: Quick clearance check — if agent is fully cleared, skip policy eval
    const clearanceResult = checkClearance(safeProfile, sensitivity);
    if (clearanceResult.cleared) {
      return {
        content,
        sensitivity,
        wasModified: false,
        actionApplied: 'allow',
      };
    }

    // Step 3: Create a SourceArtifact for policy evaluation
    const artifact = createSourceArtifact({
      content,
      type: artifactType,
      sensitivity,
    });

    // Step 4: Evaluate policy
    const action = this._policyEngine.evaluate(artifact, safeProfile);

    // Step 5: Transform
    const transformed = this._applyAction(content, sensitivity, action);

    return {
      content: transformed,
      sensitivity,
      wasModified: transformed !== content,
      actionApplied: action.type,
    };
  }

  /**
   * Compile a batch of pre-routed file results.
   *
   * Each file result has shape `{ path, content?, error? }`. This method
   * classifies and transforms the `content` field according to policy.
   *
   * @param {Array<{ path: string, content?: string, error?: string }>} fileResults
   * @param {import('./models.mjs').AgentProfile} profile
   * @returns {Array<{ path: string, content?: string, error?: string, sensitivity?: Object, wasModified?: boolean }>}
   */
  compileFileResults(fileResults, profile) {
    if (!fileResults || fileResults.length === 0) return fileResults || [];
    const safeProfile = profile || createAgentProfile();

    return fileResults.map(file => {
      if (!file.content) return file;

      const result = this.compileString(
        file.content,
        'file-content',
        safeProfile,
        { path: file.path },
      );

      return {
        ...file,
        content: result.content,
        sensitivity: result.sensitivity,
        wasModified: result.wasModified,
      };
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // Private
  // ════════════════════════════════════════════════════════════════════

  /**
   * Compile a single artifact into a CompiledView.
   *
   * @param {import('./models.mjs').SourceArtifact} artifact
   * @param {import('./models.mjs').AgentProfile} profile
   * @returns {CompiledView}
   * @private
   */
  _compileOne(artifact, profile) {
    const action = this._policyEngine.evaluate(artifact, profile);
    const transformed = this._applyAction(
      artifact.content,
      artifact.sensitivity,
      action,
    );

    return {
      id: artifact.id,
      content: transformed,
      originalType: artifact.type,
      sensitivity: artifact.sensitivity,
      actionApplied: action.type,
      wasModified: transformed !== artifact.content,
    };
  }

  /**
   * Apply a PolicyAction to content, producing the transformed string.
   *
   * @param {string} content — raw content
   * @param {import('./models.mjs').SensitivityMap} sensitivity — classification
   * @param {import('./models.mjs').PolicyAction} action — action to apply
   * @returns {string} — transformed content
   * @private
   */
  _applyAction(content, sensitivity, action) {
    switch (action.type) {
      case 'allow':
        return content;

      case 'redact':
        return this._applyRedaction(content, sensitivity, action.params);

      case 'mask':
        return this._applyMasking(content, sensitivity, action.params);

      case 'block':
        return this._applyBlock(sensitivity, action.params);

      case 'summarize':
        // Summarize requires an LLM call — for Phase 2 we fall back to
        // a generalized placeholder. LLM-assisted summarization is Phase 3.
        return this._applySummarize(content, sensitivity, action.params);

      default:
        // Unknown action type → allow by default (safe fallback)
        console.warn(`[ViewCompiler] Unknown action type "${action.type}" — allowing content`);
        return content;
    }
  }

  /**
   * Redact sensitive spans from content, replacing them with a placeholder.
   *
   * When spans are available in the SensitivityMap, only the specific
   * character ranges are redacted. When no spans are available (e.g.
   * file-path heuristic only), the entire content is replaced.
   *
   * @param {string} content
   * @param {import('./models.mjs').SensitivityMap} sensitivity
   * @param {Object} [params]
   * @param {string} [params.replacement] — replacement text
   * @returns {string}
   * @private
   */
  _applyRedaction(content, sensitivity, params = {}) {
    const spans = this._collectSpans(sensitivity);

    if (spans.length === 0) {
      // No specific spans — full content redaction
      const replacement = params?.replacement || `[REDACTED:${sensitivity.level}]`;
      return replacement;
    }

    // Sort spans by start position descending so replacements don't shift offsets
    const sorted = [...spans].sort((a, b) => b.start - a.start);
    let result = content;

    for (const span of sorted) {
      const replacement = params?.replacement || `[REDACTED:${span.label || sensitivity.level}]`;
      result =
        result.substring(0, span.start) +
        replacement +
        result.substring(span.end);
    }

    return result;
  }

  /**
   * Mask sensitive spans with a partial-reveal pattern.
   *
   * Masking preserves the first and last few characters, replacing the
   * middle with asterisks. Useful for PII where some context is helpful
   * (e.g., email domain) but the full value must be hidden.
   *
   * @param {string} content
   * @param {import('./models.mjs').SensitivityMap} sensitivity
   * @param {Object} [params]
   * @param {string} [params.replacement] — override replacement text
   * @returns {string}
   * @private
   */
  _applyMasking(content, sensitivity, params = {}) {
    const spans = this._collectSpans(sensitivity);

    if (spans.length === 0) {
      // No specific spans — use replacement or generic mask
      return params?.replacement || `[MASKED:${sensitivity.level}]`;
    }

    const sorted = [...spans].sort((a, b) => b.start - a.start);
    let result = content;

    for (const span of sorted) {
      const original = content.substring(span.start, span.end);

      let masked;
      if (params?.replacement) {
        masked = params.replacement;
      } else if (original.length <= 4) {
        masked = '****';
      } else {
        // Preserve first 2 and last 2 characters
        const revealLen = Math.min(2, Math.floor(original.length / 4));
        const prefix = original.substring(0, revealLen);
        const suffix = original.substring(original.length - revealLen);
        const maskLen = original.length - 2 * revealLen;
        masked = prefix + '*'.repeat(maskLen) + suffix;
      }

      result =
        result.substring(0, span.start) +
        masked +
        result.substring(span.end);
    }

    return result;
  }

  /**
   * Block content entirely, replacing with a block notice.
   *
   * @param {import('./models.mjs').SensitivityMap} sensitivity
   * @param {Object} [params]
   * @returns {string}
   * @private
   */
  _applyBlock(sensitivity, params = {}) {
    const categories = sensitivity.categories.join(', ') || 'unknown';
    return (
      params?.replacement ||
      `[BLOCKED: Content classified as "${sensitivity.level}" with categories [${categories}] exceeds agent clearance]`
    );
  }

  /**
   * Summarize content — Phase 2 fallback (no LLM call).
   *
   * Replaces content with a generalized description of what was present
   * without revealing the sensitive details.
   *
   * @param {string} content
   * @param {import('./models.mjs').SensitivityMap} sensitivity
   * @param {Object} [params]
   * @returns {string}
   * @private
   */
  _applySummarize(content, sensitivity, params = {}) {
    const categories = sensitivity.categories.join(', ') || 'unspecified';
    const contentLen = content.length;
    return (
      `[SUMMARIZED: ${contentLen} characters of "${sensitivity.level}" content ` +
      `containing [${categories}] data — details withheld per policy]`
    );
  }

  /**
   * Collect all span annotations from a SensitivityMap into a flat array.
   *
   * @param {import('./models.mjs').SensitivityMap} sensitivity
   * @returns {Array<import('./models.mjs').SpanAnnotation>}
   * @private
   */
  _collectSpans(sensitivity) {
    if (!sensitivity?.spans) return [];

    const allSpans = [];
    for (const [_category, categorySpans] of Object.entries(sensitivity.spans)) {
      if (Array.isArray(categorySpans)) {
        allSpans.push(...categorySpans);
      }
    }
    return allSpans;
  }
}
