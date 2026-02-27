import { useEffect, useRef } from 'react';

export interface KeyboardShortcut {
  id: string;
  /** Human-readable key combo, e.g. '⌘S' */
  display: string;
  /** Description shown in the help dialog */
  description: string;
  /** Category for grouping in the help dialog */
  category: 'general' | 'tabs' | 'editor' | 'navigation';
  /** The handler; shortcuts with no handler are informational only */
  handler?: () => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
const modSymbol = isMac ? '⌘' : 'Ctrl+';
const shiftSymbol = '⇧';

/**
 * Returns a stable set of keyboard shortcut definitions and registers them.
 *
 * All callbacks should be wrapped in useCallback by the consumer and passed
 * via the `actions` parameter.
 */
export function useKeyboardShortcuts(actions: {
  openPalette: () => void;
  openSettings: () => void;
  closeActiveTab: () => void;
  saveActiveFile: () => void;
  focusChat: () => void;
  switchToTabByIndex: (index: number) => void;
  nextTab: () => void;
  prevTab: () => void;
  toggleSidebar?: () => void;
  showShortcutsHelp: () => void;
  openTaskManager?: () => void;
  toggleTerminal?: () => void;
  toggleConsole?: () => void;
  toggleHelpPanel?: () => void;
  toggleWhatIsThis?: () => void;
}) {
  // Keep actions in a ref so we don't re-register listeners on every render
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  });

  // Build the shortcut catalog (stable across renders)
  const shortcuts: KeyboardShortcut[] = [
    // General
    { id: 'palette', display: `${modSymbol}${shiftSymbol}P`, description: 'Open command palette', category: 'general' },
    { id: 'settings', display: `${modSymbol},`, description: 'Open settings', category: 'general' },
    { id: 'help-panel', display: `${modSymbol}/`, description: 'Toggle help panel', category: 'general' },
    { id: 'shortcuts-help', display: `${modSymbol}${shiftSymbol}/`, description: 'Show keyboard shortcuts', category: 'general' },
    { id: 'focus-chat', display: `${modSymbol}${shiftSymbol}C`, description: 'Focus chat input', category: 'general' },
    { id: 'task-manager', display: `${modSymbol}${shiftSymbol}T`, description: 'Open task manager', category: 'general' },
    { id: 'toggle-terminal', display: `${modSymbol}\``, description: 'Toggle drop-down terminal', category: 'general' },
    { id: 'toggle-console', display: `${modSymbol}J`, description: 'Toggle console log panel', category: 'general' },

    // Tabs
    { id: 'close-tab', display: `${modSymbol}W`, description: 'Close active tab', category: 'tabs' },
    { id: 'next-tab', display: `${modSymbol}${shiftSymbol}]`, description: 'Next tab', category: 'tabs' },
    { id: 'prev-tab', display: `${modSymbol}${shiftSymbol}[`, description: 'Previous tab', category: 'tabs' },
    { id: 'tab-1', display: `${modSymbol}1`, description: 'Go to tab 1', category: 'tabs' },
    { id: 'tab-2', display: `${modSymbol}2`, description: 'Go to tab 2', category: 'tabs' },
    { id: 'tab-3', display: `${modSymbol}3`, description: 'Go to tab 3', category: 'tabs' },
    { id: 'tab-4', display: `${modSymbol}4`, description: 'Go to tab 4', category: 'tabs' },
    { id: 'tab-5', display: `${modSymbol}5`, description: 'Go to tab 5', category: 'tabs' },
    { id: 'tab-6', display: `${modSymbol}6`, description: 'Go to tab 6', category: 'tabs' },
    { id: 'tab-7', display: `${modSymbol}7`, description: 'Go to tab 7', category: 'tabs' },
    { id: 'tab-8', display: `${modSymbol}8`, description: 'Go to tab 8', category: 'tabs' },
    { id: 'tab-9', display: `${modSymbol}9`, description: 'Go to last tab', category: 'tabs' },

    // Editor
    { id: 'save', display: `${modSymbol}S`, description: 'Save current file', category: 'editor' },
  ];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;
      const key = e.key.toLowerCase();
      const a = actionsRef.current;

      // Cmd+Shift+P — Command palette
      if (meta && shift && key === 'p') {
        e.preventDefault();
        a.openPalette();
        return;
      }

      // Cmd+, — Settings
      if (meta && !shift && key === ',') {
        e.preventDefault();
        a.openSettings();
        return;
      }

      // Cmd+/ — Toggle help panel (only when Shift is NOT held)
      if (meta && !shift && key === '/') {
        e.preventDefault();
        a.toggleHelpPanel?.();
        return;
      }

      // Cmd+Shift+/ — Keyboard shortcuts help
      // On macOS, Cmd+Shift+/ produces key === '?' rather than '/',
      // so we check for both to cover all platforms.
      if (meta && shift && (key === '/' || key === '?')) {
        e.preventDefault();
        a.showShortcutsHelp();
        return;
      }

      // Cmd+W — Close active tab
      if (meta && !shift && key === 'w') {
        e.preventDefault();
        a.closeActiveTab();
        return;
      }

      // Cmd+S — Save active file
      if (meta && !shift && key === 's') {
        e.preventDefault();
        a.saveActiveFile();
        return;
      }

      // Cmd+Shift+C — Focus chat
      if (meta && shift && key === 'c') {
        e.preventDefault();
        a.focusChat();
        return;
      }

      // Cmd+Shift+T — Task manager
      if (meta && shift && key === 't') {
        e.preventDefault();
        a.openTaskManager?.();
        return;
      }

      // Cmd+Shift+] — Next tab
      if (meta && shift && key === ']') {
        e.preventDefault();
        a.nextTab();
        return;
      }

      // Cmd+Shift+[ — Previous tab
      if (meta && shift && key === '[') {
        e.preventDefault();
        a.prevTab();
        return;
      }

      // Cmd+1–9 — Switch to tab by index
      if (meta && !shift && key >= '1' && key <= '9') {
        e.preventDefault();
        const index = parseInt(key, 10) - 1; // 0-based
        a.switchToTabByIndex(index);
        return;
      }

      // Cmd/Ctrl+J — Toggle console log panel
      if (meta && !shift && key === 'j') {
        e.preventDefault();
        a.toggleConsole?.();
        return;
      }

      // Cmd/Ctrl + Backtick (`) — Toggle drop-down terminal
      if (key === '`' && meta && !shift && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        a.toggleTerminal?.();
        return;
      }

      // Escape — close terminal (handled by toggleTerminal which checks if open in App.tsx)
      // We don't prevent default for Escape since other things may need it
      if (key === 'escape' && !meta && !shift && !e.altKey) {
        // Only fire if the active element is inside xterm (terminal is focused)
        const target = e.target as HTMLElement;
        if (target.closest('.xterm')) {
          a.toggleTerminal?.();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true); // capture phase
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  return { shortcuts };
}
