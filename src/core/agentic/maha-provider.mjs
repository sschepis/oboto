/**
 * MahaProvider - unified agentic provider that routes requests to the best-fit
 * provider (Eventic, Cognitive, or LMScript) based on input intent and complexity.
 *
 * Routing uses a complexity scoring system (#38) and health checks (#1) to
 * decide the target provider. EventicProvider delegation (#42) avoids code
 * duplication in _runEventic().
 *
 * @module src/core/agentic/maha-provider
 */

import { AgenticProvider } from './base-provider.mjs';
import { CognitiveProvider } from './cognitive-provider.mjs';
import { LMScriptProvider } from './lmscript/index.mjs';
import { classifyInput } from './cognitive/task-planner.mjs';
import { consoleStyler } from '../../ui/console-styler.mjs';
import { emitStatus } from '../status-reporter.mjs';

const RE_LMSCRIPT_COMMAND = /^\s*COMMAND\b/i;
const RE_LMSCRIPT_PIPE = /\|\s*COMMAND\b/i;
const RE_LMSCRIPT_HINT = /\b(lmscript|cli\s*command|command\s+pipeline|holographic\s+memory)\b/i;

/** Default complexity threshold: scores >= this route to CognitiveProvider */
const DEFAULT_COMPLEXITY_THRESHOLD = 3;

export class MahaProvider extends AgenticProvider {
    get id() { return 'maha'; }
    get name() { return 'Maha Provider'; }
    get description() {
        return 'Unified router that selects Eventic, Cognitive, or LMScript per request for the best fit.';
    }

    /**
     * @param {Object} [options]
     * @param {number} [options.complexityThreshold] — score threshold for cognitive routing (default 3)
     */
    constructor(options = {}) {
        super();
        /** @type {number} */
        this._complexityThreshold = options.complexityThreshold ?? DEFAULT_COMPLEXITY_THRESHOLD;
        /** @private Track whether sub-providers were obtained from registry (not owned by us) */
        this._cognitiveFromRegistry = false;
        this._lmscriptFromRegistry = false;
    }

    async initialize(deps) {
        // Only dispose providers we own (locally created, not from registry)
        if (this._cognitive && !this._cognitiveFromRegistry) {
            await this._cognitive.dispose();
        }
        this._cognitive = null;
        this._cognitiveFromRegistry = false;
        if (this._lmscript && !this._lmscriptFromRegistry) {
            await this._lmscript.dispose();
        }
        this._lmscript = null;
        this._lmscriptFromRegistry = false;
        await super.initialize(deps);
        this._lastProviderId = null;
    }

    /**
     * Route and process input through the best-fit provider.
     * Includes health-check fallback: if the selected provider is unhealthy,
     * falls back to EventicProvider (#1).
     * @param {string} input
     * @param {Object} [options]
     * @returns {Promise<{response: string, streamed?: boolean, tokenUsage?: Object}>}
     */
    async run(input, options = {}) {
        if (!this._deps) {
            throw new Error('MahaProvider not initialized. Call initialize() first.');
        }

        const { route, score } = this._selectProvider(input);
        this._lastProviderId = route;
        emitStatus(`Maha routing -> ${route} (complexity: ${score})`);

        try {
            if (route === 'lmscript') {
                const provider = await this._getLMScriptProvider();
                // Health check before routing (#1)
                const health = await provider.healthCheck();
                if (!health.healthy) {
                    consoleStyler.log('warning',
                        `MahaProvider: lmscript unhealthy (${health.reason}) — falling back to eventic`
                    );
                    return await this._runEventic(input, options);
                }
                return await provider.run(input, options);
            }
            if (route === 'cognitive') {
                const provider = await this._getCognitiveProvider();
                // Health check before routing (#1)
                const health = await provider.healthCheck();
                if (!health.healthy) {
                    consoleStyler.log('warning',
                        `MahaProvider: cognitive unhealthy (${health.reason}) — falling back to eventic`
                    );
                    return await this._runEventic(input, options);
                }
                return await provider.run(input, options);
            }
            return await this._runEventic(input, options);
        } catch (err) {
            if (route !== 'eventic') {
                consoleStyler.log('warning',
                    `MahaProvider "${route}" failed - falling back to eventic: ${err.message}`
                );
                return await this._runEventic(input, options);
            }
            throw err;
        }
    }

    /**
     * Score input complexity to decide routing (#38).
     * Higher score → CognitiveProvider, lower → EventicProvider.
     * @param {string} input
     * @returns {number} 0-10 complexity score
     * @private
     */
    _scoreComplexity(input) {
        let score = 0;
        const text = (input || '').trim();
        if (!text) return 0;

        // Length-based scoring
        if (text.length > 500) score += 2;
        else if (text.length > 200) score += 1;

        // Multi-step indicators
        if (/\b(?:first|then|next|after that|finally|step\s+\d)\b/i.test(text)) score += 2;

        // Code/file references
        if (/```/.test(text) || /\b(?:src|lib|config)\/\S+/.test(text)) score += 1;

        // Tool-requiring verbs
        if (/\b(?:write|create|edit|modify|delete|build|deploy|install|refactor)\b/i.test(text)) score += 2;

        // Analysis/research requests
        if (/\b(?:analyze|research|compare|evaluate|audit|review)\b/i.test(text)) score += 1;

        // Simple conversational indicators (reduce score)
        if (/^(?:what|who|when|where|why|how|explain|define|describe)\s/i.test(text) && text.length < 100) score -= 1;
        if (/\?$/.test(text) && text.length < 80) score -= 1;

        return Math.max(0, Math.min(10, score));
    }

    /**
     * Decide which provider to use for this input.
     * Uses LMScript detection first, then complexity scoring (#38),
     * with fallback to the legacy classifyInput() as a tiebreaker.
     * @param {string} input
     * @returns {'eventic'|'cognitive'|'lmscript'}
     * @private
     */
    _selectProvider(input) {
        const text = (input || '').trim();
        const score = this._scoreComplexity(text);
        if (!text) return { route: 'eventic', score };

        // LMScript detection takes priority
        if (this._looksLikeLMScript(text)) {
            return { route: 'lmscript', score };
        }

        // Complexity scoring (#38)
        if (score >= this._complexityThreshold) {
            return { route: 'cognitive', score };
        }

        // Fallback: use legacy classifyInput as additional signal
        const legacyComplexity = classifyInput(text);
        if (legacyComplexity === 'complex') {
            return { route: 'cognitive', score };
        }

        return { route: 'eventic', score };
    }

    _looksLikeLMScript(text) {
        return RE_LMSCRIPT_COMMAND.test(text) ||
            RE_LMSCRIPT_PIPE.test(text) ||
            RE_LMSCRIPT_HINT.test(text);
    }

    async _getCognitiveProvider() {
        if (!this._cognitive) {
            // Check registry first to avoid duplicate provider instances (#45)
            const registry = this._deps?.registry;
            const existing = registry?.getProvider?.('cognitive') || registry?.get?.('cognitive');
            if (existing) {
                this._cognitive = existing;
                this._cognitiveFromRegistry = true;
            } else {
                this._cognitive = new CognitiveProvider();
                this._cognitiveFromRegistry = false;
                await this._cognitive.initialize(this._deps);
            }
        }
        return this._cognitive;
    }

    async _getLMScriptProvider() {
        if (!this._lmscript) {
            // Check registry first to avoid duplicate provider instances (#45)
            const registry = this._deps?.registry;
            const existing = registry?.getProvider?.('lmscript') || registry?.get?.('lmscript');
            if (existing) {
                this._lmscript = existing;
                this._lmscriptFromRegistry = true;
            } else {
                this._lmscript = new LMScriptProvider();
                this._lmscriptFromRegistry = false;
                await this._lmscript.initialize(this._deps);
            }
        }
        return this._lmscript;
    }

    /**
     * Run input through the EventicProvider (#42 — delegate instead of duplicate).
     * Tries to obtain EventicProvider from the registry first; falls back to
     * direct engine.dispatch() if registry is unavailable.
     * @param {string} input
     * @param {Object} options
     * @returns {Promise<{response: string, tokenUsage: Object|null}>}
     * @private
     */
    async _runEventic(input, options = {}) {
        // Delegate to the eventic provider directly instead of duplicating dispatch logic (#42)
        const registry = this._deps?.registry;
        if (registry) {
            const eventicProvider = registry.getProvider?.('eventic') || registry.get?.('eventic');
            if (eventicProvider) {
                return eventicProvider.run(input, options);
            }
        }

        // Fallback: direct dispatch if registry not available
        const { engine, aiProvider } = this._deps;
        if (!engine || !aiProvider) {
            throw new Error('MahaProvider missing engine or aiProvider dependency.');
        }

        const result = await engine.dispatch('AGENT_START', {
            input,
            signal: options.signal,
            stream: options.stream,
            onChunk: options.onChunk,
            model: options.model || undefined,
        });
        const response = result?.response || '';
        return {
            response: response.trim() ? response : 'No response generated.',
            tokenUsage: result?.tokenUsage || null,
        };
    }

    getDiagnostics() {
        return {
            lastProviderId: this._lastProviderId,
            complexityThreshold: this._complexityThreshold,
            cognitive: this._cognitive?.getDiagnostics?.() || null,
            lmscript: this._lmscript?.getDiagnostics?.() || null
        };
    }

    async dispose() {
        // Dispose only providers that MahaProvider owns (locally created).
        // Registry-obtained providers are managed by the AgenticProviderRegistry
        // (standby/disposeAll) — disposing them here would cause double-dispose.
        if (this._cognitive && !this._cognitiveFromRegistry) {
            await this._cognitive.dispose();
        }
        this._cognitive = null;
        this._cognitiveFromRegistry = false;
        if (this._lmscript && !this._lmscriptFromRegistry) {
            await this._lmscript.dispose();
        }
        this._lmscript = null;
        this._lmscriptFromRegistry = false;
        this._lastProviderId = null;
        await super.dispose();
    }
}
