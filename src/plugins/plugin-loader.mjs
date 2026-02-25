/**
 * PluginLoader — discovers and loads plugins from multiple sources.
 * 
 * Discovery order (later overrides earlier on name collision):
 * 1. Built-in plugins (shipped with Oboto)
 * 2. Global plugins (~/.oboto/plugins/)
 * 3. Workspace plugins (.plugins/)
 * 4. npm plugins (package.json "oboto-plugin" keyword)
 * 
 * @module src/plugins/plugin-loader
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {object} PluginManifest
 * @property {string} name
 * @property {string} version
 * @property {string} [description]
 * @property {string} main — entry point relative to plugin dir
 * @property {object} [capabilities]
 * @property {object} [ui]
 * @property {string[]} [permissions]
 */

/**
 * @typedef {object} DiscoveredPlugin
 * @property {string} name
 * @property {string} dir — absolute path to plugin directory
 * @property {PluginManifest} manifest
 * @property {string} source — 'builtin' | 'global' | 'workspace' | 'npm'
 */

export class PluginLoader {
    /**
     * @param {string} workingDir — current workspace root
     */
    constructor(workingDir) {
        this.workingDir = workingDir;
        this.builtinDir = path.resolve(__dirname, '../../plugins');
        this.globalDir = path.join(os.homedir(), '.oboto', 'plugins');
        this.workspaceDir = path.join(workingDir, '.plugins');

        /** @type {Map<string, number>} — tracks reload count per plugin */
        this._reloadCounts = new Map();
    }

    /**
     * Discover all plugins across all sources.
     * @returns {Promise<DiscoveredPlugin[]>}
     */
    async discover() {
        /** @type {Map<string, DiscoveredPlugin>} */
        const plugins = new Map();

        // 1. Built-in plugins
        const builtins = await this._scanDirectory(this.builtinDir, 'builtin');
        for (const p of builtins) {
            plugins.set(p.name, p);
        }

        // 2. Global plugins
        const globals = await this._scanDirectory(this.globalDir, 'global');
        for (const p of globals) {
            plugins.set(p.name, p);
        }

        // 3. Workspace plugins
        const workspace = await this._scanDirectory(this.workspaceDir, 'workspace');
        for (const p of workspace) {
            plugins.set(p.name, p);
        }

        // 4. npm plugins
        const npm = await this._scanNpmPlugins();
        for (const p of npm) {
            // Only add npm plugins if not already overridden by workspace/global
            if (!plugins.has(p.name)) {
                plugins.set(p.name, p);
            }
        }

        return Array.from(plugins.values());
    }

    /**
     * Scan a directory for plugin subdirectories containing plugin.json.
     * @param {string} dir
     * @param {string} source
     * @returns {Promise<DiscoveredPlugin[]>}
     * @private
     */
    async _scanDirectory(dir, source) {
        const results = [];
        try {
            await fs.access(dir);
        } catch {
            return results; // Directory doesn't exist
        }

        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

                const pluginDir = path.join(dir, entry.name);
                const manifest = await this._loadManifest(pluginDir);
                if (manifest) {
                    results.push({
                        name: manifest.name || entry.name,
                        dir: pluginDir,
                        manifest,
                        source
                    });
                }
            }
        } catch (err) {
            console.warn(`[PluginLoader] Error scanning ${dir}: ${err.message}`);
        }

        return results;
    }

    /**
     * Load and validate a plugin.json manifest.
     * @param {string} pluginDir
     * @returns {Promise<PluginManifest|null>}
     * @private
     */
    async _loadManifest(pluginDir) {
        const manifestPath = path.join(pluginDir, 'plugin.json');
        try {
            const raw = await fs.readFile(manifestPath, 'utf8');
            const manifest = JSON.parse(raw);

            // Validate required fields
            if (!manifest.name) {
                console.warn(`[PluginLoader] Missing 'name' in ${manifestPath}`);
                return null;
            }

            // Security: block path-traversal characters in plugin names.
            // Plugin names are used as directory components for storage, settings,
            // and other path constructions. Allowing `..`, `/`, or `\` would let a
            // malicious plugin.json escape the intended `.plugins-data/` directory.
            if (/[/\\]/.test(manifest.name) || manifest.name.includes('..')) {
                console.warn(`[PluginLoader] Invalid plugin name in ${manifestPath}: "${manifest.name}" — contains path-traversal characters`);
                return null;
            }

            if (!manifest.main) {
                // Default to index.mjs
                manifest.main = 'index.mjs';
            }

            // Verify entry point exists
            const entryPath = path.join(pluginDir, manifest.main);
            try {
                await fs.access(entryPath);
            } catch {
                console.warn(`[PluginLoader] Entry point not found: ${entryPath}`);
                return null;
            }

            return manifest;
        } catch {
            // No manifest or invalid JSON — skip
            return null;
        }
    }

    /**
     * Scan workspace package.json for dependencies with "oboto-plugin" keyword.
     * @returns {Promise<DiscoveredPlugin[]>}
     * @private
     */
    async _scanNpmPlugins() {
        const results = [];
        const packageJsonPath = path.join(this.workingDir, 'package.json');

        try {
            await fs.access(packageJsonPath);
        } catch {
            return results;
        }

        try {
            const raw = await fs.readFile(packageJsonPath, 'utf8');
            const pkg = JSON.parse(raw);
            const allDeps = {
                ...(pkg.dependencies || {}),
                ...(pkg.devDependencies || {})
            };

            for (const depName of Object.keys(allDeps)) {
                const depDir = path.join(this.workingDir, 'node_modules', depName);
                const depPkgPath = path.join(depDir, 'package.json');

                try {
                    const depRaw = await fs.readFile(depPkgPath, 'utf8');
                    const depPkg = JSON.parse(depRaw);

                    // Check for "oboto-plugin" keyword
                    if (depPkg.keywords && depPkg.keywords.includes('oboto-plugin')) {
                        // Try loading plugin.json, or synthesize manifest from package.json
                        let manifest = await this._loadManifest(depDir);
                        if (!manifest) {
                            // Synthesize from package.json
                            const main = depPkg.main || 'index.mjs';
                            try {
                                await fs.access(path.join(depDir, main));
                                manifest = {
                                    name: depPkg.name,
                                    version: depPkg.version || '0.0.0',
                                    description: depPkg.description || '',
                                    main,
                                    capabilities: depPkg.obotoPlugin?.capabilities || {},
                                    ui: depPkg.obotoPlugin?.ui || {},
                                    permissions: depPkg.obotoPlugin?.permissions || []
                                };
                            } catch {
                                continue; // No valid entry point
                            }
                        }

                        if (manifest) {
                            results.push({
                                name: manifest.name,
                                dir: depDir,
                                manifest,
                                source: 'npm'
                            });
                        }
                    }
                } catch {
                    // Not a valid package or missing package.json — skip
                }
            }
        } catch (err) {
            console.warn(`[PluginLoader] Error scanning npm plugins: ${err.message}`);
        }

        return results;
    }

    /**
     * Load the entry module of a discovered plugin.
     * @param {DiscoveredPlugin} plugin
     * @returns {Promise<object>} — the plugin module's default export
     */
    async loadModule(plugin) {
        const entryPath = path.resolve(path.join(plugin.dir, plugin.manifest.main));
        const resolvedDir = path.resolve(plugin.dir);
        // Security: ensure the entry point does not escape the plugin directory
        if (entryPath !== resolvedDir && !entryPath.startsWith(resolvedDir + path.sep)) {
            throw new Error(
                `Plugin "${plugin.name}" entry point escapes plugin directory: ${plugin.manifest.main}`
            );
        }

        // Track reload count to warn about ES module cache accumulation.
        const prevCount = this._reloadCounts.get(plugin.name) || 0;
        const newCount = prevCount + 1;
        this._reloadCounts.set(plugin.name, newCount);

        // Hard cap: prevent unbounded ES module cache growth
        if (newCount > 10) {
            throw new Error(
                `Plugin "${plugin.name}" has been reloaded ${newCount} times. ` +
                `ES module cache cannot be evicted — restart the server to reclaim memory and continue reloading.`
            );
        }

        console.warn(`[PluginLoader] Loading plugin code: ${plugin.name} (${plugin.source}) from ${entryPath}`);
        // Append cache-busting query to force re-evaluation on reload.
        // Node.js treats each unique URL (including query) as a separate module entry.
        // NOTE: Node.js ES module cache cannot be evicted. Each reload creates a new
        // cache entry while the old one persists. Frequent reloads will consume
        // additional memory. This is a known limitation of ES module hot-reloading.
        const fileUrl = pathToFileURL(entryPath).href + `?t=${Date.now()}`;
        const mod = await import(fileUrl);

        if (newCount > 3) {
            console.warn(
                `[PluginLoader] ⚠ Plugin "${plugin.name}" has been reloaded ${newCount} times. ` +
                `Each reload leaks an ES module cache entry. Consider restarting the server to reclaim memory.`
            );
        }

        return mod.default || mod;
    }

    /**
     * Get the reload count for a plugin.
     * @param {string} pluginName
     * @returns {number}
     */
    getReloadCount(pluginName) {
        return this._reloadCounts.get(pluginName) || 0;
    }

    /**
     * Read the source of a UI component file from a plugin directory.
     * @param {string} pluginDir — absolute path to plugin directory
     * @param {string} componentFile — relative path to the component file
     * @returns {Promise<string|null>}
     */
    async loadUIComponentSource(pluginDir, componentFile) {
        try {
            const fullPath = path.join(pluginDir, componentFile);
            // Security: ensure the resolved path is inside the plugin directory
            const resolved = path.resolve(fullPath);
            const resolvedDir = path.resolve(pluginDir);
            if (resolved !== resolvedDir && !resolved.startsWith(resolvedDir + path.sep)) {
                console.warn(`[PluginLoader] Path traversal blocked: ${componentFile}`);
                return null;
            }
            // Prevent reading directories
            const stat = await fs.stat(resolved);
            if (!stat.isFile()) {
                console.warn(`[PluginLoader] Not a file: ${componentFile}`);
                return null;
            }
            return await fs.readFile(resolved, 'utf8');
        } catch {
            return null;
        }
    }
}
