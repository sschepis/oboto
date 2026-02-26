/**
 * PluginManager — central orchestrator for the plugin system.
 * 
 * Handles plugin lifecycle: discovery → loading → activation → deactivation.
 * Exposes methods for the WS handler and UI to manage plugins.
 * 
 * @module src/plugins/plugin-manager
 */

import { PluginLoader } from './plugin-loader.mjs';
import { createPluginAPI } from './plugin-api.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';
import fs from 'fs/promises';
import path from 'path';

const PLUGIN_ACTIVATE_TIMEOUT = 15_000; // 15 seconds

/**
 * @typedef {object} PluginInstance
 * @property {string} name
 * @property {string} status — 'discovered' | 'active' | 'error' | 'disabled'
 * @property {import('./plugin-loader.mjs').DiscoveredPlugin} discovered
 * @property {object} [module] — the loaded entry module
 * @property {object} [api] — the PluginAPI instance
 * @property {string} [error] — error message if status === 'error'
 */

export class PluginManager {
    /**
     * @param {object} options
     * @param {string} options.workingDir — workspace root
     * @param {object} [options.toolExecutor]
     * @param {object} [options.wsDispatcher]
     * @param {object} [options.eventBus]
     * @param {object} [options.surfaceManager]
     * @param {object} [options.aiProvider]
     */
    constructor(options = {}) {
        this.workingDir = options.workingDir || process.cwd();
        this._deps = {
            toolExecutor: options.toolExecutor || null,
            wsDispatcher: options.wsDispatcher || null,
            eventBus: options.eventBus || null,
            surfaceManager: options.surfaceManager || null,
            aiProvider: options.aiProvider || null,
            workingDir: this.workingDir,
            pluginManager: this,
            _broadcast: null // Set by web-server after construction
        };

        this.loader = new PluginLoader(this.workingDir);

        /** @type {Map<string, PluginInstance>} */
        this.plugins = new Map();

        /** @type {Array<{pluginName: string, hook: string, fn: Function}>} */
        this._middlewareStack = [];

        /** @type {Set<string>} */
        this._disabledPlugins = new Set();

        /** @type {import('./plugin-installer.mjs').PluginInstaller|null} */
        this._installer = null;

        this._initialized = false;

        /** @type {Promise<void>|null} — guards against concurrent initialize() calls */
        this._initializing = null;
    }

    /**
     * Update dependencies (e.g. after workspace change).
     * @param {object} deps
     */
    updateDeps(deps) {
        Object.assign(this._deps, deps);
        this._deps.pluginManager = this;
    }

    /**
     * Get or lazily create the PluginInstaller instance.
     * @returns {Promise<import('./plugin-installer.mjs').PluginInstaller>}
     */
    async getInstaller() {
        if (!this._installer) {
            const { PluginInstaller } = await import('./plugin-installer.mjs');
            this._installer = new PluginInstaller({
                workingDir: this.workingDir,
                pluginManager: this,
                eventBus: this._deps.eventBus || null,
            });
        }
        return this._installer;
    }

    /**
     * Set the WS dispatcher (called by web-server.mjs after construction).
     * @param {import('../server/ws-dispatcher.mjs').WsDispatcher} dispatcher
     */
    setWsDispatcher(dispatcher) {
        this._deps.wsDispatcher = dispatcher;
    }

    /**
     * Set the broadcast function (called by web-server.mjs after construction).
     * @param {Function} broadcastFn — (type, payload) => void
     */
    setBroadcast(broadcastFn) {
        this._deps._broadcast = broadcastFn;
    }

    /**
     * Initialize: discover and activate all plugins.
     * Uses parallel activation via Promise.allSettled to prevent one slow
     * plugin from blocking all others during server boot.
     * Guarded against concurrent calls — if already initializing, the
     * in-flight promise is returned instead of starting a second run.
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this._initialized) return;
        // Guard against concurrent calls: return the in-flight promise
        if (this._initializing) return this._initializing;
        this._initializing = this._doInitialize();
        try {
            await this._initializing;
        } finally {
            this._initializing = null;
        }
    }

    /**
     * Internal initialization logic. Called only by initialize().
     * @private
     */
    async _doInitialize() {
        try {
            // Load disabled list
            await this._loadDisabledList();

            // Discover plugins
            const initStart = Date.now();
            const discovered = await this.loader.discover();
            consoleStyler.log('plugin', `Discovered ${discovered.length} plugin(s)`);

            // Register all discovered plugins
            const toActivate = [];
            for (const plugin of discovered) {
                this.plugins.set(plugin.name, {
                    name: plugin.name,
                    status: 'discovered',
                    discovered: plugin,
                    module: null,
                    api: null,
                    error: null
                });

                // Skip disabled plugins
                if (this._disabledPlugins.has(plugin.name)) {
                    this.plugins.get(plugin.name).status = 'disabled';
                    consoleStyler.log('plugin', `Skipping disabled plugin: ${plugin.name}`);
                    continue;
                }

                toActivate.push(plugin.name);
            }

            // Activate all plugins in parallel. Each _activatePlugin has its
            // own timeout guard, so a stuck plugin won't block the others.
            const results = await Promise.allSettled(
                toActivate.map(async (name) => {
                    const startTime = Date.now();
                    const success = await this._activatePlugin(name);
                    const elapsed = Date.now() - startTime;
                    if (elapsed > 1000) {
                        consoleStyler.log('warning', `Slow activation: ${name} took ${elapsed}ms`);
                    }
                    return { name, success, elapsed };
                })
            );

            // Log any unexpected rejections (shouldn't happen since _activatePlugin
            // has its own try/catch, but guards against truly unexpected errors)
            for (const r of results) {
                if (r.status === 'rejected') {
                    consoleStyler.log('error', `Unexpected activation rejection: ${r.reason?.message || r.reason}`);
                }
            }

            const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
            const failed = toActivate.length - succeeded;

            const totalElapsed = Date.now() - initStart;
            consoleStyler.log('plugin', `Initialization complete in ${totalElapsed}ms (${succeeded} active, ${failed} failed, ${this._disabledPlugins.size} disabled)`);
            this._initialized = true;
        } catch (err) {
            consoleStyler.log('error', `Plugin initialization error: ${err.message}`);
        }
    }

    /**
     * Activate a single plugin.
     * @param {string} name
     * @returns {Promise<boolean>}
     * @private
     */
    async _activatePlugin(name) {
        const instance = this.plugins.get(name);
        if (!instance) {
            consoleStyler.log('warning', `Plugin not found: ${name}`);
            return false;
        }

        try {
            // Load module
            const module = await this.loader.loadModule(instance.discovered);
            instance.module = module;

            // Create scoped API
            const api = createPluginAPI(name, this._deps, { source: instance.discovered.source });
            instance.api = api;

            // Auto-register UI components from manifest
            this._registerManifestUI(name, instance.discovered.manifest, api);

            // Call activate with a timeout to prevent one plugin from blocking others
            if (typeof module.activate === 'function') {
                const activatePromise = module.activate(api);
                // Capture the original rejection so we can prefer it over a generic timeout error
                let activateError = null;
                activatePromise.catch(err => { activateError = err; });
                let timeoutId;
                try {
                    await Promise.race([
                        activatePromise,
                        new Promise((_, reject) => {
                            timeoutId = setTimeout(() => reject(new Error(
                                `Plugin activation timed out after ${PLUGIN_ACTIVATE_TIMEOUT / 1000}s`
                            )), PLUGIN_ACTIVATE_TIMEOUT);
                        })
                    ]);
                } catch (raceErr) {
                    // Clean up any partial registrations the plugin may have made
                    // before the timeout fired.
                    if (typeof api._cleanup === 'function') {
                        try { await api._cleanup(); } catch { /* ignore cleanup errors */ }
                    }
                    // Prefer the real activation error over a generic timeout error
                    throw activateError || raceErr;
                } finally {
                    clearTimeout(timeoutId);
                }
            }

            instance.status = 'active';
            consoleStyler.log('plugin', `Activated: ${name} (${instance.discovered.source})`);

            // Emit event
            if (this._deps.eventBus) {
                this._deps.eventBus.emit('plugin:activated', { name, source: instance.discovered.source });
            }

            return true;
        } catch (err) {
            instance.status = 'error';
            instance.error = err.message;
            consoleStyler.log('error', `Failed to activate ${name}: ${err.message}`);
            return false;
        }
    }

    /**
     * Register UI components declared in the plugin manifest.
     * @param {string} pluginName
     * @param {object} manifest
     * @param {object} api — PluginAPI instance
     * @private
     */
    _registerManifestUI(pluginName, manifest, api) {
        if (!manifest.ui) return;

        // Register tabs from manifest
        if (manifest.ui.tabs && Array.isArray(manifest.ui.tabs)) {
            for (const tab of manifest.ui.tabs) {
                api.ui.registerTab(tab);
            }
        }

        // Register settings panel from manifest
        if (manifest.ui.settingsPanel) {
            api.ui.registerSettingsPanel({
                id: 'settings',
                label: manifest.name || pluginName,
                component: manifest.ui.settingsPanel
            });
        }

        // Register sidebar section from manifest
        if (manifest.ui.sidebarSection) {
            api.ui.registerSidebarSection({
                id: 'sidebar',
                label: manifest.name || pluginName,
                component: manifest.ui.sidebarSection
            });
        }
    }

    /**
     * Deactivate a plugin.
     * @param {string} name
     * @returns {Promise<boolean>}
     */
    async deactivatePlugin(name) {
        const instance = this.plugins.get(name);
        if (!instance || instance.status !== 'active') return false;

        try {
            // Call deactivate hook
            if (instance.module && typeof instance.module.deactivate === 'function') {
                await instance.module.deactivate(instance.api);
            }

            // Clean up all registrations
            if (instance.api && typeof instance.api._cleanup === 'function') {
                await instance.api._cleanup();
            }

            instance.status = 'disabled';
            instance.module = null;
            instance.api = null;

            consoleStyler.log('plugin', `Deactivated: ${name}`);

            if (this._deps.eventBus) {
                this._deps.eventBus.emit('plugin:deactivated', { name });
            }

            return true;
        } catch (err) {
            consoleStyler.log('error', `Error deactivating plugin ${name}: ${err.message}`);
            instance.status = 'error';
            instance.error = err.message;
            return false;
        }
    }

    /**
     * Enable a previously disabled plugin and activate it.
     * @param {string} name
     * @returns {Promise<boolean>}
     */
    async enablePlugin(name) {
        this._disabledPlugins.delete(name);
        await this._saveDisabledList();

        const instance = this.plugins.get(name);
        if (instance && (instance.status === 'disabled' || instance.status === 'error')) {
            return await this._activatePlugin(name);
        }
        return false;
    }

    /**
     * Disable an active plugin.
     * @param {string} name
     * @returns {Promise<boolean>}
     */
    async disablePlugin(name) {
        this._disabledPlugins.add(name);
        await this._saveDisabledList();

        if (this.plugins.has(name) && this.plugins.get(name).status === 'active') {
            return await this.deactivatePlugin(name);
        }
        return true;
    }

    /**
     * Reload a plugin (deactivate then reactivate).
     * @param {string} name
     * @returns {Promise<boolean>}
     */
    async reloadPlugin(name) {
        await this.deactivatePlugin(name);
        return await this._activatePlugin(name);
    }

    /**
     * List all plugins with their status.
     * @returns {Array<{name: string, status: string, source: string, version: string, description: string, error: string|null, ui: object}>}
     */
    listPlugins() {
        return Array.from(this.plugins.values()).map(p => ({
            name: p.name,
            status: p.status,
            source: p.discovered.source,
            version: p.discovered.manifest.version || '0.0.0',
            description: p.discovered.manifest.description || '',
            error: p.error,
            capabilities: p.discovered.manifest.capabilities || {},
            ui: p.api?._registeredUIComponents || { tabs: [], sidebarSections: [], settingsPanels: [] },
            reloadCount: this.loader.getReloadCount(p.name)
        }));
    }

    /**
     * Get a plugin by name.
     * @param {string} name
     * @returns {PluginInstance|undefined}
     */
    getPlugin(name) {
        return this.plugins.get(name);
    }

    /**
     * Get all UI components from all active plugins.
     * @returns {object}
     */
    getAllUIComponents() {
        const tabs = [];
        const sidebarSections = [];
        const settingsPanels = [];

        for (const instance of this.plugins.values()) {
            if (instance.status !== 'active' || !instance.api) continue;
            const ui = instance.api._registeredUIComponents;
            tabs.push(...ui.tabs);
            sidebarSections.push(...ui.sidebarSections);
            settingsPanels.push(...ui.settingsPanels);
        }

        return { tabs, sidebarSections, settingsPanels };
    }

    /**
     * Get the JSX source of a plugin UI component.
     * @param {string} pluginName
     * @param {string} componentFile
     * @returns {Promise<string|null>}
     */
    async getPluginComponentSource(pluginName, componentFile) {
        const instance = this.plugins.get(pluginName);
        if (!instance) return null;
        return await this.loader.loadUIComponentSource(
            instance.discovered.dir,
            componentFile
        );
    }

    /**
     * Get all plugin tool schemas for AI tool registration.
     * @returns {Array}
     */
    getPluginToolSchemas() {
        if (this._deps.toolExecutor?._pluginSchemas) {
            return [...this._deps.toolExecutor._pluginSchemas.values()];
        }
        return [];
    }

    // ── Middleware ────────────────────────────────────────────────────────

    /**
     * Register a middleware entry (called by PluginAPI).
     * @param {{pluginName: string, hook: string, fn: Function}} entry
     * @internal
     */
    _registerMiddleware(entry) {
        this._middlewareStack.push(entry);
    }

    /**
     * Unregister a middleware entry (called by PluginAPI cleanup).
     * @param {{pluginName: string, hook: string, fn: Function}} entry
     * @internal
     */
    _unregisterMiddleware(entry) {
        const idx = this._middlewareStack.indexOf(entry);
        if (idx >= 0) this._middlewareStack.splice(idx, 1);
    }

    /**
     * Execute middleware for a given hook.
     *
     * @experimental Not yet wired into the tool execution pipeline.
     *
     * @param {string} hook — e.g. 'before:tool-execute'
     * @param {object} context — hook-specific context
     * @returns {Promise<object>} — possibly modified context
     */
    async executeMiddleware(hook, context) {
        const relevant = this._middlewareStack.filter(m => m.hook === hook);
        if (relevant.length === 0) return context;

        let currentIdx = 0;
        const next = async () => {
            currentIdx++;
            if (currentIdx < relevant.length) {
                return await relevant[currentIdx].fn(context, next);
            }
            return context;
        };

        return await relevant[0].fn(context, next);
    }

    // ── Disabled list persistence ────────────────────────────────────────

    /**
     * Load the list of disabled plugins from `.plugins-data/.disabled.json`.
     * @private
     */
    async _loadDisabledList() {
        try {
            const filePath = path.join(this.workingDir, '.plugins-data', '.disabled.json');
            const raw = await fs.readFile(filePath, 'utf8');
            const list = JSON.parse(raw);
            if (Array.isArray(list)) {
                this._disabledPlugins = new Set(list);
            }
        } catch {
            // No disabled list — all plugins enabled
        }
    }

    /**
     * Save the disabled list.
     * @private
     */
    async _saveDisabledList() {
        try {
            const dir = path.join(this.workingDir, '.plugins-data');
            const filePath = path.join(dir, '.disabled.json');
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(filePath, JSON.stringify(Array.from(this._disabledPlugins), null, 2), 'utf8');
        } catch (err) {
            consoleStyler.log('warning', `Failed to save disabled plugin list: ${err.message}`);
        }
    }

    // ── Shutdown ─────────────────────────────────────────────────────────

    /**
     * Gracefully shut down all active plugins.
     * @returns {Promise<void>}
     */
    async shutdown() {
        for (const [name, instance] of this.plugins) {
            if (instance.status === 'active') {
                try {
                    await this.deactivatePlugin(name);
                } catch (err) {
                    consoleStyler.log('error', `Error shutting down plugin ${name}: ${err.message}`);
                }
            }
        }
    }

    /**
     * Shut down all plugins, clear state, and re-discover/activate.
     * Used after workspace switches where the same PluginManager instance
     * needs to be reused with potentially different plugin directories.
     *
     * @param {object} [options]
     * @param {string} [options.workingDir] — new workspace root (updates loader & deps)
     * @returns {Promise<void>}
     */
    async reinitialize(options = {}) {
        await this.shutdown();
        this._initialized = false;
        this._initializing = null;
        this.plugins.clear();
        this._middlewareStack.length = 0;
        this._disabledPlugins.clear();

        // Update workspace root if a new directory was provided
        if (options.workingDir && options.workingDir !== this.workingDir) {
            this.workingDir = options.workingDir;
            this._deps.workingDir = options.workingDir;
            // Preserve reload counts across loader instances to prevent unbounded
            // ES module cache growth when switching workspaces back and forth.
            const prevReloadCounts = this.loader._reloadCounts;
            this.loader = new PluginLoader(this.workingDir);
            this.loader._reloadCounts = prevReloadCounts;
            // Reset installer so it picks up the new workingDir on next use
            this._installer = null;
        }

        await this.initialize();
    }
}
