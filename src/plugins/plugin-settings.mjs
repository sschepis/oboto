/**
 * PluginSettingsStore — persistent settings for plugins.
 * 
 * Settings are stored per-plugin in `.plugins-data/<pluginName>/settings.json`.
 * Unlike PluginStorage (general KV), settings are typically defined by a schema
 * and displayed in the Settings UI.
 * 
 * @module src/plugins/plugin-settings
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Sensitive key pattern — matches keys that should not be stored in plaintext.
 * @const {RegExp}
 */
const SENSITIVE_KEY_PATTERN = /apikey|api_key|secret|token|password|credential/i;

/**
 * Convert a camelCase or mixed-case key to SCREAMING_SNAKE_CASE for env-var lookup.
 * Examples: 'serperApiKey' → 'SERPER_API_KEY', 'openaiApiKey' → 'OPENAI_API_KEY'
 * @param {string} key
 * @returns {string}
 */
function toEnvVarName(key) {
    return key
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .toUpperCase();
}

export class PluginSettingsStore {
    /**
     * @param {string} pluginName
     * @param {string} baseDir — workspace root directory
     */
    constructor(pluginName, baseDir) {
        this.pluginName = pluginName;
        this.dir = path.join(baseDir, '.plugins-data', pluginName);
        this.filePath = path.join(this.dir, 'settings.json');
        /** @type {Record<string, unknown> | null} */
        this._data = null;
    }

    /**
     * Load settings from disk.
     * @private
     */
    async _load() {
        if (this._data !== null) return;
        try {
            await fs.mkdir(this.dir, { recursive: true });
            const raw = await fs.readFile(this.filePath, 'utf8');
            this._data = JSON.parse(raw);
        } catch {
            this._data = {};
        }
    }

    /**
     * Save settings to disk.
     * @private
     */
    async _save() {
        await fs.mkdir(this.dir, { recursive: true });
        await fs.writeFile(this.filePath, JSON.stringify(this._data, null, 2), 'utf8');
    }

    /**
     * Get a setting value.
     * @param {string} key
     * @param {unknown} [defaultValue]
     * @returns {Promise<unknown>}
     */
    async get(key, defaultValue = undefined) {
        await this._load();
        const stored = this._data[key];
        if (stored !== undefined && stored !== null && stored !== '') {
            return stored;
        }
        // For sensitive keys, fall through to process.env
        if (SENSITIVE_KEY_PATTERN.test(key)) {
            const envName = toEnvVarName(key);
            const envVal = process.env[envName];
            if (envVal !== undefined) return envVal;
        }
        return key in this._data ? this._data[key] : defaultValue;
    }

    /**
     * Set a setting value.
     * @param {string} key
     * @param {unknown} value
     * @returns {Promise<void>}
     */
    async set(key, value) {
        await this._load();
        // Block sensitive data from being stored in plaintext JSON files.
        // Plugin authors should use environment variables or the secrets manager.
        if (SENSITIVE_KEY_PATTERN.test(key) && value) {
            throw new Error(
                `[PluginSettings:${this.pluginName}] Cannot store "${key}" in plaintext settings. ` +
                `Use environment variables (e.g. SERPER_API_KEY, ELEVENLABS_API_KEY) or the secrets manager for sensitive credentials. ` +
                `Plugin settings.get() calls for API keys will fall through to process.env when the settings value is empty.`
            );
        }
        this._data[key] = value;
        await this._save();
    }

    /**
     * Get all settings as a plain object.
     * @returns {Promise<Record<string, unknown>>}
     */
    async getAll() {
        await this._load();
        return { ...this._data };
    }

    /**
     * Set multiple settings at once (merge).
     * @param {Record<string, unknown>} values
     * @returns {Promise<void>}
     */
    async setAll(values) {
        await this._load();
        for (const key of Object.keys(values)) {
            if (SENSITIVE_KEY_PATTERN.test(key) && values[key]) {
                throw new Error(
                    `[PluginSettings:${this.pluginName}] Cannot store "${key}" in plaintext settings. ` +
                    `Use environment variables (e.g. SERPER_API_KEY, ELEVENLABS_API_KEY) or the secrets manager for sensitive credentials. ` +
                    `Plugin settings.get() calls for API keys will fall through to process.env when the settings value is empty.`
                );
            }
        }
        Object.assign(this._data, values);
        await this._save();
    }

    /**
     * Delete a setting.
     * @param {string} key
     * @returns {Promise<boolean>}
     */
    async delete(key) {
        await this._load();
        if (key in this._data) {
            delete this._data[key];
            await this._save();
            return true;
        }
        return false;
    }

    /**
     * Reset all settings.
     * @returns {Promise<void>}
     */
    async reset() {
        this._data = {};
        await this._save();
    }
}
