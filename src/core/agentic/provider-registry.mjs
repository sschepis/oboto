/**
 * AgenticProviderRegistry — manages registered agentic providers
 * and tracks which one is currently active.
 *
 * @module src/core/agentic/provider-registry
 */

import { consoleStyler } from '../../ui/console-styler.mjs';

export class AgenticProviderRegistry {
    /**
     * @param {Object} [options]
     * @param {number} [options.standbyTimeoutMs=60000] — ms to keep old provider in warm standby
     */
    constructor(options = {}) {
        /** @type {Map<string, import('./base-provider.mjs').AgenticProvider>} */
        this._providers = new Map();

        /** @type {import('./base-provider.mjs').AgenticProvider|null} */
        this._active = null;

        /** @type {Set<string>} tracks which providers have been initialized */
        this._initialized = new Set();

        /** @type {Map<string, {provider: import('./base-provider.mjs').AgenticProvider, timeout: ReturnType<typeof setTimeout>}>} */
        this._standbyProviders = new Map();

        /** @type {number} warm standby timeout in ms */
        this._standbyTimeoutMs = options.standbyTimeoutMs ?? 60_000;

        /** @type {Object|null} cached deps for lazy init */
        this._deps = null;
    }

    /**
     * Register an AgenticProvider instance.
     * The provider is stored but NOT initialized until first use (lazy init).
     * @param {import('./base-provider.mjs').AgenticProvider} provider
     */
    register(provider) {
        if (!provider || !provider.id) {
            throw new Error('Provider must have an id');
        }
        this._providers.set(provider.id, provider);
    }

    /**
     * Get a provider by ID.
     * @param {string} id
     * @returns {import('./base-provider.mjs').AgenticProvider|undefined}
     */
    get(id) {
        return this._providers.get(id);
    }

    /**
     * Alias for get() — used by MahaProvider for deduplication.
     * @param {string} id
     * @returns {import('./base-provider.mjs').AgenticProvider|undefined}
     */
    getProvider(id) {
        return this._providers.get(id);
    }

    /**
     * List all registered providers as an array of { id, name, description, active }.
     * @returns {Array<{id: string, name: string, description: string, active: boolean}>}
     */
    list() {
        return Array.from(this._providers.values()).map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            active: p === this._active
        }));
    }

    /**
     * Get the currently active provider.
     * @returns {import('./base-provider.mjs').AgenticProvider|null}
     */
    getActive() {
        return this._active;
    }

    /**
     * Ensure a provider is initialized. Called lazily on first use.
     * If the provider is in warm standby, reclaim it without re-initializing.
     * @param {string} id
     * @param {Object} [deps] — dependencies override; falls back to cached _deps
     * @returns {Promise<void>}
     * @private
     */
    async _ensureInitialized(id, deps) {
        // Reclaim from standby if available (already initialized)
        const standby = this._standbyProviders.get(id);
        if (standby) {
            clearTimeout(standby.timeout);
            this._standbyProviders.delete(id);
            // Already initialized — just mark it
            this._initialized.add(id);
            return;
        }

        if (this._initialized.has(id)) return;

        const provider = this._providers.get(id);
        if (!provider) {
            throw new Error(`Cannot initialize unknown provider: "${id}"`);
        }

        const resolvedDeps = deps || this._deps;
        if (!resolvedDeps) {
            throw new Error(`No dependencies available to initialize provider "${id}". Call setActive() with deps first.`);
        }

        await provider.initialize(resolvedDeps);
        this._initialized.add(id);
    }

    /**
     * Switch the active provider.
     * Lazily initializes the new provider if needed.
     * Moves the previous provider to warm standby instead of immediate dispose.
     *
     * @param {string} id — provider ID to activate
     * @param {Object} deps — shared dependencies to pass to initialize()
     * @returns {Promise<import('./base-provider.mjs').AgenticProvider>}
     */
    async setActive(id, deps) {
        const provider = this._providers.get(id);
        if (!provider) {
            throw new Error(`Unknown agentic provider: "${id}". Available: ${Array.from(this._providers.keys()).join(', ')}`);
        }

        // Cache deps for lazy init of other providers
        if (deps) this._deps = deps;

        const prevProvider = this._active;
        const prevId = prevProvider?.id;

        // Lazily initialize the target provider
        await this._ensureInitialized(id, deps);
        this._active = provider;

        // Move previous provider to warm standby instead of immediate dispose
        if (prevProvider && prevProvider !== provider && prevId) {
            this._moveToStandby(prevId, prevProvider);
        }

        consoleStyler.log('agentic', `Active agentic provider: ${provider.name} (${provider.id})`);
        return provider;
    }

    /**
     * Move a provider to warm standby with a timed dispose.
     * @param {string} id
     * @param {import('./base-provider.mjs').AgenticProvider} provider
     * @private
     */
    _moveToStandby(id, provider) {
        // Clear any existing standby entry for this id (sync clear only)
        const existing = this._standbyProviders.get(id);
        if (existing) {
            clearTimeout(existing.timeout);
            this._standbyProviders.delete(id);
            this._initialized.delete(id);
            // Fire-and-forget dispose of the old standby entry
            existing.provider.dispose?.()?.catch?.(e => {
                consoleStyler.log('warning', `Error disposing replaced standby provider "${id}": ${e.message}`);
            });
        }

        const timer = setTimeout(() => {
            this._disposeStandby(id).catch(e => {
                consoleStyler.log('warning', `Standby timeout dispose error for "${id}": ${e.message}`);
            });
        }, this._standbyTimeoutMs);
        // unref() so the standby timer does not keep the Node.js event
        // loop alive and prevent clean process shutdown.
        if (typeof timer.unref === 'function') timer.unref();

        this._standbyProviders.set(id, { provider, timeout: timer });
    }

    /**
     * Dispose a provider in warm standby and remove it from the standby map.
     * @param {string} id
     * @returns {Promise<void>}
     * @private
     */
    async _disposeStandby(id) {
        const entry = this._standbyProviders.get(id);
        if (!entry) return;

        // Race guard: if the provider was reclaimed (moved back to active)
        // between timer fire and async execution, the entry will have been
        // removed by _ensureInitialized.  Double-check it's still in standby.
        if (!this._standbyProviders.has(id)) return;

        clearTimeout(entry.timeout);
        this._standbyProviders.delete(id);
        this._initialized.delete(id);
        try {
            await entry.provider.dispose?.();
        } catch (e) {
            consoleStyler.log('warning', `Error disposing standby provider "${id}": ${e.message}`);
        }
    }

    /**
     * Check if a provider with the given ID is registered.
     * @param {string} id
     * @returns {boolean}
     */
    has(id) {
        return this._providers.has(id);
    }

    /**
     * Dispose all standby providers. Call during shutdown.
     */
    async disposeAll() {
        // Collect IDs first to avoid mutating Map during iteration
        const standbyIds = [...this._standbyProviders.keys()];
        for (const id of standbyIds) {
            await this._disposeStandby(id);
        }
        if (this._active) {
            try {
                await this._active.dispose();
            } catch (e) {
                consoleStyler.log('warning', `Error disposing active provider: ${e.message}`);
            }
            this._active = null;
        }
        this._initialized.clear();
    }
}
