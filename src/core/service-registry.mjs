// ServiceRegistry — Centralized dependency injection container.
// All services are registered once at startup and retrieved by name.
// Replaces the 20+ instance variables and circular `this` references
// in the old MiniAIAssistant.

export class ServiceRegistry {
    constructor() {
        /** @type {Map<string, any>} */
        this._services = new Map();
    }

    /**
     * Register a service by name.
     * @param {string} name
     * @param {any} instance
     * @returns {this} For chaining
     */
    register(name, instance) {
        this._services.set(name, instance);
        return this;
    }

    /**
     * Get a service by name.
     * @param {string} name
     * @returns {any}
     * @throws {Error} If the service is not registered
     */
    get(name) {
        const svc = this._services.get(name);
        if (svc === undefined) {
            throw new Error(`ServiceRegistry: service '${name}' not found. Registered: ${[...this._services.keys()].join(', ')}`);
        }
        return svc;
    }

    /**
     * Check if a service is registered.
     * @param {string} name
     * @returns {boolean}
     */
    has(name) {
        return this._services.has(name);
    }

    /**
     * Get a service by name, or null if not registered.
     * Use this for optional services.
     * @param {string} name
     * @returns {any|null}
     */
    optional(name) {
        return this._services.get(name) ?? null;
    }

    /**
     * List all registered service names.
     * @returns {string[]}
     */
    list() {
        return [...this._services.keys()];
    }
}
