/**
 * AgenticProviderRegistry — manages registered agentic providers
 * and tracks which one is currently active.
 *
 * @module src/core/agentic/provider-registry
 */

export class AgenticProviderRegistry {
    constructor() {
        /** @type {Map<string, import('./base-provider.mjs').AgenticProvider>} */
        this._providers = new Map();

        /** @type {import('./base-provider.mjs').AgenticProvider|null} */
        this._active = null;
    }

    /**
     * Register an AgenticProvider instance.
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
     * Switch the active provider.
     * Disposes the previous provider and initializes the new one.
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

        // Dispose current provider
        if (this._active && this._active !== provider) {
            try {
                await this._active.dispose();
            } catch (e) {
                console.warn(`[AgenticProviderRegistry] Error disposing provider "${this._active.id}":`, e.message);
            }
        }

        // Initialize the new provider
        await provider.initialize(deps);
        this._active = provider;

        console.log(`[AgenticProviderRegistry] Active provider: ${provider.name} (${provider.id})`);
        return provider;
    }

    /**
     * Check if a provider with the given ID is registered.
     * @param {string} id
     * @returns {boolean}
     */
    has(id) {
        return this._providers.has(id);
    }
}
