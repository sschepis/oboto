/**
 * Unified configuration schema — merges all provider configs into a single
 * canonical shape for the UnifiedProvider.
 *
 * Each section corresponds to a subsystem:
 *  - loop:       Core ReAct loop iteration limits
 *  - precheck:   Direct-answer fast-path settings
 *  - routing:    Intent classification & plugin trait routing
 *  - cognitive:  CognitiveCore / SentientObserver integration
 *  - safety:     Guard rails & objectivity gate
 *  - memory:     Holographic, experience, and prompt memory
 *  - streaming:  StreamController behaviour & commentary
 *  - doom:       Doom-loop detection patterns
 *  - compaction: Context window compaction thresholds
 *  - costGuard:  Per-turn spend ceiling
 *
 * @module src/core/agentic/unified/config
 */

// ════════════════════════════════════════════════════════════════════════
// Default Configuration
// ════════════════════════════════════════════════════════════════════════

/**
 * Default unified configuration object.  Every field has a sensible default
 * so the provider works out-of-the-box with zero user config.
 *
 * Values are drawn from the existing providers:
 *  - {@link src/core/agentic/cognitive/config.mjs} — agent / cognitive / lmscript sections
 *  - {@link src/core/agentic/megacode/doom-detector.mjs} — doom patterns
 *  - {@link src/core/agentic/megacode/compaction-agent.mjs} — compaction thresholds
 *  - {@link src/core/agentic/stream-manager.mjs} — streaming baseline
 *  - {@link src/core/agentic/maha-provider.mjs} — routing complexity scoring
 *
 * @type {Object}
 */
export const UNIFIED_CONFIG = {

  // ── Core ReAct loop limits ─────────────────────────────────────────
  loop: {
    /** Max tool-call iterations within a single turn (interactive). */
    maxIterations: 25,
    /** Max tool-call iterations for background/workspace tasks. */
    maxBackgroundIterations: 75,
    /** Max continuation rounds when the LLM announces intent without acting. */
    maxContinuations: 5,
    /** Hard ceiling on total LLM calls per turn (iterations + continuations). */
    maxTotalLLMCalls: 100,
    /** Consecutive iterations with no tool calls before aborting. */
    maxEmptyIterations: 4,
  },

  // ── Direct-answer precheck ─────────────────────────────────────────
  precheck: {
    /** Whether the precheck fast-path is enabled. */
    enabled: true,
    /** TTL for precheck result cache entries (ms). */
    cacheTTL: 300_000,
    /** Maximum number of cached precheck results. */
    cacheMaxSize: 50,
  },

  // ── Intent routing ─────────────────────────────────────────────────
  routing: {
    /** Complexity score threshold above which a request is routed to planning. */
    complexityThreshold: 3,
    /** Whether to use an LLM call to select relevant plugin traits. */
    traitRoutingEnabled: true,
    /** Minimum active plugins before trait routing kicks in. */
    minPluginsForTraitRouting: 5,
    /** Plugins always included regardless of routing decision. */
    alwaysIncludePlugins: [],
  },

  // ── Cognitive subsystem ────────────────────────────────────────────
  cognitive: {
    /** Master toggle for cognitive processing. */
    enabled: true,
    /** Whether to map text to prime-resonant representation. */
    primeEncoding: true,
    /** Whether to run the ObjectivityGate on responses. */
    objectivityGate: true,
    /** Number of physics ticks to run per cognitive cycle. */
    physicsTickCount: 3,
  },

  // ── Safety guard ───────────────────────────────────────────────────
  safety: {
    /** Master toggle for safety checks (doom + cognitive guard). */
    enabled: true,
    /** Whether to hard-block on safety violations (vs. warn). */
    blockOnViolation: true,
  },

  // ── Unified memory system ──────────────────────────────────────────
  memory: {
    /** Enable holographic (prime-resonant) memory. */
    holographicEnabled: true,
    /** Enable experience-based learning memory. */
    experienceEnabled: true,
    /** Enable prompt performance tracking & evolution. */
    promptEvolution: true,
    /** Maximum stored experience records. */
    maxExperiences: 1000,
    /** Maximum extracted patterns. */
    maxPatterns: 100,
  },

  // ── Streaming & commentary ─────────────────────────────────────────
  streaming: {
    /** Master toggle for streaming output. */
    enabled: true,
    /** ActivityTracker heartbeat interval (ms). */
    heartbeatIntervalMs: 3000,
    /** Window for deduplicating identical status messages (ms). */
    statusDedupWindowMs: 2000,
    /** Forward AI text content that accompanies tool calls. */
    forwardAiText: true,
    /** Emit per-turn cost commentary. */
    costReporting: true,
    /** Emit tool round narratives. */
    emitToolNarratives: true,
    /** Emit per-iteration commentary. */
    emitIterationUpdates: true,
    /** Max chars for AI text commentary forwarding. */
    maxCommentaryLength: 300,
  },

  // ── Doom loop detection ────────────────────────────────────────────
  doom: {
    /** Master toggle for doom-loop detection. */
    enabled: true,
    /**
     * Regex patterns that indicate a doom loop.  Ported from
     * {@link src/core/agentic/megacode/doom-detector.mjs}.
     *
     * Each pattern is tested against the dedup key
     * `toolName::JSON.stringify(args)`.
     */
    patterns: [
      /^read_file::/,
      /^list_files::/,
      /^search_files::/,
      // NOTE: run_command is intentionally excluded.  The pattern `/^run_command::/`
      // matches ANY run_command regardless of arguments, so using 3 different
      // commands across 3 iterations (e.g. curl, cat, ls) false-triggers doom.
      // The consecutive-identical check (which requires the same tool+args)
      // already catches actual `run_command` doom loops.
    ],
  },

  // ── Context compaction ─────────────────────────────────────────────
  compaction: {
    /** Master toggle for automatic context compaction. */
    enabled: true,
    /** Maximum context tokens before compaction triggers. */
    maxContextTokens: 100_000,
    /** Fraction of maxContextTokens at which compaction fires. */
    compactionThreshold: 0.8,
  },

  // ── Cost guard ─────────────────────────────────────────────────────
  costGuard: {
    /** Master toggle for per-turn cost ceiling. */
    enabled: false,
    /**
     * Maximum estimated cost (USD) per turn before the agent aborts.
     * Only effective when `enabled` is true.  When the estimated spend
     * exceeds this value the agent synthesizes a fallback response from
     * accumulated tool results instead of making further LLM calls.
     *
     * Set to 0 to disable (equivalent to enabled: false).
     */
    maxCostPerTurn: 0.50,
  },

  // ── Confidentiality ─────────────────────────────────────────────────
  confidentiality: {
    /** Master toggle — when false, all content passes through unfiltered. */
    enabled: false,

    /** Default clearance for agents created without an explicit profile. */
    defaultClearance: 'restricted',

    /** Path to workspace-level policies file (relative to workingDir). */
    policiesFile: 'confidentiality-policies.json',

    /** SensitivityTagger settings. */
    tagger: {
      /** Enable rule-based classification. */
      ruleBasedEnabled: true,
      /** Enable LLM-assisted classification (Phase 3+). */
      llmAssistedEnabled: false,
      /** Custom regex patterns: { categoryName: [regexString, ...] } */
      customPatterns: {},
    },

    /** View compilation settings. */
    viewCompilation: {
      /** Whether to compile views on history entries. */
      compileHistory: true,
      /** Whether to compile views on pre-routed file content. */
      compilePreRouted: true,
      /** Whether to compile views on system prompt sections. */
      compileSystemPrompt: true,
    },

    /** Lineage tracking settings. */
    lineage: {
      /** Whether to track artifact lineage. */
      enabled: true,
      /** Max lineage records to keep in memory per workspace. */
      maxRecords: 10000,
      /** Whether to persist lineage to disk. */
      persist: true,
    },

    /** Routing settings. */
    routing: {
      /** Whether automatic task decomposition is enabled. */
      autoDecompose: false,
      /** Whether to auto-create agents when no eligible agent exists. */
      autoCreateAgents: true,
      /** Max agents that can be auto-created per routing operation. */
      maxAutoCreatedAgents: 3,
    },
  },
};

// ════════════════════════════════════════════════════════════════════════
// Deep Merge Utility
// ════════════════════════════════════════════════════════════════════════

/**
 * Deep-merge `source` into `target`, returning a new object.
 * Arrays are replaced (not concatenated).
 *
 * @param {Object} target
 * @param {Object} source
 * @returns {Object}
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];

    if (
      srcVal !== null &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(tgtVal, srcVal);
    } else {
      result[key] = srcVal;
    }
  }

  return result;
}

// ════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════

/**
 * Resolve a user-supplied configuration against the unified defaults.
 *
 * Any keys provided in `userConfig` override the corresponding defaults;
 * missing keys retain their default values.  Nested objects are deep-merged.
 *
 * @param {Object} [userConfig={}] — partial overrides
 * @returns {Object} — fully-resolved configuration
 */
export function resolveUnifiedConfig(userConfig = {}) {
  return deepMerge(UNIFIED_CONFIG, userConfig);
}

export default UNIFIED_CONFIG;
