/**
 * PluginStorage — sandboxed key-value storage for plugins.
 * 
 * Each plugin gets its own namespace backed by a JSON file
 * in `~/.oboto/plugins-data/<pluginName>/storage.json` (global).
 * 
 * @module src/plugins/plugin-storage
 */

import fs from 'fs/promises';
import path from 'path';
import { consoleStyler } from '../ui/console-styler.mjs';
import { globalPluginDataDir } from '../lib/paths.mjs';

export class PluginStorage {
    /**
     * @param {string} pluginName — used as the storage namespace
     * @param {string} _baseDir — @deprecated Ignored since storage moved to global
     *   `~/.oboto/plugins-data/`. Kept for API compatibility; will be removed in a
     *   future major version. Callers should stop passing this argument.
     */
    constructor(pluginName, _baseDir) {
        if (_baseDir !== undefined) {
            consoleStyler.log('warning', `[PluginStorage] _baseDir parameter is deprecated and ignored (plugin: ${pluginName}). Storage is global at ~/.oboto/plugins-data/.`);
        }
        this.pluginName = pluginName;
        this.dir = globalPluginDataDir(pluginName);
        this.filePath = path.join(this.dir, 'storage.json');
        /** @type {Map<string, unknown>} */
        this._cache = null;
        this._dirty = false;
        this._writeTimer = null;
    }

    /**
     * Ensure the storage directory exists and load data into cache.
     */
    async _ensureLoaded() {
        if (this._cache !== null) return;
        this._cache = new Map();
        try {
            await fs.mkdir(this.dir, { recursive: true });
            const raw = await fs.readFile(this.filePath, 'utf8');
            const obj = JSON.parse(raw);
            for (const [k, v] of Object.entries(obj)) {
                this._cache.set(k, v);
            }
        } catch {
            // File doesn't exist or is corrupt — start fresh
        }
    }

    /**
     * Schedule a debounced write to disk.
     * @private
     */
    _scheduleWrite() {
        this._dirty = true;
        if (this._writeTimer) return;
        this._writeTimer = setTimeout(() => {
            this._writeTimer = null;
            this._flush().catch(err => {
                consoleStyler.log('error', `Plugin storage flush error (${this.pluginName}): ${err.message}`);
            });
        }, 500);
    }

    /**
     * Write cache to disk.
     * @private
     */
    async _flush() {
        if (!this._dirty || !this._cache) return;
        this._dirty = false;
        const obj = Object.fromEntries(this._cache);
        await fs.mkdir(this.dir, { recursive: true });
        await fs.writeFile(this.filePath, JSON.stringify(obj, null, 2), 'utf8');
    }

    /**
     * Get a value by key.
     * @param {string} key
     * @returns {Promise<unknown>}
     */
    async get(key) {
        await this._ensureLoaded();
        return this._cache.get(key);
    }

    /**
     * Set a value by key.
     * @param {string} key
     * @param {unknown} value — must be JSON-serializable
     * @returns {Promise<void>}
     */
    async set(key, value) {
        await this._ensureLoaded();
        this._cache.set(key, value);
        this._scheduleWrite();
    }

    /**
     * Delete a key.
     * @param {string} key
     * @returns {Promise<boolean>} true if the key existed
     */
    async delete(key) {
        await this._ensureLoaded();
        const existed = this._cache.delete(key);
        if (existed) this._scheduleWrite();
        return existed;
    }

    /**
     * Check if a key exists.
     * @param {string} key
     * @returns {Promise<boolean>}
     */
    async has(key) {
        await this._ensureLoaded();
        return this._cache.has(key);
    }

    /**
     * List all keys.
     * @returns {Promise<string[]>}
     */
    async keys() {
        await this._ensureLoaded();
        return Array.from(this._cache.keys());
    }

    /**
     * Get all entries.
     * @returns {Promise<Array<[string, unknown]>>}
     */
    async entries() {
        await this._ensureLoaded();
        return Array.from(this._cache.entries());
    }

    /**
     * Clear all data.
     * @returns {Promise<void>}
     */
    async clear() {
        await this._ensureLoaded();
        this._cache.clear();
        this._scheduleWrite();
    }

    /**
     * Force flush any pending writes (call on shutdown).
     * @returns {Promise<void>}
     */
    async flush() {
        if (this._writeTimer) {
            clearTimeout(this._writeTimer);
            this._writeTimer = null;
        }
        await this._flush();
    }
}
