/**
 * PluginInstaller — handles installing, uninstalling, and updating plugins
 * via pnpm workspace commands.
 *
 * Install targets:
 * - Built-in:  ./plugins/          (relative to project root)
 * - Global:    ~/.oboto/plugins/   (default for install)
 * - Workspace: .plugins/           (relative to workingDir)
 *
 * @module src/plugins/plugin-installer
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** @enum {string} */
const InstallTarget = {
    BUILTIN: 'builtin',
    GLOBAL: 'global',
    WORKSPACE: 'workspace',
};

/**
 * Resolve a target directory from an InstallTarget value.
 * @param {string} target
 * @param {string} workingDir
 * @returns {string}
 */
function resolveTargetDir(target, workingDir) {
    switch (target) {
        case InstallTarget.BUILTIN:
            return path.join(PROJECT_ROOT, 'plugins');
        case InstallTarget.GLOBAL:
            return path.join(os.homedir(), '.oboto', 'plugins');
        case InstallTarget.WORKSPACE:
            return path.join(workingDir, '.plugins');
        default:
            return path.join(os.homedir(), '.oboto', 'plugins');
    }
}

export class PluginInstaller {
    /**
     * @param {object} options
     * @param {string} options.workingDir — workspace root
     * @param {import('./plugin-manager.mjs').PluginManager} [options.pluginManager]
     * @param {import('../lib/event-bus.mjs').EventBus} [options.eventBus]
     */
    constructor({ workingDir, pluginManager = null, eventBus = null } = {}) {
        this.workingDir = workingDir || process.cwd();
        this.pluginManager = pluginManager;
        this.eventBus = eventBus;
    }

    // ── Name validation ──────────────────────────────────────────────────

    /**
     * Validate a plugin name does not contain path-traversal characters.
     * @param {string} name
     * @throws {Error} if the name is invalid
     * @private
     */
    _validateName(name) {
        if (!name || typeof name !== 'string') {
            throw new Error('Plugin name must be a non-empty string');
        }
        if (/[/\\]/.test(name) || name.includes('..')) {
            throw new Error(`Invalid plugin name: "${name}" — contains path-traversal characters`);
        }
    }

    // ── Install ──────────────────────────────────────────────────────────

    /**
     * Install a plugin from an npm spec, local path, or git URL.
     *
     * @param {string} spec — e.g. `@oboto/plugin-firecrawl`, `./path/to/plugin`, `github:user/repo`
     * @param {object} [options]
     * @param {string} [options.target='global'] — 'builtin' | 'global' | 'workspace'
     * @returns {Promise<string>} — the installed plugin name
     */
    async install(spec, options = {}) {
        const target = options.target || InstallTarget.GLOBAL;
        const targetDir = resolveTargetDir(target, this.workingDir);

        // Input validation
        if (!spec || typeof spec !== 'string') {
            throw new Error('Plugin spec must be a non-empty string');
        }
        if (spec.length > 500) {
            throw new Error('Plugin spec is too long');
        }
        // Block shell metacharacters (execFile doesn't use a shell, but defense-in-depth)
        if (/[;&|`$\\]/.test(spec)) {
            throw new Error('Plugin spec contains invalid characters');
        }

        this._emit('plugin:install-progress', { spec, phase: 'start', target });

        // Ensure the target directory exists
        await fs.mkdir(targetDir, { recursive: true });

        try {
            // Run pnpm add in the target directory
            this._emit('plugin:install-progress', { spec, phase: 'pnpm-add' });

            await this._exec('pnpm', ['add', spec], { cwd: targetDir });

            // Determine the installed package name from spec
            const pluginName = await this._resolvePluginName(spec, targetDir);

            // Validate the installed package
            await this._validatePlugin(pluginName, targetDir);

            this._emit('plugin:install-complete', { name: pluginName, spec, target });
            return pluginName;
        } catch (err) {
            this._emit('plugin:install-progress', {
                spec,
                phase: 'error',
                error: err.message,
            });
            throw new Error(`Failed to install plugin "${spec}": ${err.message}`);
        }
    }

    // ── Uninstall ────────────────────────────────────────────────────────

    /**
     * Uninstall a plugin by name.
     *
     * @param {string} name — plugin directory name or package name
     * @param {object} [options]
     * @param {boolean} [options.cleanData=false] — remove `.plugins-data/<name>/`
     * @param {string} [options.target='global'] — 'builtin' | 'global' | 'workspace'
     * @returns {Promise<boolean>}
     */
    async uninstall(name, options = {}) {
        this._validateName(name);

        const target = options.target || InstallTarget.GLOBAL;

        // Built-in plugins (shipped with the app in ./plugins/) cannot be deleted.
        // They may be disabled via the plugin manager, but never removed from disk.
        if (target === InstallTarget.BUILTIN) {
            throw new Error(
                `Cannot uninstall built-in plugin "${name}". ` +
                `Built-in plugins are part of the base installation and can only be disabled, not deleted.`
            );
        }
        // Defense-in-depth: also check if the plugin physically resides in the
        // builtin directory, regardless of the `target` parameter.
        const builtinDir = resolveTargetDir(InstallTarget.BUILTIN, this.workingDir);
        const builtinPath = path.join(builtinDir, name);
        if (await this._exists(builtinPath)) {
            throw new Error(
                `Cannot uninstall "${name}" — it is a built-in plugin. ` +
                `Built-in plugins can only be disabled, not deleted.`
            );
        }

        const targetDir = resolveTargetDir(target, this.workingDir);

        // Deactivate via PluginManager if available
        if (this.pluginManager) {
            try {
                await this.pluginManager.deactivatePlugin(name);
            } catch {
                // Plugin may not be active — continue
            }
        }

        const pluginDir = path.join(targetDir, name);
        const dirExists = await this._exists(pluginDir);

        if (dirExists) {
            // If the directory has a package.json, use pnpm remove
            const hasPkg = await this._exists(path.join(pluginDir, 'package.json'));
            if (hasPkg) {
                try {
                    await this._exec('pnpm', ['remove', name], { cwd: targetDir });
                } catch {
                    // Fall back to manual removal
                    await fs.rm(pluginDir, { recursive: true, force: true });
                }
            } else {
                await fs.rm(pluginDir, { recursive: true, force: true });
            }
        } else {
            // Try pnpm remove by package name
            try {
                await this._exec('pnpm', ['remove', name], { cwd: targetDir });
            } catch {
                // Already removed or never installed
            }
        }

        // Clean up plugin data if requested
        if (options.cleanData) {
            const dataDir = path.join(this.workingDir, '.plugins-data', name);
            if (await this._exists(dataDir)) {
                await fs.rm(dataDir, { recursive: true, force: true });
            }
        }

        return true;
    }

    // ── Update ───────────────────────────────────────────────────────────

    /**
     * Update a plugin: deactivate → pnpm update → reactivate.
     *
     * @param {string} name
     * @param {object} [options]
     * @param {string} [options.target='global'] — 'builtin' | 'global' | 'workspace'
     * @returns {Promise<boolean>}
     */
    async update(name, options = {}) {
        this._validateName(name);

        const target = options.target || InstallTarget.GLOBAL;
        const targetDir = resolveTargetDir(target, this.workingDir);

        // Deactivate
        if (this.pluginManager) {
            try {
                await this.pluginManager.deactivatePlugin(name);
            } catch {
                // Plugin may not be active
            }
        }

        // Update via pnpm
        try {
            await this._exec('pnpm', ['update', name], { cwd: targetDir });
        } catch (err) {
            throw new Error(`Failed to update plugin "${name}": ${err.message}`);
        }

        // Reactivate
        if (this.pluginManager) {
            try {
                await this.pluginManager.enablePlugin(name);
            } catch {
                // Will be picked up on next initialize
            }
        }

        return true;
    }

    // ── List Installed ───────────────────────────────────────────────────

    /**
     * Return all installed plugin directories across all targets,
     * with their source information.
     *
     * @returns {Promise<Array<{name: string, dir: string, source: string}>>}
     */
    async listInstalled() {
        const results = [];

        const targets = [
            { key: InstallTarget.BUILTIN, label: 'builtin' },
            { key: InstallTarget.GLOBAL, label: 'global' },
            { key: InstallTarget.WORKSPACE, label: 'workspace' },
        ];

        for (const { key, label } of targets) {
            const dir = resolveTargetDir(key, this.workingDir);
            if (!(await this._exists(dir))) continue;

            try {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    // Skip hidden directories and node_modules
                    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

                    const pluginDir = path.join(dir, entry.name);
                    const hasManifest = (
                        await this._exists(path.join(pluginDir, 'plugin.json')) ||
                        await this._exists(path.join(pluginDir, 'package.json'))
                    );

                    if (hasManifest) {
                        results.push({
                            name: entry.name,
                            dir: pluginDir,
                            source: label,
                        });
                    }
                }
            } catch {
                // Directory not readable — skip
            }
        }

        return results;
    }

    // ── Private helpers ──────────────────────────────────────────────────

    /**
     * Execute a command and return stdout.
     * @param {string} cmd
     * @param {string[]} args
     * @param {object} [options]
     * @returns {Promise<string>}
     * @private
     */
    async _exec(cmd, args, options = {}) {
        const { stdout, stderr } = await execFileAsync(cmd, args, {
            cwd: options.cwd || this.workingDir,
            env: { ...process.env },
            timeout: 120_000,
        });
        if (stderr && stderr.includes('ERR!')) {
            throw new Error(stderr.trim());
        }
        return stdout;
    }

    /**
     * Resolve the plugin name from a spec after installation.
     * @param {string} spec
     * @param {string} targetDir
     * @returns {Promise<string>}
     * @private
     */
    async _resolvePluginName(spec, targetDir) {
        // If spec is a local path, extract the directory name
        if (spec.startsWith('.') || spec.startsWith('/')) {
            const resolvedPath = path.resolve(this.workingDir, spec);
            try {
                const pkgJson = JSON.parse(
                    await fs.readFile(path.join(resolvedPath, 'package.json'), 'utf8')
                );
                return pkgJson.name || path.basename(resolvedPath);
            } catch {
                return path.basename(resolvedPath);
            }
        }

        // npm-style spec: strip version suffix
        // e.g. @oboto/plugin-firecrawl@^1.0 → @oboto/plugin-firecrawl
        const cleaned = spec.replace(/@[^/]+$/, '');
        // Remove github: prefix
        const withoutPrefix = cleaned.replace(/^github:/, '');
        // For scoped packages, return as-is; otherwise take last segment
        if (withoutPrefix.startsWith('@')) {
            return withoutPrefix;
        }
        return withoutPrefix.split('/').pop() || spec;
    }

    /**
     * Validate that an installed package qualifies as an oboto plugin.
     * Must have either a plugin.json or `"oboto-plugin"` keyword in package.json.
     *
     * @param {string} name
     * @param {string} targetDir
     * @throws {Error} if validation fails
     * @private
     */
    async _validatePlugin(name, targetDir) {
        // Check for plugin.json in the plugin directory
        const pluginDir = path.join(targetDir, 'node_modules', name);
        const directDir = path.join(targetDir, name);

        const dirsToCheck = [pluginDir, directDir];

        for (const dir of dirsToCheck) {
            if (!(await this._exists(dir))) continue;

            // Check for plugin.json
            if (await this._exists(path.join(dir, 'plugin.json'))) {
                return; // Valid
            }

            // Check for "oboto-plugin" keyword in package.json
            try {
                const pkgRaw = await fs.readFile(path.join(dir, 'package.json'), 'utf8');
                const pkg = JSON.parse(pkgRaw);
                if (pkg.keywords && Array.isArray(pkg.keywords) && pkg.keywords.includes('oboto-plugin')) {
                    return; // Valid
                }
            } catch {
                // No package.json or parse error — continue checking
            }
        }

        throw new Error(
            `Package "${name}" is not a valid oboto plugin. It must have a plugin.json or include "oboto-plugin" in package.json keywords.`
        );
    }

    /**
     * Check if a path exists.
     * @param {string} p
     * @returns {Promise<boolean>}
     * @private
     */
    async _exists(p) {
        try {
            await fs.access(p);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Emit an event via the eventBus if available.
     * @param {string} event
     * @param {object} data
     * @private
     */
    _emit(event, data) {
        if (this.eventBus && typeof this.eventBus.emit === 'function') {
            this.eventBus.emit(event, data);
        }
    }
}
