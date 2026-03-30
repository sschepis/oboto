/**
 * SupportLLM — Invisible Local LLM Abstraction
 *
 * A singleton that provides fast, local LLM inference for auxiliary tasks:
 * classification, sensitivity tagging, task decomposition, next-step
 * generation, and code linting. The user never interacts with or configures
 * this model directly.
 *
 * Internally manages transport selection (WebLLM → LocalProcess → Fallback),
 * capability probing, request queuing, and graceful fallback. Every public
 * method returns `null` on failure so callers can seamlessly fall back to
 * their existing regex / cloud-based behaviour.
 *
 * @see docs/architecture/invisible-local-llm-integration.md
 */

import { WebLLMTransport, FallbackTransport } from './support-llm-transports.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';
import { config } from '../config.mjs';

// ── Request priority levels ────────────────────────────────────────────────
export const Priority = Object.freeze({
    CRITICAL: 'critical',   // Active user turn — classification, routing
    NORMAL:   'normal',     // Next-step generation, lint
    BACKGROUND: 'background', // Summarisation, proactive tasks
});

// ── Default configuration ──────────────────────────────────────────────────
const DEFAULTS = {
    enabled: true,
    preferredTransport: 'auto',
    timeoutMs: 10_000,
    heartbeatIntervalMs: 30_000,
    maxConcurrent: 3,
    dedupeWindowMs: 500,
};

/**
 * Simple request deduplication — identical prompts within a window get
 * collapsed into one in-flight request.
 */
class RequestDeduplicator {
    constructor(windowMs = 500) {
        this._windowMs = windowMs;
        /** @type {Map<string, { promise: Promise, expiry: number }>} */
        this._cache = new Map();
    }

    /** Return a cache key from the request. */
    _key(messages, maxTokens) {
        // Use a cheap hash of messages content + token budget, prefixed
        // with the first 200 chars to reduce collision risk between
        // different prompts that happen to share the same 32-bit hash.
        const raw = JSON.stringify(messages) + ':' + maxTokens;
        const prefix = raw.substring(0, 200);
        let hash = 0;
        for (let i = 0; i < raw.length; i++) {
            hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
        }
        return prefix + '|' + hash;
    }

    /**
     * Return an existing in-flight promise if an identical request was
     * made within the deduplication window.
     * @returns {Promise|null}
     */
    get(messages, maxTokens) {
        const key = this._key(messages, maxTokens);
        const entry = this._cache.get(key);
        if (entry && Date.now() < entry.expiry) {
            return entry.promise;
        }
        this._cache.delete(key);
        return null;
    }

    /** Store a promise for deduplication. */
    set(messages, maxTokens, promise) {
        const key = this._key(messages, maxTokens);
        this._cache.set(key, { promise, expiry: Date.now() + this._windowMs });
    }

    /** Prune expired entries. */
    prune() {
        const now = Date.now();
        for (const [key, entry] of this._cache) {
            if (now >= entry.expiry) this._cache.delete(key);
        }
    }
}

// ── SupportLLM ─────────────────────────────────────────────────────────────

export class SupportLLM {
    /**
     * @param {object} eventBus - Application EventBus instance.
     * @param {object} [options] - Override defaults from config.ai.supportLlm.
     */
    constructor(eventBus, options = {}) {
        const cfg = { ...DEFAULTS, ...config?.ai?.supportLlm, ...options };

        this._eventBus = eventBus;
        this._enabled = cfg.enabled !== false;
        this._transport = null;
        this._ready = false;
        this._capabilities = null;
        this._destroyed = false;

        // Concurrency control
        this._maxConcurrent = cfg.maxConcurrent;
        this._inFlight = 0;

        // Request deduplication
        this._deduplicator = new RequestDeduplicator(cfg.dedupeWindowMs);

        // Transport config
        this._transportConfig = {
            probeTimeoutMs: cfg.probeTimeoutMs ?? 5000,
            requestTimeoutMs: cfg.timeoutMs,
            heartbeatIntervalMs: cfg.heartbeatIntervalMs,
        };

        // Periodic dedup cache pruning (only when enabled)
        this._pruneTimer = this._enabled
            ? setInterval(() => this._deduplicator.prune(), 10_000)
            : null;

        // Listen for the deferred "ready" event from the browser.  When the
        // probe returns "initialising", the transport is kept alive but
        // `_ready` stays false.  This listener promotes the parent to ready
        // once the browser engine finishes loading.
        this._onDeferredReady = (data) => {
            if (this._transport && !this._ready && !this._destroyed) {
                this._capabilities = data;
                this._ready = true;
                consoleStyler.log('info', `🧠 SupportLLM: deferred ready — model: ${data?.model || 'unknown'}`);
            }
        };
        this._eventBus.on('webllm:support:ready', this._onDeferredReady);
    }

    // ── Lifecycle ───────────────────────────────────────────────────────

    /**
     * Attempt to initialise the best available transport.
     * Called by EventicFacade on startup and again whenever a new WS client
     * connects.
     *
     * Transport priority: WebLLMTransport → FallbackTransport
     * (LocalProcessTransport will be added in Phase 6)
     */
    async init() {
        if (this._destroyed || !this._enabled) {
            consoleStyler.log('info', '🧠 SupportLLM: disabled or destroyed — skipping init.');
            return;
        }

        // If a transport is already ready, skip re-init
        if (this._transport?.isReady()) {
            return;
        }

        // Clean up any previous transport
        if (this._transport) {
            this._transport.destroy();
            this._transport = null;
        }

        // Try WebLLMTransport first
        try {
            const webllm = new WebLLMTransport(this._eventBus, this._transportConfig);
            const caps = await webllm.probe();

            if (caps) {
                this._transport = webllm;
                this._capabilities = caps;

                if (caps.initialising) {
                    // Browser client exists but engine is still downloading.
                    // Keep the transport alive — it will flip to ready once the
                    // persistent `_onReady` handler fires.  Mark ourselves as
                    // NOT ready so callers don't attempt generation yet.
                    this._ready = false;
                    consoleStyler.log('info', `🧠 SupportLLM: WebLLMTransport initialising (${caps.state}, ${caps.progress}%) — waiting for engine.`);
                } else {
                    this._ready = true;
                    consoleStyler.log('info', '🧠 SupportLLM: initialised with WebLLMTransport.');
                }
                return;
            }

            // Probe failed — destroy the unused transport
            webllm.destroy();
        } catch (err) {
            consoleStyler.log('warning', `🧠 SupportLLM: WebLLMTransport probe error — ${err.message}`);
        }

        // TODO Phase 6: Try LocalProcessTransport here

        // Fall through to FallbackTransport (always-unavailable stub)
        this._transport = new FallbackTransport();
        this._ready = false;
        this._capabilities = null;
        consoleStyler.log('info', '🧠 SupportLLM: no local transport available — using FallbackTransport.');
    }

    /**
     * Re-probe transports. Call this when a new WebSocket client connects
     * to give the WebLLM transport another chance.
     */
    async reprobeTransport() {
        if (this._destroyed || !this._enabled) return;

        // Only re-probe if we don't already have a working transport
        if (this._transport?.isReady()) return;

        await this.init();
    }

    /** @returns {boolean} True when at least one transport is ready. */
    isAvailable() {
        return this._ready && this._transport?.isReady() && !this._destroyed;
    }

    /** @returns {object|null} Capabilities reported by the active transport. */
    getCapabilities() {
        return this._capabilities;
    }

    /** Shut down the SupportLLM and release resources. */
    destroy() {
        this._destroyed = true;
        this._ready = false;

        if (this._pruneTimer) {
            clearInterval(this._pruneTimer);
            this._pruneTimer = null;
        }

        if (this._onDeferredReady) {
            this._eventBus.off('webllm:support:ready', this._onDeferredReady);
            this._onDeferredReady = null;
        }

        if (this._transport) {
            this._transport.destroy();
            this._transport = null;
        }
    }

    // ── High-Level API ──────────────────────────────────────────────────

    /**
     * Structured classification — instruct the local model to return JSON
     * matching a schema description.
     *
     * Used by IntentRouter, SensitivityTagger, TaskRouter.
     *
     * @param {string} text - Input text to classify.
     * @param {object} schema - JSON schema description (embedded in prompt).
     * @param {string} systemPrompt - Classification instructions.
     * @param {object} [options]
     * @param {number} [options.maxTokens=256]
     * @param {string} [options.priority='normal']
     * @returns {Promise<object|null>} Parsed JSON result, or null on failure.
     */
    async classify(text, schema, systemPrompt, options = {}) {
        if (!this.isAvailable()) return null;

        const maxTokens = options.maxTokens ?? 256;
        const schemaStr = typeof schema === 'string' ? schema : JSON.stringify(schema, null, 2);

        const messages = [
            {
                role: 'system',
                content: `${systemPrompt}\n\nRespond ONLY with valid JSON matching this schema:\n${schemaStr}\n\nDo not include any explanation, markdown, or text outside the JSON.`,
            },
            {
                role: 'user',
                content: text,
            },
        ];

        const raw = await this._dispatch(messages, maxTokens);
        if (!raw) return null;

        // Parse JSON from the response
        return this._parseJSON(raw);
    }

    /**
     * Free-form generation with a tight token budget.
     * Used for next-step generation, summarisation.
     *
     * @param {string} prompt - The prompt text.
     * @param {number} [maxTokens=256]
     * @returns {Promise<string|null>}
     */
    async generate(prompt, maxTokens = 256) {
        if (!this.isAvailable()) return null;

        const messages = [
            { role: 'user', content: prompt },
        ];

        return this._dispatch(messages, maxTokens);
    }

    /**
     * Sensitivity tagging — classify content for sensitivity levels.
     *
     * @param {string} content - The content to analyse.
     * @param {object} context - Additional context (filePath, etc.).
     * @returns {Promise<object|null>} SensitivityMap or null.
     */
    async tagSensitivity(content, context = {}) {
        const SENSITIVITY_SCHEMA = {
            type: 'object',
            properties: {
                category: { type: 'string', enum: ['credential', 'pii', 'internal', 'none'] },
                level: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'none'] },
                spans: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            start: { type: 'number' },
                            end: { type: 'number' },
                            category: { type: 'string' },
                            level: { type: 'string' },
                        },
                    },
                },
            },
        };

        const TAGGER_PROMPT = `You are a data sensitivity classifier. Analyse the following content and identify any sensitive information such as API keys, passwords, tokens, PII (names, emails, phone numbers, SSNs), internal paths, or proprietary data. Classify each sensitive span.`;

        const contextHint = context.filePath ? `\nFile: ${context.filePath}` : '';

        return this.classify(
            content + contextHint,
            SENSITIVITY_SCHEMA,
            TAGGER_PROMPT,
            { maxTokens: 128, priority: Priority.CRITICAL }
        );
    }

    /**
     * Decompose an instruction into subtasks.
     *
     * @param {string} instruction - The full task instruction.
     * @returns {Promise<Array<{instruction: string, requires: number[]}>|null>}
     */
    async decompose(instruction) {
        const DECOMPOSITION_SCHEMA = {
            type: 'object',
            properties: {
                subtasks: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            instruction: { type: 'string' },
                            requires: { type: 'array', items: { type: 'number' } },
                        },
                    },
                },
            },
        };

        const DECOMPOSITION_PROMPT = `You are a task decomposition engine. Given an instruction, break it into 2-6 independent subtasks. Each subtask should be a self-contained action. The "requires" array lists indices of subtasks that must complete first.`;

        const result = await this.classify(
            instruction,
            DECOMPOSITION_SCHEMA,
            DECOMPOSITION_PROMPT,
            { maxTokens: 256, priority: Priority.NORMAL }
        );

        return result?.subtasks ?? null;
    }

    /**
     * Generate context-aware next-step suggestions.
     *
     * @param {string} userInput
     * @param {string} aiResponse
     * @returns {Promise<Array<{id: string, label: string, icon: string}>|null>}
     */
    async generateNextSteps(userInput, aiResponse) {
        const NEXT_STEPS_SCHEMA = {
            type: 'object',
            properties: {
                suggestions: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            label: { type: 'string' },
                            icon: { type: 'string' },
                        },
                    },
                },
            },
        };

        const NEXT_STEPS_PROMPT = `Given a conversation exchange, suggest 1-4 logical next actions the user might want to take. Each suggestion must be specific to the conversation content, not generic.`;

        const result = await this.classify(
            `User: ${userInput}\nAssistant: ${aiResponse}`,
            NEXT_STEPS_SCHEMA,
            NEXT_STEPS_PROMPT,
            { maxTokens: 128, priority: Priority.NORMAL }
        );

        return result?.suggestions?.slice(0, 4) ?? null;
    }

    /**
     * Fast syntax / lint check for generated code.
     *
     * @param {string} code - The code to check.
     * @param {string} language - Programming language.
     * @returns {Promise<{valid: boolean, errors: Array, fixed?: string}|null>}
     */
    async lint(code, language) {
        const LINT_SCHEMA = {
            type: 'object',
            properties: {
                valid: { type: 'boolean' },
                errors: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            line: { type: 'number' },
                            message: { type: 'string' },
                        },
                    },
                },
                fixed: { type: 'string' },
            },
        };

        const LINT_PROMPT = `Check this ${language} code for syntax errors, missing imports, and obvious bugs. If errors are found and you can fix them, include the fixed code.`;

        return this.classify(
            code,
            LINT_SCHEMA,
            LINT_PROMPT,
            { maxTokens: 512, priority: Priority.NORMAL }
        );
    }

    /**
     * Summarise text within a token budget.
     *
     * @param {string} text - Text to summarise.
     * @param {number} [maxTokens=256]
     * @returns {Promise<string|null>}
     */
    async summarize(text, maxTokens = 256) {
        return this.generate(
            `Summarise the following text concisely:\n\n${text}`,
            maxTokens
        );
    }

    // ── Internal dispatch ───────────────────────────────────────────────

    /**
     * Core dispatch method: handles deduplication, concurrency, and
     * transport routing.
     *
     * @param {Array} messages - Chat-format messages.
     * @param {number} maxTokens
     * @returns {Promise<string|null>}
     */
    async _dispatch(messages, maxTokens) {
        if (!this.isAvailable()) return null;

        // Check deduplication cache
        const cached = this._deduplicator.get(messages, maxTokens);
        if (cached) return cached;

        // Concurrency gate
        if (this._inFlight >= this._maxConcurrent) {
            consoleStyler.log('warning', '🧠 SupportLLM: max concurrent requests reached — dropping request.');
            return null;
        }

        this._inFlight++;

        const promise = this._doGenerate(messages, maxTokens);
        this._deduplicator.set(messages, maxTokens, promise);

        try {
            return await promise;
        } finally {
            this._inFlight--;
        }
    }

    /**
     * Perform the actual generation through the active transport.
     * @returns {Promise<string|null>}
     */
    async _doGenerate(messages, maxTokens) {
        try {
            const result = await this._transport.generate({
                messages,
                temperature: 0.1,
                max_tokens: maxTokens,
            });

            if (!result) return null;

            // The transport may return different shapes depending on the engine.
            // Normalize to a plain string.
            if (typeof result === 'string') return result;
            if (result.choices?.[0]?.message?.content) return result.choices[0].message.content;
            if (result.content) return result.content;
            if (result.text) return result.text;

            return typeof result === 'object' ? JSON.stringify(result) : String(result);
        } catch (err) {
            consoleStyler.log('warning', `🧠 SupportLLM: generation error — ${err.message}`);
            return null;
        }
    }

    /**
     * Attempt to parse JSON from a model response.
     * Handles common issues like markdown fences and trailing text.
     * @returns {object|null}
     */
    _parseJSON(raw) {
        if (!raw || typeof raw !== 'string') return null;

        // Strip markdown code fences if present
        let cleaned = raw.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }

        // Try direct parse
        try {
            return JSON.parse(cleaned);
        } catch {
            // Try to extract a JSON object from the text
            const match = cleaned.match(/\{[\s\S]*\}/);
            if (match) {
                try {
                    return JSON.parse(match[0]);
                } catch {
                    // Give up
                }
            }
        }

        consoleStyler.log('warning', '🧠 SupportLLM: failed to parse JSON from response.');
        return null;
    }
}
