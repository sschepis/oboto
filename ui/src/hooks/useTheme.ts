import { useEffect, useRef, useCallback, useState } from 'react';
import { wsService } from '../services/wsService';

/** Token map: CSS variable name (without "--") → value */
export type TokenMap = Record<string, string>;

export interface ThemeState {
  /** Currently active theme name */
  currentTheme: string;
  /** Token overrides applied on top of the base theme */
  activeTokenOverrides: TokenMap;
  /** Whether custom CSS has been injected */
  hasInjectedCSS: boolean;
}

const AI_CSS_STYLE_ID = 'ai-injected-css';
const AI_THEME_STYLE_ID = 'ai-theme-vars';
const AI_THEME_OVERRIDES_ID = 'ai-theme-overrides';

/**
 * CSS overrides that remap both Tailwind v4 palette CSS variables AND
 * hardcoded arbitrary color classes to dynamic theme tokens.
 *
 * Tailwind v4 utility classes like `bg-zinc-900` compile to
 * `background-color: var(--color-zinc-900)`. By overriding these CSS
 * variables, ALL Tailwind utility classes automatically respond to
 * theme changes.
 *
 * Hardcoded classes like `bg-[#080808]` are also overridden via
 * explicit CSS selectors since they don't use CSS variables.
 */
const THEME_OVERRIDE_CSS = `
/* ═══════════════════════════════════════════════════════════════════
   Tailwind v4 Palette Bridge
   Remaps Tailwind's built-in color palette CSS variables to
   dynamic theme tokens so ALL utility classes respond to
   theme changes automatically.
   ═══════════════════════════════════════════════════════════════════ */

/* ── Zinc (neutral) palette → theme surface/text tokens ────────── */
:root {
  --color-zinc-950: var(--color-surface) !important;
  --color-zinc-900: color-mix(in srgb, var(--color-surface) 35%, var(--color-surface-raised) 65%) !important;
  --color-zinc-800: var(--color-surface-raised) !important;
  --color-zinc-700: color-mix(in srgb, var(--color-surface-overlay) 65%, var(--color-text-muted) 35%) !important;
  --color-zinc-600: color-mix(in srgb, var(--color-surface-overlay) 35%, var(--color-text-muted) 65%) !important;
  --color-zinc-500: color-mix(in srgb, var(--color-text-muted) 75%, var(--color-surface-overlay) 25%) !important;
  --color-zinc-400: var(--color-text-muted) !important;
  --color-zinc-300: color-mix(in srgb, var(--color-text) 50%, var(--color-text-muted) 50%) !important;
  --color-zinc-200: color-mix(in srgb, var(--color-text) 80%, var(--color-text-muted) 20%) !important;
  --color-zinc-100: var(--color-text) !important;
  --color-zinc-50: color-mix(in srgb, var(--color-text) 80%, white 20%) !important;
}

/* ── Indigo (primary) palette → theme primary token ────────────── */
:root {
  --color-indigo-950: color-mix(in srgb, var(--color-primary) 25%, black 75%) !important;
  --color-indigo-900: color-mix(in srgb, var(--color-primary) 35%, black 65%) !important;
  --color-indigo-800: color-mix(in srgb, var(--color-primary) 50%, black 50%) !important;
  --color-indigo-700: color-mix(in srgb, var(--color-primary) 70%, black 30%) !important;
  --color-indigo-600: var(--color-primary) !important;
  --color-indigo-500: color-mix(in srgb, var(--color-primary) 85%, white 15%) !important;
  --color-indigo-400: color-mix(in srgb, var(--color-primary) 70%, white 30%) !important;
  --color-indigo-300: color-mix(in srgb, var(--color-primary) 50%, white 50%) !important;
  --color-indigo-200: color-mix(in srgb, var(--color-primary) 30%, white 70%) !important;
  --color-indigo-100: color-mix(in srgb, var(--color-primary) 15%, white 85%) !important;
  --color-indigo-50: color-mix(in srgb, var(--color-primary) 5%, white 95%) !important;
}

/* ── Purple / Violet (accent) palette ──────────────────────────── */
:root {
  --color-purple-700: color-mix(in srgb, var(--color-accent) 70%, black 30%) !important;
  --color-purple-600: var(--color-accent) !important;
  --color-purple-500: color-mix(in srgb, var(--color-accent) 85%, white 15%) !important;
  --color-purple-400: color-mix(in srgb, var(--color-accent) 70%, white 30%) !important;
  --color-purple-300: color-mix(in srgb, var(--color-accent) 50%, white 50%) !important;
  --color-violet-600: var(--color-accent) !important;
  --color-violet-500: color-mix(in srgb, var(--color-accent) 85%, white 15%) !important;
  --color-violet-400: color-mix(in srgb, var(--color-accent) 70%, white 30%) !important;
}

/* ── Emerald (success) palette ─────────────────────────────────── */
:root {
  --color-emerald-600: color-mix(in srgb, var(--color-success) 85%, black 15%) !important;
  --color-emerald-500: var(--color-success) !important;
  --color-emerald-400: color-mix(in srgb, var(--color-success) 80%, white 20%) !important;
  --color-emerald-300: color-mix(in srgb, var(--color-success) 60%, white 40%) !important;
}

/* ── Red / Rose (error) palette ────────────────────────────────── */
:root {
  --color-red-700: color-mix(in srgb, var(--color-error) 70%, black 30%) !important;
  --color-red-600: color-mix(in srgb, var(--color-error) 85%, black 15%) !important;
  --color-red-500: var(--color-error) !important;
  --color-red-400: color-mix(in srgb, var(--color-error) 80%, white 20%) !important;
  --color-rose-800: color-mix(in srgb, var(--color-error) 50%, black 50%) !important;
  --color-rose-500: var(--color-error) !important;
  --color-rose-400: color-mix(in srgb, var(--color-error) 80%, white 20%) !important;
  --color-rose-300: color-mix(in srgb, var(--color-error) 60%, white 40%) !important;
  --color-rose-950: color-mix(in srgb, var(--color-error) 20%, black 80%) !important;
}

/* ── Amber (warning) palette ───────────────────────────────────── */
:root {
  --color-amber-600: color-mix(in srgb, var(--color-warning) 85%, black 15%) !important;
  --color-amber-500: var(--color-warning) !important;
  --color-amber-400: color-mix(in srgb, var(--color-warning) 80%, white 20%) !important;
  --color-amber-300: color-mix(in srgb, var(--color-warning) 60%, white 40%) !important;
}

/* ── Blue / Sky (info) palette ─────────────────────────────────── */
:root {
  --color-blue-600: color-mix(in srgb, var(--color-info) 85%, black 15%) !important;
  --color-blue-500: var(--color-info) !important;
  --color-blue-400: var(--color-info) !important;
  --color-sky-500: var(--color-info) !important;
  --color-sky-400: color-mix(in srgb, var(--color-info) 80%, white 20%) !important;
}

/* ═══════════════════════════════════════════════════════════════════
   Hardcoded Arbitrary Value Overrides
   Remap bg-[#hex] classes used in component templates that
   cannot be changed via Tailwind palette variables.
   ═══════════════════════════════════════════════════════════════════ */

/* Surface-level backgrounds — primary background */
.bg-\\[\\#080808\\] { background-color: var(--color-surface) !important; }

/* Surface-raised backgrounds — cards, panels, containers */
.bg-\\[\\#111111\\] { background-color: var(--color-surface-raised) !important; }

/* Surface-dim backgrounds — slightly raised from base */
.bg-\\[\\#0a0a0a\\],
.bg-\\[\\#0a0a0a\\]\\/80,
.bg-\\[\\#0a0a0a\\]\\/95 {
  background-color: color-mix(in srgb, var(--color-surface) 70%, var(--color-surface-raised) 30%) !important;
}

/* Surface mid-tone — headers, toolbars */
.bg-\\[\\#0c0c0c\\],
.bg-\\[\\#0c0c0c\\]\\/95 {
  background-color: color-mix(in srgb, var(--color-surface) 50%, var(--color-surface-raised) 50%) !important;
}

/* Surface-overlay / tooltips, context menus */
.bg-\\[\\#0e0e0e\\] { background-color: var(--color-surface-overlay) !important; }
.bg-\\[\\#0d0d0d\\],
.bg-\\[\\#0d0d0d\\]\\/95 {
  background-color: color-mix(in srgb, var(--color-surface) 60%, var(--color-surface-raised) 40%) !important;
}

/* Terminal / deep backgrounds */
.bg-\\[\\#050505\\] {
  background-color: color-mix(in srgb, var(--color-surface) 90%, black 10%) !important;
}

/* Input / form field backgrounds */
.bg-\\[\\#161616\\] {
  background-color: var(--color-surface-raised) !important;
}

/* BrowserPreview chrome colors */
.bg-\\[\\#1e1e1e\\] {
  background-color: color-mix(in srgb, var(--color-surface-raised) 60%, var(--color-surface-overlay) 40%) !important;
}
.bg-\\[\\#2d2d2d\\] {
  background-color: var(--color-surface-overlay) !important;
}
.bg-\\[\\#111\\] {
  background-color: var(--color-surface-raised) !important;
}

/* Border overrides — common border colors */
.border-\\[\\#080808\\] { border-color: var(--color-surface) !important; }

/* Text color safety net (also handled by zinc palette bridge above) */
.text-zinc-100 { color: var(--color-text) !important; }
.text-zinc-200 { color: color-mix(in srgb, var(--color-text) 90%, var(--color-text-muted) 10%) !important; }
`;

/**
 * useTheme — manages dynamic restyling of the UI.
 *
 * On mount, captures the original `:root` CSS variable values
 * so they can be restored with `resetToOriginal()`.
 *
 * Listens to four WS events emitted by the server's UIStyleHandlers:
 *  - `ui-style-theme`  → apply a full theme preset
 *  - `ui-style-tokens` → override individual tokens
 *  - `ui-style-css`    → inject arbitrary CSS
 *  - `ui-style-reset`  → revert to defaults
 */
export function useTheme() {
  // Snapshot of original CSS variable values taken on first mount
  const originalVarsRef = useRef<TokenMap | null>(null);
  const [themeState, setThemeState] = useState<ThemeState>({
    currentTheme: 'default',
    activeTokenOverrides: {},
    hasInjectedCSS: false,
  });

  // ── Capture original :root variables on mount ──────────────────────
  useEffect(() => {
    if (originalVarsRef.current) return; // already captured

    const root = document.documentElement;
    const computed = getComputedStyle(root);
    const snapshot: TokenMap = {};

    // Capture all inline style vars currently on :root
    // Also capture key CSS properties we manage
    const managedKeys = [
      'color-primary', 'color-primary-rgb',
      'color-accent', 'color-accent-rgb',
      'color-success', 'color-warning', 'color-error', 'color-info',
      'color-surface', 'color-surface-raised', 'color-surface-overlay',
      'color-border', 'color-border-rgb', 'color-text', 'color-text-muted',
      'color-selection', 'color-scrollbar',
      'font-sans', 'font-mono',
      'radius-sm', 'radius-md', 'radius-lg',
    ];

    for (const key of managedKeys) {
      const val = computed.getPropertyValue(`--${key}`).trim();
      if (val) {
        snapshot[key] = val;
      }
    }

    originalVarsRef.current = snapshot;
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────

  /** Apply a token map to :root via a dedicated <style> element. */
  const applyTokens = useCallback((tokens: TokenMap) => {
    let styleEl = document.getElementById(AI_THEME_STYLE_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = AI_THEME_STYLE_ID;
      document.head.appendChild(styleEl);
    }

    // Build :root rule from tokens
    const declarations = Object.entries(tokens)
      .map(([key, value]) => `  --${key}: ${value};`)
      .join('\n');

    styleEl.textContent = `:root {\n${declarations}\n}`;

    // Also apply critical tokens directly to body/html for immediate paint
    const root = document.documentElement;
    for (const [key, value] of Object.entries(tokens)) {
      root.style.setProperty(`--${key}`, value);
    }

    // Update key surface-level CSS that uses hardcoded values in Tailwind
    if (tokens['color-surface']) {
      root.style.backgroundColor = tokens['color-surface'];
      document.body.style.backgroundColor = tokens['color-surface'];
    }
    if (tokens['color-text']) {
      root.style.color = tokens['color-text'];
    }
    if (tokens['font-sans']) {
      root.style.fontFamily = tokens['font-sans'];
    }

    // Inject hardcoded-color override CSS so Tailwind arbitrary values
    // like bg-[#080808] also respond to theme changes
    let overrideEl = document.getElementById(AI_THEME_OVERRIDES_ID) as HTMLStyleElement | null;
    if (!overrideEl) {
      overrideEl = document.createElement('style');
      overrideEl.id = AI_THEME_OVERRIDES_ID;
      document.head.appendChild(overrideEl);
    }
    overrideEl.textContent = THEME_OVERRIDE_CSS;
  }, []);

  /** Set or replace injected CSS. */
  const applyInjectedCSS = useCallback((css: string) => {
    let styleEl = document.getElementById(AI_CSS_STYLE_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = AI_CSS_STYLE_ID;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css;
  }, []);

  /** Remove all AI-applied styling. */
  const clearAllStyling = useCallback(() => {
    // Remove theme vars style element
    document.getElementById(AI_THEME_STYLE_ID)?.remove();
    // Remove injected CSS style element
    document.getElementById(AI_CSS_STYLE_ID)?.remove();
    // Remove hardcoded-color override CSS
    document.getElementById(AI_THEME_OVERRIDES_ID)?.remove();

    // Clear inline styles on :root
    const root = document.documentElement;
    const managedKeys = [
      'color-primary', 'color-primary-rgb',
      'color-accent', 'color-accent-rgb',
      'color-success', 'color-warning', 'color-error', 'color-info',
      'color-surface', 'color-surface-raised', 'color-surface-overlay',
      'color-border', 'color-border-rgb', 'color-text', 'color-text-muted',
      'color-selection', 'color-scrollbar',
      'font-sans', 'font-mono',
      'radius-sm', 'radius-md', 'radius-lg',
    ];
    for (const key of managedKeys) {
      root.style.removeProperty(`--${key}`);
    }
    root.style.backgroundColor = '';
    root.style.color = '';
    root.style.fontFamily = '';
    document.body.style.backgroundColor = '';
  }, []);

  // ── WS Event listeners ─────────────────────────────────────────────
  useEffect(() => {
    const unsubTheme = wsService.on('ui-style-theme', (payload: unknown) => {
      const { theme, tokens } = payload as { theme: string; tokens: TokenMap };
      applyTokens(tokens);
      setThemeState(prev => ({
        ...prev,
        currentTheme: theme,
        activeTokenOverrides: theme === 'custom' ? tokens : {},
      }));
    });

    const unsubTokens = wsService.on('ui-style-tokens', (payload: unknown) => {
      const { tokens } = payload as { tokens: TokenMap };
      applyTokens(tokens);
      setThemeState(prev => ({
        ...prev,
        activeTokenOverrides: { ...prev.activeTokenOverrides, ...tokens },
      }));
    });

    const unsubCSS = wsService.on('ui-style-css', (payload: unknown) => {
      const { css } = payload as { css: string; mode: string };
      applyInjectedCSS(css);
      setThemeState(prev => ({
        ...prev,
        hasInjectedCSS: css.length > 0,
      }));
    });

    const unsubReset = wsService.on('ui-style-reset', (payload: unknown) => {
      const { tokens } = payload as { theme: string; tokens: TokenMap };
      clearAllStyling();
      // Apply the default theme tokens
      applyTokens(tokens);
      setThemeState({
        currentTheme: 'midnight',
        activeTokenOverrides: {},
        hasInjectedCSS: false,
      });
    });

    return () => {
      unsubTheme();
      unsubTokens();
      unsubCSS();
      unsubReset();
    };
  }, [applyTokens, applyInjectedCSS, clearAllStyling]);

  // ── Public API ─────────────────────────────────────────────────────

  /** Reset to the absolute original state (pre-AI). */
  const resetToOriginal = useCallback(() => {
    clearAllStyling();

    // Restore captured original vars
    if (originalVarsRef.current && Object.keys(originalVarsRef.current).length > 0) {
      applyTokens(originalVarsRef.current);
    }

    setThemeState({
      currentTheme: 'default',
      activeTokenOverrides: {},
      hasInjectedCSS: false,
    });

    // Tell the server too, so it knows the state
    wsService.sendMessage('reset-ui-style');
  }, [clearAllStyling, applyTokens]);

  /** Programmatically set a theme from the client side. */
  const setTheme = useCallback((themeName: string) => {
    wsService.sendMessage('set-ui-theme', { theme: themeName });
  }, []);

  /** Programmatically set individual tokens from the client side. */
  const setTokens = useCallback((tokens: TokenMap) => {
    wsService.sendMessage('set-ui-tokens', { tokens });
  }, []);

  return {
    themeState,
    setTheme,
    setTokens,
    resetToOriginal,
  };
}
