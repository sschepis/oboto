/**
 * Shared plugin settings handler utility.
 *
 * Eliminates ~35 lines of near-identical boilerplate per plugin by providing
 * a single function that registers the three standard settings WS handlers:
 *   - `get-settings`  — returns merged default + stored settings
 *   - `get-schema`    — returns the settings schema and defaults
 *   - `update-settings` — validates, persists, and applies new settings
 *
 * All `ctx.ws.send()` calls are null-guarded to prevent crashes when the
 * WebSocket connection is unavailable.
 *
 * Settings values are validated against schema `min`/`max`/`type` constraints
 * before being persisted.
 *
 * @module src/plugins/plugin-settings-handlers
 */

/**
 * Validate settings values against a schema.
 * Returns a new object containing only valid, schema-defined keys with
 * values coerced/clamped to match schema constraints.
 *
 * Validation rules per type:
 *   - `number`:   value must be numeric; clamped to [min, max] if specified
 *   - `boolean`:  value must be a boolean
 *   - `select`:   value must be one of the schema's `options` entries
 *   - `text`:     value must be a string
 *   - `password`: value must be a string
 *
 * Keys not present in the schema are silently dropped.
 *
 * @param {object} newSettings — raw settings object from the client
 * @param {Array<{key: string, type: string, min?: number, max?: number, options?: Array}>} schema
 * @returns {object} validated settings (only schema-defined keys)
 */
export function validateSettings(newSettings, schema) {
    if (!newSettings || typeof newSettings !== 'object') return {};
    if (!Array.isArray(schema) || schema.length === 0) return {};

    /** @type {Map<string, object>} */
    const schemaMap = new Map();
    for (const entry of schema) {
        if (entry && typeof entry.key === 'string') {
            schemaMap.set(entry.key, entry);
        }
    }

    /** @type {Record<string, unknown>} */
    const validated = {};

    for (const [key, value] of Object.entries(newSettings)) {
        const entry = schemaMap.get(key);
        if (!entry) continue; // skip unknown keys

        switch (entry.type) {
            case 'number': {
                let num = typeof value === 'string' ? Number(value) : value;
                if (typeof num !== 'number' || Number.isNaN(num)) continue;
                if (typeof entry.min === 'number' && num < entry.min) num = entry.min;
                if (typeof entry.max === 'number' && num > entry.max) num = entry.max;
                validated[key] = num;
                break;
            }

            case 'boolean': {
                if (typeof value === 'boolean') {
                    validated[key] = value;
                } else if (value === 'true' || value === 'false') {
                    // Accept string booleans from form inputs
                    validated[key] = value === 'true';
                }
                // else: skip invalid value
                break;
            }

            case 'select': {
                if (Array.isArray(entry.options)) {
                    // Normalise options — supports both plain strings and {value, label} objects
                    const allowed = entry.options.map(o =>
                        (typeof o === 'object' && o !== null) ? o.value : o
                    );
                    if (allowed.includes(value)) {
                        validated[key] = value;
                    }
                }
                // else: skip values not in the allowed options list
                break;
            }

            case 'text':
            case 'password': {
                if (typeof value === 'string') {
                    const maxLen = typeof entry.maxLength === 'number' ? entry.maxLength : 10000;
                    validated[key] = value.length > maxLen ? value.slice(0, maxLen) : value;
                }
                break;
            }

            default: {
                // Unknown schema type — pass through with basic safety for forward-compatibility.
                // Strings are truncated to prevent storage abuse; non-primitives are rejected.
                if (typeof value === 'string') {
                    validated[key] = value.length > 10000 ? value.slice(0, 10000) : value;
                } else if (typeof value === 'number' || typeof value === 'boolean') {
                    validated[key] = value;
                } else {
                    console.warn(`[plugin-settings] Dropping non-primitive value for unknown schema type '${entry.type}', key '${key}'`);
                }
                break;
            }
        }
    }

    return validated;
}

/**
 * Register standard settings WS handlers for a plugin.
 *
 * Registers three WS handlers:
 *   - `get-settings`    — returns merged default + stored settings
 *   - `get-schema`      — returns the settings schema and defaults
 *   - `update-settings` — validates, persists, and applies new settings
 *
 * @param {object} api — Plugin API instance (from `activate(api)`)
 * @param {string} pluginName — Plugin name (used in WS event type names)
 * @param {object} defaultSettings — Default settings object
 * @param {Array<{key: string, label: string, type: string, description?: string, default: *, options?: Array, min?: number, max?: number}>} settingsSchema
 *   Array of schema entries describing each setting.
 * @param {Function} [onSettingsChange] — Optional callback: `(newSettings, mergedSettings) => void`.
 *   Called after settings are validated and persisted. Use this to apply
 *   settings to running plugin instances (e.g. update timeouts, limits).
 * @returns {Promise<{getSettings: () => object, pluginSettings: object}>}
 *   - `getSettings()`: returns a fresh copy of current merged settings
 *   - `pluginSettings`: mutable reference to the current settings object
 *     (for direct use in handler closures)
 */
export async function registerSettingsHandlers(api, pluginName, defaultSettings, settingsSchema, onSettingsChange) {
    // Expose the schema on the API object so that external callers (e.g.
    // plugin-handler.mjs fallback path) can use it for validation.
    api._settingsSchema = settingsSchema;

    // ── Load stored settings and merge with defaults ─────────────────────
    /** @type {Record<string, unknown>} */
    const pluginSettings = { ...defaultSettings };

    try {
        const stored = await api.settings.getAll();
        if (stored && typeof stored === 'object') {
            Object.assign(pluginSettings, stored);
        }
    } catch (_e) {
        // Use defaults on failure
    }

    // ── get-settings ─────────────────────────────────────────────────────
    api.ws.register('get-settings', async (_data, ctx) => {
        let merged;
        try {
            const stored = await api.settings.getAll();
            merged = { ...defaultSettings, ...stored };
        } catch (_e) {
            merged = { ...defaultSettings, ...pluginSettings };
        }

        if (ctx?.ws) {
            ctx.ws.send(JSON.stringify({
                type: `plugin:${pluginName}:settings`,
                payload: { settings: merged }
            }));
        }
    });

    // ── get-schema ───────────────────────────────────────────────────────
    api.ws.register('get-schema', async (_data, ctx) => {
        if (ctx?.ws) {
            ctx.ws.send(JSON.stringify({
                type: `plugin:${pluginName}:settings-schema`,
                payload: { schema: settingsSchema, defaults: defaultSettings }
            }));
        }
    });

    // ── update-settings ──────────────────────────────────────────────────
    api.ws.register('update-settings', async (data, ctx) => {
        const rawSettings = data?.settings || data?.payload?.settings || {};
        const validatedSettings = validateSettings(rawSettings, settingsSchema);

        // Merge validated updates with existing stored settings so that
        // partial updates don't lose previously persisted values.
        let existing = {};
        try { existing = await api.settings.getAll() || {}; } catch (_e) { /* use empty */ }
        const merged = { ...defaultSettings, ...existing, ...validatedSettings };
        await api.settings.setAll(merged);
        Object.assign(pluginSettings, merged);

        if (typeof onSettingsChange === 'function') {
            try {
                onSettingsChange(validatedSettings, merged);
            } catch (err) {
                console.error(`[${pluginName}] onSettingsChange callback error:`, err);
            }
        }

        if (ctx?.ws) {
            ctx.ws.send(JSON.stringify({
                type: `plugin:${pluginName}:settings`,
                payload: { settings: merged }
            }));
        }
    });

    // ── Return value ─────────────────────────────────────────────────────
    return {
        /**
         * Get a fresh copy of the current merged settings.
         * @returns {object}
         */
        getSettings() {
            return { ...defaultSettings, ...pluginSettings };
        },

        /**
         * Mutable reference to the current settings object.
         * Plugins can read from this directly in their handler closures
         * and it will always reflect the latest persisted values.
         * @type {object}
         */
        pluginSettings
    };
}
