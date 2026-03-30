/**
 * SensitivityTagger — classifies content using a tiered approach:
 *
 * 1. Rule-based fast path: regex patterns for common sensitive patterns
 *    (API keys, emails, SSNs, credit cards, passwords in config).
 * 2. Category heuristics: file-path based classification
 *    (e.g., .env files → credentials, database configs → proprietary-code).
 * 3. LLM-assisted classification via SupportLLM (semantic enhancement).
 *
 * The synchronous `classify()` method performs tiers 1–2 only.
 * The async `classifyAsync()` method adds tier 3 when a SupportLLM is available,
 * falling back to `classify()` results if the LLM is unavailable or returns null.
 *
 * @module src/core/confidentiality/sensitivity-tagger
 */

import {
  createSensitivityMap,
  createSourceArtifact,
  maxSensitivity,
} from './models.mjs';

// ════════════════════════════════════════════════════════════════════════
// Built-in Regex Patterns
// ════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} PatternRule
 * @property {RegExp}  regex     — the pattern to match
 * @property {string}  category  — sensitivity category (e.g. 'credentials')
 * @property {string}  level     — minimum sensitivity level for a match
 * @property {string}  label     — human-readable label for span annotations
 */

/** @type {PatternRule[]} */
const BUILTIN_PATTERNS = [
  // ── Credentials ──────────────────────────────────────────────────
  {
    regex: /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"]?[A-Za-z0-9_\-/.]{16,}['"]?/gi,
    category: 'credentials',
    level: 'confidential',
    label: 'API key or token',
  },
  {
    regex: /(?:password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{4,}['"]?/gi,
    category: 'credentials',
    level: 'confidential',
    label: 'Password',
  },
  {
    regex: /(?:AKIA|ASIA)[A-Z0-9]{16}/g,
    category: 'credentials',
    level: 'restricted',
    label: 'AWS Access Key ID',
  },
  {
    regex: /ghp_[A-Za-z0-9_]{36}/g,
    category: 'credentials',
    level: 'confidential',
    label: 'GitHub Personal Access Token',
  },
  {
    regex: /sk-[A-Za-z0-9]{32,}/g,
    category: 'credentials',
    level: 'confidential',
    label: 'OpenAI API Key',
  },
  {
    regex: /-----BEGIN\s(?:RSA\s)?PRIVATE\sKEY-----[\s\S]+?-----END\s(?:RSA\s)?PRIVATE\sKEY-----/g,
    category: 'credentials',
    level: 'restricted',
    label: 'Private Key',
  },
  {
    regex: /(?:Bearer|Basic)\s+[A-Za-z0-9_\-.~+/]+=*/gi,
    category: 'credentials',
    level: 'confidential',
    label: 'Authorization Header',
  },

  // ── PII ──────────────────────────────────────────────────────────
  {
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    category: 'pii',
    level: 'confidential',
    label: 'Social Security Number',
  },
  {
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    category: 'pii',
    level: 'internal',
    label: 'Email address',
  },
  {
    regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    category: 'pii',
    level: 'internal',
    label: 'Phone number',
  },

  // ── Financial ────────────────────────────────────────────────────
  {
    regex: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    category: 'financial',
    level: 'confidential',
    label: 'Credit card number',
  },
  {
    regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}\b/g,
    category: 'financial',
    level: 'confidential',
    label: 'IBAN',
  },
  {
    regex: /\b\d{9,18}\b(?=.*(?:account|routing|bank))/gi,
    category: 'financial',
    level: 'confidential',
    label: 'Bank account number',
  },
];

/**
 * File-path patterns for heuristic classification.
 * @type {Array<{ pattern: RegExp, category: string, level: string }>}
 */
const FILE_PATH_HEURISTICS = [
  { pattern: /\.env(?:\.|$)/i, category: 'credentials', level: 'confidential' },
  { pattern: /(?:secrets?|credentials?)\./i, category: 'credentials', level: 'confidential' },
  { pattern: /(?:id_rsa|id_ed25519|\.pem|\.key)$/i, category: 'credentials', level: 'restricted' },
  { pattern: /(?:database|db)\.(?:yml|yaml|json|toml|conf)/i, category: 'proprietary-code', level: 'internal' },
  { pattern: /(?:config|settings)\.(?:yml|yaml|json|toml)/i, category: 'proprietary-code', level: 'internal' },
  { pattern: /(?:docker-compose|dockerfile)/i, category: 'proprietary-code', level: 'internal' },
];

// ════════════════════════════════════════════════════════════════════════
// SensitivityTagger Class
// ════════════════════════════════════════════════════════════════════════

export class SensitivityTagger {
  /**
   * @param {Object} [opts]
   * @param {Object.<string, string[]>} [opts.customPatterns] — custom regex patterns by category
   * @param {Object} [opts.aiProvider] — for LLM-assisted classification (legacy placeholder)
   * @param {import('../support-llm.mjs').SupportLLM} [opts.supportLlm] — invisible local LLM for semantic classification
   */
  constructor(opts = {}) {
    /** @type {PatternRule[]} */
    this._patterns = BUILTIN_PATTERNS.map(p => ({
      ...p,
      regex: new RegExp(p.regex.source, p.regex.flags),
    }));

    // Add custom patterns if provided
    if (opts.customPatterns) {
      for (const [category, regexStrings] of Object.entries(opts.customPatterns)) {
        for (const regexStr of regexStrings) {
          this._patterns.push({
            regex: new RegExp(regexStr, 'gi'),
            category,
            level: 'confidential', // custom patterns default to confidential
            label: `Custom ${category} pattern`,
          });
        }
      }
    }

    /** @type {Object|null} */
    this._aiProvider = opts.aiProvider || null;

    /** @type {import('../support-llm.mjs').SupportLLM|null} */
    this._supportLlm = opts.supportLlm || null;
  }

  /**
   * Classify a single content string.
   *
   * @param {string} content — the text to classify
   * @param {string} [type='unknown'] — artifact type hint
   * @param {Object} [metadata] — optional metadata (e.g. { path: 'some/file.env' })
   * @returns {SensitivityMap}
   */
  classify(content, type = 'unknown', metadata = {}) {
    /** @type {string[]} */
    const foundCategories = [];
    /** @type {Object.<string, SpanAnnotation[]>} */
    const spans = {};
    let level = 'public';
    let confidence = 1.0;

    // ── Step 1: File-path heuristics ─────────────────────────────
    if (metadata.path) {
      for (const heuristic of FILE_PATH_HEURISTICS) {
        if (heuristic.pattern.test(metadata.path)) {
          if (!foundCategories.includes(heuristic.category)) {
            foundCategories.push(heuristic.category);
          }
          level = maxSensitivity(level, heuristic.level);
        }
      }
    }

    // ── Step 2: Regex pattern matching ───────────────────────────
    if (content) {
      for (const rule of this._patterns) {
        // Reset regex lastIndex for global patterns
        rule.regex.lastIndex = 0;

        let match;
        const matchSpans = [];

        while ((match = rule.regex.exec(content)) !== null) {
          matchSpans.push({
            start: match.index,
            end: match.index + match[0].length,
            label: rule.label,
          });

          // Prevent infinite loops on zero-width matches
          if (match[0].length === 0) {
            rule.regex.lastIndex++;
          }
        }

        if (matchSpans.length > 0) {
          if (!foundCategories.includes(rule.category)) {
            foundCategories.push(rule.category);
          }
          if (!spans[rule.category]) {
            spans[rule.category] = [];
          }
          spans[rule.category].push(...matchSpans);
          level = maxSensitivity(level, rule.level);
        }
      }
    }

    // ── Step 3: Confidence heuristic ─────────────────────────────
    // Multiple matching categories increase confidence
    if (foundCategories.length === 0) {
      confidence = 1.0; // public with high confidence
    } else if (foundCategories.length === 1) {
      confidence = 0.85;
    } else {
      confidence = 0.95;
    }

    return createSensitivityMap({
      level,
      categories: foundCategories,
      spans,
      confidence,
      classifiedBy: 'auto',
      classifiedAt: new Date().toISOString(),
    });
  }

  /**
   * Async classification with optional SupportLLM semantic enhancement.
   *
   * Runs the same regex fast-path as `classify()`, then — if a SupportLLM
   * is available and the regex pass found **no** matches — uses the local
   * LLM to perform semantic sensitivity analysis. Results from both passes
   * are merged via `merge()`, keeping the higher sensitivity.
   *
   * If the SupportLLM is unavailable or returns null, this method returns
   * exactly the same result as `classify()`.
   *
   * @param {string} content — the text to classify
   * @param {string} [type='unknown'] — artifact type hint
   * @param {Object} [metadata] — optional metadata (e.g. { path: 'some/file.env' })
   * @returns {Promise<SensitivityMap>}
   */
  async classifyAsync(content, type = 'unknown', metadata = {}) {
    // Step 1: Run the synchronous regex-based classification
    const regexResult = this.classify(content, type, metadata);

    // Step 2: If regex already found sensitive content, or no SupportLLM, return as-is
    if (regexResult.categories.length > 0 || !this._supportLlm?.isAvailable()) {
      return regexResult;
    }

    // Step 3: Attempt semantic classification via SupportLLM
    try {
      const llmResult = await this._supportLlm.tagSensitivity(content, {
        filePath: metadata?.path,
      });

      if (!llmResult) {
        return regexResult;
      }

      // Map LLM result to a SensitivityMap compatible with merge()
      const llmSensitivity = this._llmResultToSensitivityMap(llmResult);
      if (!llmSensitivity || llmSensitivity.level === 'public') {
        return regexResult;
      }

      // Merge regex + LLM results, keeping the higher sensitivity
      return this.merge(regexResult, llmSensitivity);
    } catch {
      // LLM classification failed — fall back to regex-only result
      return regexResult;
    }
  }

  /**
   * Update the SupportLLM reference after construction.
   * Called when the SupportLLM becomes available or is replaced.
   *
   * @param {import('../support-llm.mjs').SupportLLM|null} supportLlm
   */
  setSupportLlm(supportLlm) {
    this._supportLlm = supportLlm || null;
  }

  /**
   * Convert a SupportLLM tagSensitivity result to a SensitivityMap.
   *
   * The LLM returns: { category, level, spans[] }
   * We need:         { level, categories, spans, confidence, classifiedBy, classifiedAt }
   *
   * @param {Object} llmResult
   * @returns {SensitivityMap|null}
   * @private
   */
  _llmResultToSensitivityMap(llmResult) {
    if (!llmResult) return null;

    // Map LLM level names to our internal level names
    const LEVEL_MAP = {
      critical: 'restricted',
      high: 'confidential',
      medium: 'internal',
      low: 'public',
      none: 'public',
      // Also accept our own level names directly
      restricted: 'restricted',
      confidential: 'confidential',
      internal: 'internal',
      public: 'public',
    };

    // Map LLM category names to our internal category names
    const CATEGORY_MAP = {
      credential: 'credentials',
      credentials: 'credentials',
      pii: 'pii',
      internal: 'proprietary-code',
      'proprietary-code': 'proprietary-code',
      financial: 'financial',
      none: null,
    };

    const level = LEVEL_MAP[llmResult.level] || 'public';
    const category = CATEGORY_MAP[llmResult.category] || null;

    if (level === 'public' && !category) return null;

    const categories = category ? [category] : [];
    const spans = {};

    // Map LLM spans if provided
    if (Array.isArray(llmResult.spans) && llmResult.spans.length > 0) {
      for (const span of llmResult.spans) {
        const spanCat = CATEGORY_MAP[span.category] || category || 'unknown';
        if (!spans[spanCat]) spans[spanCat] = [];
        spans[spanCat].push({
          start: span.start || 0,
          end: span.end || 0,
          label: `LLM-detected ${spanCat}`,
        });
        if (!categories.includes(spanCat)) {
          categories.push(spanCat);
        }
      }
    }

    return createSensitivityMap({
      level,
      categories,
      spans,
      confidence: 0.75, // Lower confidence for LLM-only classification
      classifiedBy: 'support-llm',
      classifiedAt: new Date().toISOString(),
    });
  }

  /**
   * Classify a batch of items, returning SourceArtifacts.
   *
   * @param {Array<{ content: string, type: string, metadata?: Object }>} items
   * @returns {import('./models.mjs').SourceArtifact[]}
   */
  classifyBatch(items) {
    return items.map(item => {
      const sensitivity = this.classify(item.content || '', item.type, item.metadata);
      return createSourceArtifact({
        content: item.content || '',
        type: item.type,
        sensitivity,
      });
    });
  }

  /**
   * Async classify a batch of items, returning SourceArtifacts.
   * Uses classifyAsync for LLM-enhanced classification.
   *
   * @param {Array<{ content: string, type: string, metadata?: Object }>} items
   * @returns {Promise<import('./models.mjs').SourceArtifact[]>}
   */
  async classifyBatchAsync(items) {
    const results = await Promise.all(
      items.map(async (item) => {
        const sensitivity = await this.classifyAsync(item.content || '', item.type, item.metadata);
        return createSourceArtifact({
          content: item.content || '',
          type: item.type,
          sensitivity,
        });
      }),
    );
    return results;
  }

  /**
   * Merge an existing SensitivityMap with a new classification,
   * keeping the higher sensitivity. Useful for re-classification
   * or combining auto + user classifications.
   *
   * @param {SensitivityMap} existing
   * @param {SensitivityMap} incoming
   * @returns {SensitivityMap}
   */
  merge(existing, incoming) {
    const mergedCategories = [...new Set([...existing.categories, ...incoming.categories])];
    const mergedLevel = maxSensitivity(existing.level, incoming.level);

    // Merge spans by category
    const mergedSpans = { ...existing.spans };
    for (const [cat, catSpans] of Object.entries(incoming.spans)) {
      if (!mergedSpans[cat]) {
        mergedSpans[cat] = [];
      }
      mergedSpans[cat].push(...catSpans);
    }

    return createSensitivityMap({
      level: mergedLevel,
      categories: mergedCategories,
      spans: mergedSpans,
      confidence: Math.max(existing.confidence, incoming.confidence),
      classifiedBy: existing.classifiedBy === incoming.classifiedBy
        ? existing.classifiedBy
        : 'auto', // fallback if mixed
      classifiedAt: new Date().toISOString(),
    });
  }
}
