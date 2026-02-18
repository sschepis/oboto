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
      'color-border', 'color-text', 'color-text-muted',
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

    // Clear inline styles on :root
    const root = document.documentElement;
    const managedKeys = [
      'color-primary', 'color-primary-rgb',
      'color-accent', 'color-accent-rgb',
      'color-success', 'color-warning', 'color-error', 'color-info',
      'color-surface', 'color-surface-raised', 'color-surface-overlay',
      'color-border', 'color-text', 'color-text-muted',
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
