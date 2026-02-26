/**
 * Oboto UI Themes Plugin
 *
 * Provides dynamic UI theming: preset themes, CSS token overrides, custom CSS
 * injection, display name management, and real-time WS style updates.
 *
 * Extracted from:
 *   - src/execution/handlers/ui-style-handlers.mjs
 *   - src/tools/definitions/ui-style-tools.mjs
 *   - src/server/ws-handlers/style-handler.mjs
 *
 * Uses the `api.setInstance()/getInstance()` pattern to avoid module-level mutable state.
 * This ensures proper cleanup across ESM reloads (where the old module entry
 * may be cached but the new import creates a fresh scope).
 *
 * @module @oboto/plugin-ui-themes
 */

import fs from 'fs';
import path from 'path';
import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';

// ── Plugin settings ──────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
    defaultTheme: 'midnight',
    persistThemeChanges: true,
    enableCustomCSS: true,
    enableDisplayNames: true,
    maxInjectedCSSKB: 64,
};

const SETTINGS_SCHEMA = [
    { key: 'defaultTheme', label: 'Default Theme', type: 'select', description: 'Theme to apply when the plugin loads', default: 'midnight', options: ['cyberpunk', 'ocean', 'sunset', 'matrix', 'midnight', 'arctic', 'forest', 'lavender', 'ember', 'monochrome', 'daylight', 'paper', 'corporate', 'solarized', 'mermaid', 'quiet'] },
    { key: 'persistThemeChanges', label: 'Persist Theme Changes', type: 'boolean', description: 'Save theme changes to disk so they survive restarts', default: true },
    { key: 'enableCustomCSS', label: 'Enable Custom CSS', type: 'boolean', description: 'Allow injection of custom CSS into the UI', default: true },
    { key: 'enableDisplayNames', label: 'Enable Display Names', type: 'boolean', description: 'Allow setting custom display names for user and agent', default: true },
    { key: 'maxInjectedCSSKB', label: 'Max Injected CSS (KB)', type: 'number', description: 'Maximum size in KB allowed for injected CSS', default: 64 },
];

// ── Theme presets ────────────────────────────────────────────────────────

const THEME_PRESETS = {
    cyberpunk: {
        'color-primary': '#7928ca', 'color-primary-rgb': '121,40,202',
        'color-accent': '#ff0080', 'color-accent-rgb': '255,0,128',
        'color-success': '#00ff88', 'color-warning': '#ffaa00',
        'color-error': '#ff4757', 'color-info': '#5352ed',
        'color-surface': '#0a0a0f', 'color-surface-raised': '#12121a',
        'color-surface-overlay': '#1a1a25',
        'color-border': 'rgba(121,40,202,0.2)', 'color-border-rgb': '121,40,202',
        'color-text': '#e4e4e7', 'color-text-muted': '#a1a1aa',
        'color-selection': 'rgba(121,40,202,0.3)', 'color-scrollbar': 'rgba(121,40,202,0.4)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'JetBrains Mono', 'Fira Code', monospace",
        'radius-sm': '4px', 'radius-md': '8px', 'radius-lg': '12px',
    },
    ocean: {
        'color-primary': '#667eea', 'color-primary-rgb': '102,126,234',
        'color-accent': '#30e8bf', 'color-accent-rgb': '48,232,191',
        'color-success': '#4ecdc4', 'color-warning': '#f9ca24',
        'color-error': '#eb4d4b', 'color-info': '#6c5ce7',
        'color-surface': '#080c14', 'color-surface-raised': '#0e1422',
        'color-surface-overlay': '#141c2e',
        'color-border': 'rgba(102,126,234,0.2)', 'color-border-rgb': '102,126,234',
        'color-text': '#d4e0f7', 'color-text-muted': '#7e8da8',
        'color-selection': 'rgba(102,126,234,0.3)', 'color-scrollbar': 'rgba(102,126,234,0.4)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'JetBrains Mono', monospace",
        'radius-sm': '4px', 'radius-md': '8px', 'radius-lg': '12px',
    },
    sunset: {
        'color-primary': '#fa709a', 'color-primary-rgb': '250,112,154',
        'color-accent': '#fee140', 'color-accent-rgb': '254,225,64',
        'color-success': '#d299c2', 'color-warning': '#f7b733',
        'color-error': '#fc4a1a', 'color-info': '#667eea',
        'color-surface': '#0f0a08', 'color-surface-raised': '#1a1210',
        'color-surface-overlay': '#261a16',
        'color-border': 'rgba(250,112,154,0.2)', 'color-border-rgb': '250,112,154',
        'color-text': '#f5e6df', 'color-text-muted': '#b09488',
        'color-selection': 'rgba(250,112,154,0.3)', 'color-scrollbar': 'rgba(250,112,154,0.4)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'Fira Code', monospace",
        'radius-sm': '6px', 'radius-md': '10px', 'radius-lg': '16px',
    },
    matrix: {
        'color-primary': '#00ff41', 'color-primary-rgb': '0,255,65',
        'color-accent': '#39ff14', 'color-accent-rgb': '57,255,20',
        'color-success': '#00ff88', 'color-warning': '#ffff00',
        'color-error': '#ff0040', 'color-info': '#00ffff',
        'color-surface': '#000000', 'color-surface-raised': '#0a0f0a',
        'color-surface-overlay': '#0f1a0f',
        'color-border': 'rgba(0,255,65,0.15)', 'color-border-rgb': '0,255,65',
        'color-text': '#b0ffb0', 'color-text-muted': '#508050',
        'color-selection': 'rgba(0,255,65,0.2)', 'color-scrollbar': 'rgba(0,255,65,0.3)',
        'font-sans': "'Courier New', monospace",
        'font-mono': "'Courier New', monospace",
        'radius-sm': '0px', 'radius-md': '0px', 'radius-lg': '0px',
    },
    midnight: {
        'color-primary': '#818cf8', 'color-primary-rgb': '129,140,248',
        'color-accent': '#a78bfa', 'color-accent-rgb': '167,139,250',
        'color-success': '#34d399', 'color-warning': '#fbbf24',
        'color-error': '#f87171', 'color-info': '#60a5fa',
        'color-surface': '#080808', 'color-surface-raised': '#111111',
        'color-surface-overlay': '#191919',
        'color-border': 'rgba(63,63,70,0.2)', 'color-border-rgb': '63,63,70',
        'color-text': '#e4e4e7', 'color-text-muted': '#a1a1aa',
        'color-selection': 'rgba(99,102,241,0.3)', 'color-scrollbar': 'rgba(63,63,70,0.4)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'JetBrains Mono', monospace",
        'radius-sm': '4px', 'radius-md': '8px', 'radius-lg': '12px',
    },
    arctic: {
        'color-primary': '#38bdf8', 'color-primary-rgb': '56,189,248',
        'color-accent': '#7dd3fc', 'color-accent-rgb': '125,211,252',
        'color-success': '#2dd4bf', 'color-warning': '#fde68a',
        'color-error': '#fb7185', 'color-info': '#93c5fd',
        'color-surface': '#0c1929', 'color-surface-raised': '#122340',
        'color-surface-overlay': '#1a2d4d',
        'color-border': 'rgba(56,189,248,0.15)', 'color-border-rgb': '56,189,248',
        'color-text': '#e0f2fe', 'color-text-muted': '#7dd3fc',
        'color-selection': 'rgba(56,189,248,0.25)', 'color-scrollbar': 'rgba(56,189,248,0.3)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'SF Mono', 'Cascadia Code', monospace",
        'radius-sm': '6px', 'radius-md': '10px', 'radius-lg': '14px',
    },
    forest: {
        'color-primary': '#22c55e', 'color-primary-rgb': '34,197,94',
        'color-accent': '#86efac', 'color-accent-rgb': '134,239,172',
        'color-success': '#4ade80', 'color-warning': '#facc15',
        'color-error': '#ef4444', 'color-info': '#a3e635',
        'color-surface': '#071108', 'color-surface-raised': '#0e1f10',
        'color-surface-overlay': '#142a16',
        'color-border': 'rgba(34,197,94,0.15)', 'color-border-rgb': '34,197,94',
        'color-text': '#dcfce7', 'color-text-muted': '#6ee7b7',
        'color-selection': 'rgba(34,197,94,0.25)', 'color-scrollbar': 'rgba(34,197,94,0.3)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'JetBrains Mono', monospace",
        'radius-sm': '4px', 'radius-md': '8px', 'radius-lg': '12px',
    },
    lavender: {
        'color-primary': '#c084fc', 'color-primary-rgb': '192,132,252',
        'color-accent': '#e879f9', 'color-accent-rgb': '232,121,249',
        'color-success': '#a78bfa', 'color-warning': '#fcd34d',
        'color-error': '#fb7185', 'color-info': '#d8b4fe',
        'color-surface': '#0f0a14', 'color-surface-raised': '#1a1224',
        'color-surface-overlay': '#231a30',
        'color-border': 'rgba(192,132,252,0.15)', 'color-border-rgb': '192,132,252',
        'color-text': '#f3e8ff', 'color-text-muted': '#c4b5fd',
        'color-selection': 'rgba(192,132,252,0.25)', 'color-scrollbar': 'rgba(192,132,252,0.3)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'Fira Code', monospace",
        'radius-sm': '6px', 'radius-md': '10px', 'radius-lg': '16px',
    },
    ember: {
        'color-primary': '#f97316', 'color-primary-rgb': '249,115,22',
        'color-accent': '#fb923c', 'color-accent-rgb': '251,146,60',
        'color-success': '#84cc16', 'color-warning': '#eab308',
        'color-error': '#dc2626', 'color-info': '#f59e0b',
        'color-surface': '#100804', 'color-surface-raised': '#1c1008',
        'color-surface-overlay': '#28180c',
        'color-border': 'rgba(249,115,22,0.15)', 'color-border-rgb': '249,115,22',
        'color-text': '#fff7ed', 'color-text-muted': '#fdba74',
        'color-selection': 'rgba(249,115,22,0.25)', 'color-scrollbar': 'rgba(249,115,22,0.3)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'JetBrains Mono', monospace",
        'radius-sm': '4px', 'radius-md': '8px', 'radius-lg': '12px',
    },
    monochrome: {
        'color-primary': '#a1a1aa', 'color-primary-rgb': '161,161,170',
        'color-accent': '#d4d4d8', 'color-accent-rgb': '212,212,216',
        'color-success': '#a1a1aa', 'color-warning': '#d4d4d8',
        'color-error': '#71717a', 'color-info': '#a1a1aa',
        'color-surface': '#09090b', 'color-surface-raised': '#18181b',
        'color-surface-overlay': '#27272a',
        'color-border': 'rgba(63,63,70,0.3)', 'color-border-rgb': '63,63,70',
        'color-text': '#fafafa', 'color-text-muted': '#a1a1aa',
        'color-selection': 'rgba(161,161,170,0.2)', 'color-scrollbar': 'rgba(63,63,70,0.4)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'SF Mono', 'Menlo', monospace",
        'radius-sm': '2px', 'radius-md': '4px', 'radius-lg': '6px',
    },
    daylight: {
        'color-primary': '#2563eb', 'color-primary-rgb': '37,99,235',
        'color-accent': '#4f46e5', 'color-accent-rgb': '79,70,229',
        'color-success': '#16a34a', 'color-warning': '#ca8a04',
        'color-error': '#dc2626', 'color-info': '#3b82f6',
        'color-surface': '#ffffff', 'color-surface-raised': '#f4f4f5',
        'color-surface-overlay': '#e4e4e7',
        'color-border': 'rgba(0,0,0,0.1)', 'color-border-rgb': '0,0,0',
        'color-text': '#09090b', 'color-text-muted': '#71717a',
        'color-selection': 'rgba(37,99,235,0.2)', 'color-scrollbar': 'rgba(0,0,0,0.2)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'JetBrains Mono', monospace",
        'radius-sm': '4px', 'radius-md': '8px', 'radius-lg': '12px',
    },
    paper: {
        'color-primary': '#d97706', 'color-primary-rgb': '217,119,6',
        'color-accent': '#b45309', 'color-accent-rgb': '180,83,9',
        'color-success': '#15803d', 'color-warning': '#d97706',
        'color-error': '#b91c1c', 'color-info': '#0369a1',
        'color-surface': '#fdfbf7', 'color-surface-raised': '#f5f0e6',
        'color-surface-overlay': '#eae0d0',
        'color-border': 'rgba(180,83,9,0.15)', 'color-border-rgb': '180,83,9',
        'color-text': '#423e37', 'color-text-muted': '#8c8678',
        'color-selection': 'rgba(217,119,6,0.15)', 'color-scrollbar': 'rgba(66,62,55,0.2)',
        'font-sans': "'Georgia', serif",
        'font-mono': "'Fira Code', monospace",
        'radius-sm': '2px', 'radius-md': '4px', 'radius-lg': '6px',
    },
    corporate: {
        'color-primary': '#1e40af', 'color-primary-rgb': '30,64,175',
        'color-accent': '#334155', 'color-accent-rgb': '51,65,85',
        'color-success': '#15803d', 'color-warning': '#b45309',
        'color-error': '#b91c1c', 'color-info': '#0369a1',
        'color-surface': '#f8fafc', 'color-surface-raised': '#f1f5f9',
        'color-surface-overlay': '#e2e8f0',
        'color-border': 'rgba(148,163,184,0.4)', 'color-border-rgb': '148,163,184',
        'color-text': '#0f172a', 'color-text-muted': '#64748b',
        'color-selection': 'rgba(30,64,175,0.15)', 'color-scrollbar': 'rgba(15,23,42,0.2)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'SF Mono', 'Menlo', monospace",
        'radius-sm': '4px', 'radius-md': '8px', 'radius-lg': '12px',
    },
    solarized: {
        'color-primary': '#268bd2', 'color-primary-rgb': '38,139,210',
        'color-accent': '#cb4b16', 'color-accent-rgb': '203,75,22',
        'color-success': '#859900', 'color-warning': '#b58900',
        'color-error': '#dc322f', 'color-info': '#2aa198',
        'color-surface': '#fdf6e3', 'color-surface-raised': '#eee8d5',
        'color-surface-overlay': '#93a1a1',
        'color-border': 'rgba(101,123,131,0.2)', 'color-border-rgb': '101,123,131',
        'color-text': '#657b83', 'color-text-muted': '#93a1a1',
        'color-selection': 'rgba(38,139,210,0.2)', 'color-scrollbar': 'rgba(101,123,131,0.2)',
        'font-sans': "'Segoe UI', 'Roboto', sans-serif",
        'font-mono': "'Consolas', monospace",
        'radius-sm': '2px', 'radius-md': '4px', 'radius-lg': '6px',
    },
    mermaid: {
        'color-primary': '#ff7eb3', 'color-primary-rgb': '255,126,179',
        'color-accent': '#ff9ff3', 'color-accent-rgb': '255,159,243',
        'color-success': '#2ecc71', 'color-warning': '#f1c40f',
        'color-error': '#e74c3c', 'color-info': '#3498db',
        'color-surface': '#e0f7fa', 'color-surface-raised': '#e1f5fe',
        'color-surface-overlay': '#b3e5fc',
        'color-border': 'rgba(52,152,219,0.2)', 'color-border-rgb': '52,152,219',
        'color-text': '#2c3e50', 'color-text-muted': '#7f8c8d',
        'color-selection': 'rgba(255,126,179,0.2)', 'color-scrollbar': 'rgba(52,152,219,0.2)',
        'font-sans': "'Quicksand', sans-serif",
        'font-mono': "'Fira Code', monospace",
        'radius-sm': '8px', 'radius-md': '16px', 'radius-lg': '24px',
    },
    quiet: {
        'color-primary': '#546e7a', 'color-primary-rgb': '84,110,122',
        'color-accent': '#7986cb', 'color-accent-rgb': '121,134,203',
        'color-success': '#81c784', 'color-warning': '#fff176',
        'color-error': '#e57373', 'color-info': '#64b5f6',
        'color-surface': '#ffffff', 'color-surface-raised': '#f5f5f5',
        'color-surface-overlay': '#eeeeee',
        'color-border': 'rgba(0,0,0,0.08)', 'color-border-rgb': '0,0,0',
        'color-text': '#263238', 'color-text-muted': '#90a4ae',
        'color-selection': 'rgba(84,110,122,0.1)', 'color-scrollbar': 'rgba(0,0,0,0.1)',
        'font-sans': "'Helvetica Neue', sans-serif",
        'font-mono': "'Menlo', monospace",
        'radius-sm': '4px', 'radius-md': '6px', 'radius-lg': '8px',
    },
};

// ── Instance state container ─────────────────────────────────────────────

/**
 * Mutable state for a single activation of the ui-themes plugin.
 * Stored via `api.setInstance()` so that `deactivate()` can clean up
 * even when ESM cache-busting creates a fresh module scope.
 */
class UIThemesState {
    constructor() {
        this.currentTheme = 'midnight';
        this.activeTokenOverrides = {};
        this.injectedCSS = '';
        this.displayNames = { userName: null, agentName: null };
        this.settingsPath = '';
        this.broadcastFn = null;
    }
}

// ── Persistence helpers ──────────────────────────────────────────────────

function loadSettings(state) {
    try {
        if (fs.existsSync(state.settingsPath)) {
            const data = fs.readFileSync(state.settingsPath, 'utf8');
            const s = JSON.parse(data);
            if (s.theme) state.currentTheme = s.theme;
            if (s.tokenOverrides) state.activeTokenOverrides = s.tokenOverrides;
            if (s.injectedCSS) state.injectedCSS = s.injectedCSS;
            if (s.displayNames) state.displayNames = s.displayNames;
        }
    } catch {
        // Ignore load errors
    }
}

async function saveSettings(state) {
    try {
        const dir = path.dirname(state.settingsPath);
        if (!fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
        }
        await fs.promises.writeFile(state.settingsPath, JSON.stringify({
            theme: state.currentTheme,
            tokenOverrides: state.activeTokenOverrides,
            injectedCSS: state.injectedCSS,
            displayNames: state.displayNames,
            updatedAt: new Date().toISOString(),
        }, null, 2));
    } catch {
        // Ignore save errors
    }
}

function broadcast(state, eventType, payload) {
    if (state.broadcastFn && typeof state.broadcastFn === 'function') {
        state.broadcastFn(eventType, payload);
    }
}

// ── Tool handlers (state-parameterised) ──────────────────────────────────

async function handleSetUITheme(state, args) {
    const { theme, custom_tokens } = args;

    if (theme === 'custom') {
        if (!custom_tokens || Object.keys(custom_tokens).length === 0) {
            return 'Error: When theme is "custom", you must provide custom_tokens with at least one token.';
        }
        state.currentTheme = 'custom';
        state.activeTokenOverrides = { ...custom_tokens };
        broadcast(state, 'ui-style:theme', { theme: 'custom', tokens: custom_tokens });
        await saveSettings(state);
        return `Applied custom UI theme with ${Object.keys(custom_tokens).length} tokens.`;
    }

    const preset = THEME_PRESETS[theme];
    if (!preset) {
        return `Error: Unknown theme "${theme}". Available themes: ${Object.keys(THEME_PRESETS).join(', ')}`;
    }

    state.currentTheme = theme;
    state.activeTokenOverrides = {};
    broadcast(state, 'ui-style:theme', { theme, tokens: preset });
    await saveSettings(state);
    return `Applied UI theme "${theme}" with ${Object.keys(preset).length} tokens.`;
}

async function handleSetUITokens(state, args) {
    const { tokens } = args;
    if (!tokens || Object.keys(tokens).length === 0) {
        return 'Error: tokens must be a non-empty object of CSS variable overrides.';
    }

    Object.assign(state.activeTokenOverrides, tokens);
    broadcast(state, 'ui-style:tokens', { tokens });
    await saveSettings(state);
    return `Updated ${Object.keys(tokens).length} UI token(s): ${Object.keys(tokens).join(', ')}.`;
}

async function handleInjectUICSS(state, args) {
    const { css, mode = 'replace' } = args;
    if (!css || css.trim().length === 0) {
        return 'Error: css must be a non-empty string.';
    }

    if (mode === 'replace') {
        state.injectedCSS = css;
    } else {
        state.injectedCSS += '\n' + css;
    }

    broadcast(state, 'ui-style:css', { css: state.injectedCSS, mode });
    const sizeKB = (state.injectedCSS.length / 1024).toFixed(1);
    await saveSettings(state);
    return `Injected CSS (${sizeKB}KB, mode: ${mode}).`;
}

async function handleResetUIStyle(state) {
    state.currentTheme = 'midnight';
    state.activeTokenOverrides = {};
    state.injectedCSS = '';
    broadcast(state, 'ui-style:reset', { theme: 'midnight', tokens: THEME_PRESETS.midnight });
    await saveSettings(state);
    return 'UI style reset to defaults (midnight theme).';
}

async function handleGetUIStyleState(state) {
    return JSON.stringify({
        currentTheme: state.currentTheme,
        availableThemes: Object.keys(THEME_PRESETS),
        activeTokenOverrides: state.activeTokenOverrides,
        hasInjectedCSS: state.injectedCSS.length > 0,
        injectedCSSLength: state.injectedCSS.length,
        displayNames: state.displayNames,
    }, null, 2);
}

async function handleSetDisplayNames(state, args) {
    const { user_name, agent_name } = args;
    if (!user_name && !agent_name) {
        return 'Error: Provide at least one of user_name or agent_name.';
    }

    if (user_name) state.displayNames.userName = user_name;
    if (agent_name) state.displayNames.agentName = agent_name;

    broadcast(state, 'ui-display-names', { ...state.displayNames });

    const parts = [];
    if (user_name) parts.push(`user → "${user_name}"`);
    if (agent_name) parts.push(`agent → "${agent_name}"`);
    await saveSettings(state);
    return `Display names updated: ${parts.join(', ')}.`;
}

// ── Plugin lifecycle ─────────────────────────────────────────────────────

export async function activate(api) {
    const state = new UIThemesState();
    api.setInstance(state);

    // Load plugin-level settings from the settings API
    const { pluginSettings } = await registerSettingsHandlers(
        api, 'ui-themes', DEFAULT_SETTINGS, SETTINGS_SCHEMA
    );

    const workspaceRoot = api.workingDir || process.cwd();
    state.settingsPath = path.join(workspaceRoot, '.oboto', 'ui-settings.json');
    // Use the PluginAPI ws.broadcast for WS-level broadcasting to all clients
    state.broadcastFn = (type, payload) => api.ws.broadcast(type, payload);

    // Apply default theme from plugin settings
    state.currentTheme = pluginSettings.defaultTheme || 'midnight';

    // Load persisted theme state (overrides default if file exists)
    loadSettings(state);

    // ── Register tools ───────────────────────────────────────────────

    api.tools.register({
        useOriginalName: true,
        name: 'set_ui_theme',
        description:
            'Apply a named theme preset to the client UI. ' +
            'Available presets: cyberpunk, ocean, sunset, matrix, midnight, arctic, ' +
            'forest, lavender, ember, monochrome, daylight, paper, corporate, solarized, mermaid, quiet. ' +
            'You may also supply "custom" with a full token map in custom_tokens.',
        parameters: {
            type: 'object',
            properties: {
                theme: {
                    type: 'string',
                    description: 'Theme preset name (e.g. "cyberpunk", "midnight") or "custom" for a fully custom theme.',
                },
                custom_tokens: {
                    type: 'object',
                    description: 'When theme is "custom", provide a map of CSS variable names to values. Keys should omit the leading "--".',
                    additionalProperties: { type: 'string' },
                },
            },
            required: ['theme'],
        },
        handler: (args) => handleSetUITheme(state, args),
    });

    api.tools.register({
        useOriginalName: true,
        name: 'set_ui_tokens',
        description:
            'Override one or more individual CSS custom-property tokens on the client UI without changing the base theme. ' +
            'Useful for fine-tuning colors, fonts, spacing, border radii, etc.',
        parameters: {
            type: 'object',
            properties: {
                tokens: {
                    type: 'object',
                    description: 'Map of CSS variable names (without "--" prefix) to their new values.',
                    additionalProperties: { type: 'string' },
                },
            },
            required: ['tokens'],
        },
        handler: (args) => handleSetUITokens(state, args),
    });

    api.tools.register({
        useOriginalName: true,
        name: 'inject_ui_css',
        description:
            'Inject a block of arbitrary CSS into the client UI. The CSS is inserted into a dedicated <style> tag.',
        parameters: {
            type: 'object',
            properties: {
                css: { type: 'string', description: 'Raw CSS string to inject.' },
                mode: {
                    type: 'string',
                    enum: ['replace', 'append'],
                    description: '"replace" clears previous injections, "append" adds to them. Default: "replace".',
                },
            },
            required: ['css'],
        },
        handler: (args) => handleInjectUICSS(state, args),
    });

    api.tools.register({
        useOriginalName: true,
        name: 'reset_ui_style',
        description: 'Reset the client UI styling back to the system default, clearing all custom tokens, injected CSS, and reverting to the default theme.',
        parameters: { type: 'object', properties: {} },
        handler: () => handleResetUIStyle(state),
    });

    api.tools.register({
        useOriginalName: true,
        name: 'get_ui_style_state',
        description: 'Query the current UI style state including the active theme name, any custom token overrides, and whether custom CSS has been injected.',
        parameters: { type: 'object', properties: {} },
        handler: () => handleGetUIStyleState(state),
    });

    api.tools.register({
        useOriginalName: true,
        name: 'set_display_names',
        description:
            "Set the display names shown in the chat UI for the user and/or the AI agent. " +
            "Call this when you learn the user's name or when you adopt/change your own name.",
        parameters: {
            type: 'object',
            properties: {
                user_name: { type: 'string', description: "The user's name to display on their chat messages." },
                agent_name: { type: 'string', description: "The AI agent's name to display on its chat messages." },
            },
        },
        handler: (args) => handleSetDisplayNames(state, args),
    });

    // ── Register WebSocket handlers ──────────────────────────────────

    api.ws.register('set-ui-theme', async (data, ctx) => {
        try {
            const result = await handleSetUITheme(state, data.payload || data);
            if (ctx && ctx.ws) {
                ctx.ws.send(JSON.stringify({ type: 'plugin:ui-themes:theme-applied', payload: { result } }));
            }
        } catch (err) {
            if (ctx && ctx.ws) {
                ctx.ws.send(JSON.stringify({ type: 'plugin:ui-themes:error', payload: { error: err.message } }));
            }
        }
    });

    api.ws.register('set-ui-tokens', async (data, ctx) => {
        try {
            const result = await handleSetUITokens(state, data.payload || data);
            if (ctx && ctx.ws) {
                ctx.ws.send(JSON.stringify({ type: 'plugin:ui-themes:tokens-applied', payload: { result } }));
            }
        } catch (err) {
            if (ctx && ctx.ws) {
                ctx.ws.send(JSON.stringify({ type: 'plugin:ui-themes:error', payload: { error: err.message } }));
            }
        }
    });

    api.ws.register('reset-ui-style', async (_data, ctx) => {
        try {
            const result = await handleResetUIStyle(state);
            if (ctx && ctx.ws) {
                ctx.ws.send(JSON.stringify({ type: 'plugin:ui-themes:style-reset', payload: { result } }));
            }
        } catch (err) {
            if (ctx && ctx.ws) {
                ctx.ws.send(JSON.stringify({ type: 'plugin:ui-themes:error', payload: { error: err.message } }));
            }
        }
    });

    api.ws.register('get-ui-style-state', async (_data, ctx) => {
        try {
            const stateJson = await handleGetUIStyleState(state);
            if (ctx && ctx.ws) {
                ctx.ws.send(JSON.stringify({ type: 'plugin:ui-themes:ui-style-state', payload: JSON.parse(stateJson) }));
            }
        } catch (err) {
            if (ctx && ctx.ws) {
                ctx.ws.send(JSON.stringify({ type: 'plugin:ui-themes:error', payload: { error: err.message } }));
            }
        }
    });

}

export async function deactivate(api) {
    // Clean up instance state — the PluginAPI._cleanup() handles tool/handler
    // unregistration, so we only need to clear our own state reference.
    if (api.getInstance()) {
        api.getInstance().broadcastFn = null;
        api.setInstance(null);
    }
}
