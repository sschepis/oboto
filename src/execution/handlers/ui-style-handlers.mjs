// UI Style Handlers
// Processes set_ui_theme, set_ui_tokens, inject_ui_css, reset_ui_style, get_ui_style_state
// Emits eventBus events that the web-server bridges to all connected WS clients.

import { consoleStyler } from '../../ui/console-styler.mjs';

/**
 * Built-in theme presets.
 * Each preset maps CSS-variable tokens (without leading "--") to values.
 * The client uses these to update :root CSS variables dynamically.
 */
const THEME_PRESETS = {
    cyberpunk: {
        'color-primary': '#7928ca',
        'color-primary-rgb': '121,40,202',
        'color-accent': '#ff0080',
        'color-accent-rgb': '255,0,128',
        'color-success': '#00ff88',
        'color-warning': '#ffaa00',
        'color-error': '#ff4757',
        'color-info': '#5352ed',
        'color-surface': '#0a0a0f',
        'color-surface-raised': '#12121a',
        'color-surface-overlay': '#1a1a25',
        'color-border': 'rgba(121,40,202,0.2)',
        'color-text': '#e4e4e7',
        'color-text-muted': '#a1a1aa',
        'color-selection': 'rgba(121,40,202,0.3)',
        'color-scrollbar': 'rgba(121,40,202,0.4)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'JetBrains Mono', 'Fira Code', monospace",
        'radius-sm': '4px',
        'radius-md': '8px',
        'radius-lg': '12px',
    },
    ocean: {
        'color-primary': '#667eea',
        'color-primary-rgb': '102,126,234',
        'color-accent': '#30e8bf',
        'color-accent-rgb': '48,232,191',
        'color-success': '#4ecdc4',
        'color-warning': '#f9ca24',
        'color-error': '#eb4d4b',
        'color-info': '#6c5ce7',
        'color-surface': '#080c14',
        'color-surface-raised': '#0e1422',
        'color-surface-overlay': '#141c2e',
        'color-border': 'rgba(102,126,234,0.2)',
        'color-text': '#d4e0f7',
        'color-text-muted': '#7e8da8',
        'color-selection': 'rgba(102,126,234,0.3)',
        'color-scrollbar': 'rgba(102,126,234,0.4)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'JetBrains Mono', monospace",
        'radius-sm': '4px',
        'radius-md': '8px',
        'radius-lg': '12px',
    },
    sunset: {
        'color-primary': '#fa709a',
        'color-primary-rgb': '250,112,154',
        'color-accent': '#fee140',
        'color-accent-rgb': '254,225,64',
        'color-success': '#d299c2',
        'color-warning': '#f7b733',
        'color-error': '#fc4a1a',
        'color-info': '#667eea',
        'color-surface': '#0f0a08',
        'color-surface-raised': '#1a1210',
        'color-surface-overlay': '#261a16',
        'color-border': 'rgba(250,112,154,0.2)',
        'color-text': '#f5e6df',
        'color-text-muted': '#b09488',
        'color-selection': 'rgba(250,112,154,0.3)',
        'color-scrollbar': 'rgba(250,112,154,0.4)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'Fira Code', monospace",
        'radius-sm': '6px',
        'radius-md': '10px',
        'radius-lg': '16px',
    },
    matrix: {
        'color-primary': '#00ff41',
        'color-primary-rgb': '0,255,65',
        'color-accent': '#39ff14',
        'color-accent-rgb': '57,255,20',
        'color-success': '#00ff88',
        'color-warning': '#ffff00',
        'color-error': '#ff0040',
        'color-info': '#00ffff',
        'color-surface': '#000000',
        'color-surface-raised': '#0a0f0a',
        'color-surface-overlay': '#0f1a0f',
        'color-border': 'rgba(0,255,65,0.15)',
        'color-text': '#b0ffb0',
        'color-text-muted': '#508050',
        'color-selection': 'rgba(0,255,65,0.2)',
        'color-scrollbar': 'rgba(0,255,65,0.3)',
        'font-sans': "'Courier New', monospace",
        'font-mono': "'Courier New', monospace",
        'radius-sm': '0px',
        'radius-md': '0px',
        'radius-lg': '0px',
    },
    midnight: {
        'color-primary': '#818cf8',
        'color-primary-rgb': '129,140,248',
        'color-accent': '#a78bfa',
        'color-accent-rgb': '167,139,250',
        'color-success': '#34d399',
        'color-warning': '#fbbf24',
        'color-error': '#f87171',
        'color-info': '#60a5fa',
        'color-surface': '#080808',
        'color-surface-raised': '#111111',
        'color-surface-overlay': '#191919',
        'color-border': 'rgba(63,63,70,0.2)',
        'color-text': '#e4e4e7',
        'color-text-muted': '#a1a1aa',
        'color-selection': 'rgba(99,102,241,0.3)',
        'color-scrollbar': 'rgba(63,63,70,0.4)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'JetBrains Mono', monospace",
        'radius-sm': '4px',
        'radius-md': '8px',
        'radius-lg': '12px',
    },
    arctic: {
        'color-primary': '#38bdf8',
        'color-primary-rgb': '56,189,248',
        'color-accent': '#7dd3fc',
        'color-accent-rgb': '125,211,252',
        'color-success': '#2dd4bf',
        'color-warning': '#fde68a',
        'color-error': '#fb7185',
        'color-info': '#93c5fd',
        'color-surface': '#0c1929',
        'color-surface-raised': '#122340',
        'color-surface-overlay': '#1a2d4d',
        'color-border': 'rgba(56,189,248,0.15)',
        'color-text': '#e0f2fe',
        'color-text-muted': '#7dd3fc',
        'color-selection': 'rgba(56,189,248,0.25)',
        'color-scrollbar': 'rgba(56,189,248,0.3)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'SF Mono', 'Cascadia Code', monospace",
        'radius-sm': '6px',
        'radius-md': '10px',
        'radius-lg': '14px',
    },
    forest: {
        'color-primary': '#22c55e',
        'color-primary-rgb': '34,197,94',
        'color-accent': '#86efac',
        'color-accent-rgb': '134,239,172',
        'color-success': '#4ade80',
        'color-warning': '#facc15',
        'color-error': '#ef4444',
        'color-info': '#a3e635',
        'color-surface': '#071108',
        'color-surface-raised': '#0e1f10',
        'color-surface-overlay': '#142a16',
        'color-border': 'rgba(34,197,94,0.15)',
        'color-text': '#dcfce7',
        'color-text-muted': '#6ee7b7',
        'color-selection': 'rgba(34,197,94,0.25)',
        'color-scrollbar': 'rgba(34,197,94,0.3)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'JetBrains Mono', monospace",
        'radius-sm': '4px',
        'radius-md': '8px',
        'radius-lg': '12px',
    },
    lavender: {
        'color-primary': '#c084fc',
        'color-primary-rgb': '192,132,252',
        'color-accent': '#e879f9',
        'color-accent-rgb': '232,121,249',
        'color-success': '#a78bfa',
        'color-warning': '#fcd34d',
        'color-error': '#fb7185',
        'color-info': '#d8b4fe',
        'color-surface': '#0f0a14',
        'color-surface-raised': '#1a1224',
        'color-surface-overlay': '#231a30',
        'color-border': 'rgba(192,132,252,0.15)',
        'color-text': '#f3e8ff',
        'color-text-muted': '#c4b5fd',
        'color-selection': 'rgba(192,132,252,0.25)',
        'color-scrollbar': 'rgba(192,132,252,0.3)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'Fira Code', monospace",
        'radius-sm': '6px',
        'radius-md': '10px',
        'radius-lg': '16px',
    },
    ember: {
        'color-primary': '#f97316',
        'color-primary-rgb': '249,115,22',
        'color-accent': '#fb923c',
        'color-accent-rgb': '251,146,60',
        'color-success': '#84cc16',
        'color-warning': '#eab308',
        'color-error': '#dc2626',
        'color-info': '#f59e0b',
        'color-surface': '#100804',
        'color-surface-raised': '#1c1008',
        'color-surface-overlay': '#28180c',
        'color-border': 'rgba(249,115,22,0.15)',
        'color-text': '#fff7ed',
        'color-text-muted': '#fdba74',
        'color-selection': 'rgba(249,115,22,0.25)',
        'color-scrollbar': 'rgba(249,115,22,0.3)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'JetBrains Mono', monospace",
        'radius-sm': '4px',
        'radius-md': '8px',
        'radius-lg': '12px',
    },
    monochrome: {
        'color-primary': '#a1a1aa',
        'color-primary-rgb': '161,161,170',
        'color-accent': '#d4d4d8',
        'color-accent-rgb': '212,212,216',
        'color-success': '#a1a1aa',
        'color-warning': '#d4d4d8',
        'color-error': '#71717a',
        'color-info': '#a1a1aa',
        'color-surface': '#09090b',
        'color-surface-raised': '#18181b',
        'color-surface-overlay': '#27272a',
        'color-border': 'rgba(63,63,70,0.3)',
        'color-text': '#fafafa',
        'color-text-muted': '#a1a1aa',
        'color-selection': 'rgba(161,161,170,0.2)',
        'color-scrollbar': 'rgba(63,63,70,0.4)',
        'font-sans': "'Inter', system-ui, sans-serif",
        'font-mono': "'SF Mono', 'Menlo', monospace",
        'radius-sm': '2px',
        'radius-md': '4px',
        'radius-lg': '6px',
    },
};

export class UIStyleHandlers {
    constructor(eventBus) {
        this.eventBus = eventBus;
        // Track current style state server-side
        this.currentTheme = 'midnight'; // default
        this.activeTokenOverrides = {};
        this.injectedCSS = '';
    }

    /** Apply a named preset or fully custom theme. */
    async setUITheme(args) {
        const { theme, custom_tokens } = args;

        if (theme === 'custom') {
            if (!custom_tokens || Object.keys(custom_tokens).length === 0) {
                return 'Error: When theme is "custom", you must provide custom_tokens with at least one token.';
            }
            this.currentTheme = 'custom';
            this.activeTokenOverrides = { ...custom_tokens };
            this._broadcast('ui-style:theme', {
                theme: 'custom',
                tokens: custom_tokens
            });
            consoleStyler.log('system', `🎨 UI theme set to custom (${Object.keys(custom_tokens).length} tokens)`);
            return `Applied custom UI theme with ${Object.keys(custom_tokens).length} tokens.`;
        }

        const preset = THEME_PRESETS[theme];
        if (!preset) {
            const available = Object.keys(THEME_PRESETS).join(', ');
            return `Error: Unknown theme "${theme}". Available themes: ${available}`;
        }

        this.currentTheme = theme;
        this.activeTokenOverrides = {};
        this._broadcast('ui-style:theme', {
            theme,
            tokens: preset
        });

        // Also update the console-styler theme if it has a matching name
        if (consoleStyler.setTheme(theme)) {
            consoleStyler.log('system', `🎨 Console theme also updated to "${theme}"`);
        }

        consoleStyler.log('system', `🎨 UI theme set to "${theme}"`);
        return `Applied UI theme "${theme}" with ${Object.keys(preset).length} tokens.`;
    }

    /** Override specific tokens without changing the base theme. */
    async setUITokens(args) {
        const { tokens } = args;

        if (!tokens || Object.keys(tokens).length === 0) {
            return 'Error: tokens must be a non-empty object of CSS variable overrides.';
        }

        // Merge into active overrides
        Object.assign(this.activeTokenOverrides, tokens);

        this._broadcast('ui-style:tokens', { tokens });

        consoleStyler.log('system', `🎨 Updated ${Object.keys(tokens).length} UI token(s): ${Object.keys(tokens).join(', ')}`);
        return `Updated ${Object.keys(tokens).length} UI token(s): ${Object.keys(tokens).join(', ')}.`;
    }

    /** Inject raw CSS into the client. */
    async injectUICSS(args) {
        const { css, mode = 'replace' } = args;

        if (!css || css.trim().length === 0) {
            return 'Error: css must be a non-empty string.';
        }

        if (mode === 'replace') {
            this.injectedCSS = css;
        } else {
            this.injectedCSS += '\n' + css;
        }

        this._broadcast('ui-style:css', {
            css: this.injectedCSS,
            mode
        });

        const sizeKB = (this.injectedCSS.length / 1024).toFixed(1);
        consoleStyler.log('system', `🎨 Injected ${sizeKB}KB of custom CSS (mode: ${mode})`);
        return `Injected CSS (${sizeKB}KB, mode: ${mode}).`;
    }

    /** Reset everything back to defaults. */
    async resetUIStyle() {
        this.currentTheme = 'midnight';
        this.activeTokenOverrides = {};
        this.injectedCSS = '';

        this._broadcast('ui-style:reset', {
            theme: 'midnight',
            tokens: THEME_PRESETS.midnight
        });

        consoleStyler.log('system', '🎨 UI style reset to defaults');
        return 'UI style reset to defaults (midnight theme).';
    }

    /** Return the current style state. */
    async getUIStyleState() {
        const state = {
            currentTheme: this.currentTheme,
            availableThemes: Object.keys(THEME_PRESETS),
            activeTokenOverrides: this.activeTokenOverrides,
            hasInjectedCSS: this.injectedCSS.length > 0,
            injectedCSSLength: this.injectedCSS.length
        };

        return JSON.stringify(state, null, 2);
    }

    /** Helper to emit via eventBus. */
    _broadcast(eventType, payload) {
        if (this.eventBus) {
            this.eventBus.emit(eventType, payload);
        }
    }

    /** Get token map for a preset (used by web-server for WS theme-sync on connect). */
    static getPreset(name) {
        return THEME_PRESETS[name] || null;
    }

    /** Get all available preset names. */
    static getPresetNames() {
        return Object.keys(THEME_PRESETS);
    }
}
