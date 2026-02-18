import { useRef, useCallback, useEffect, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

/** Obsidian-inspired xterm.js theme */
const GUAKE_THEME = {
  background: '#0a0a0a',
  foreground: '#d4d4d8',
  cursor: '#10b981',
  cursorAccent: '#0a0a0a',
  selectionBackground: '#27272a',
  selectionForeground: '#fafafa',
  selectionInactiveBackground: '#18181b',
  black: '#09090b',
  red: '#f43f5e',
  green: '#10b981',
  yellow: '#f59e0b',
  blue: '#6366f1',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#d4d4d8',
  brightBlack: '#52525b',
  brightRed: '#fb7185',
  brightGreen: '#34d399',
  brightYellow: '#fbbf24',
  brightBlue: '#818cf8',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#fafafa',
};

export interface UseGuakeTerminalOptions {
  /** Whether the terminal panel is currently visible */
  isVisible: boolean;
}

export interface UseGuakeTerminalReturn {
  /** Ref to attach to the container div for xterm mounting */
  terminalRef: React.RefObject<HTMLDivElement | null>;
  /** Whether the terminal WebSocket is connected */
  isConnected: boolean;
  /** Force a fit/resize of the terminal to its container */
  fit: () => void;
  /** Shell name from the server */
  shellName: string;
  /** Current working directory from the server */
  terminalCwd: string;
  /** Whether running in fallback mode (basic shell, no PTY) */
  isFallback: boolean;
}

export function useGuakeTerminal({ isVisible }: UseGuakeTerminalOptions): UseGuakeTerminalReturn {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [shellName, setShellName] = useState('');
  const [terminalCwd, setTerminalCwd] = useState('');
  const [isFallback, setIsFallback] = useState(false);
  const mountedRef = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectWsRef = useRef<() => void>(() => {});

  const fit = useCallback(() => {
    if (fitAddonRef.current && xtermRef.current) {
      try {
        fitAddonRef.current.fit();
      } catch {
        // container not visible yet
      }
    }
  }, []);

  // Build WebSocket URL for the terminal endpoint
  const getWsUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'localhost:3000'
        : window.location.host;
    return `${protocol}//${host}/ws/terminal`;
  }, []);

  // Connect the WebSocket to the PTY backend
  const connectWs = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= 1) return; // already open/connecting

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      const data = event.data;
      // Check if it's a JSON control message
      if (typeof data === 'string' && data.startsWith('{')) {
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'ready') {
            setShellName(parsed.shell || '');
            setTerminalCwd(parsed.cwd || '');
            setIsFallback(parsed.mode === 'fallback');
            return;
          }
          if (parsed.type === 'exit') {
            xtermRef.current?.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
            setIsConnected(false);
            return;
          }
          if (parsed.type === 'error') {
            xtermRef.current?.write(`\r\n\x1b[31m[Error: ${parsed.message}]\x1b[0m\r\n`);
            setIsConnected(false);
            return;
          }
        } catch {
          // Not JSON — treat as terminal output
        }
      }
      // Regular terminal output
      xtermRef.current?.write(data);
    };

    ws.onclose = () => {
      setIsConnected(false);
      // Auto-reconnect after 2s if still mounted
      if (mountedRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current) connectWsRef.current();
        }, 2000);
      }
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }, [getWsUrl]);

  // Keep the ref in sync so reconnect can call latest version
  useEffect(() => {
    connectWsRef.current = connectWs;
  }, [connectWs]);

  // Initialize xterm.js terminal instance (once)
  useEffect(() => {
    mountedRef.current = true;

    const term = new Terminal({
      theme: GUAKE_THEME,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'outline',
      scrollback: 10000,
      allowTransparency: true,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      drawBoldTextInBrightColors: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Forward keystrokes to WebSocket
    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(data);
      }
    });

    // Forward resize events to WebSocket
    term.onResize(({ cols, rows }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Mount xterm into the DOM container when visible
  useEffect(() => {
    if (isVisible && terminalRef.current && xtermRef.current) {
      const container = terminalRef.current;
      // Only open if not already mounted to this container
      if (!container.querySelector('.xterm')) {
        xtermRef.current.open(container);
      }
      // Fit after animation settles
      requestAnimationFrame(() => {
        setTimeout(() => {
          fit();
          xtermRef.current?.focus();
        }, 50);
      });
      // Connect WebSocket if not already
      connectWs();
    }
  }, [isVisible, fit, connectWs]);

  // Re-fit on window resize
  useEffect(() => {
    if (!isVisible) return;
    const handleResize = () => fit();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isVisible, fit]);

  return { terminalRef, isConnected, fit, shellName, terminalCwd, isFallback };
}
