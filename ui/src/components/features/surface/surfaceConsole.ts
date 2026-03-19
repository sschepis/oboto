/**
 * surfaceConsole — Creates a `console`-like proxy for surface components.
 *
 * When a surface component calls `console.log(...)`, the proxy:
 *   1. Forwards the call to the real `console` so DevTools still work.
 *   2. Serialises the arguments and sends them to the server via WebSocket
 *      so the agent can see client-side logs through `read_surface`.
 *
 * A ring buffer (default 100 entries) is kept on the client side as well,
 * and flushed to the server in debounced batches to avoid spamming.
 *
 * @module ui/src/components/features/surface/surfaceConsole
 */

import { wsService } from '../../../services/wsService';

/** Maximum entries buffered before oldest are dropped. */
const MAX_BUFFER = 100;

/** Debounce interval (ms) for flushing to server. */
const FLUSH_INTERVAL_MS = 500;

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  args: string[];
  timestamp: number;
}

/**
 * Safely serialise a single argument for transport.
 * Handles primitives, objects (with depth/circular protection), Errors, etc.
 */
function serialiseArg(arg: unknown, depth = 0): string {
  if (depth > 3) return '[…]';
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (typeof arg === 'function') return `[Function: ${arg.name || 'anonymous'}]`;
  if (Array.isArray(arg)) {
    if (arg.length > 20) return `[Array(${arg.length})]`;
    return '[' + arg.map(a => serialiseArg(a, depth + 1)).join(', ') + ']';
  }
  if (typeof arg === 'object') {
    try {
      const str = JSON.stringify(arg, null, 0);
      // Truncate very large objects
      return str.length > 500 ? str.slice(0, 500) + '…' : str;
    } catch {
      return '[Object]';
    }
  }
  return String(arg);
}

/**
 * Create a console proxy scoped to a specific surface + component.
 *
 * @param surfaceId The surface this component belongs to
 * @param componentName The component that generated the log
 * @returns A `console`-compatible object
 */
export function createSurfaceConsole(
  surfaceId: string,
  componentName: string,
): Console & { _flush: () => void; _buffer: ConsoleEntry[] } {
  const buffer: ConsoleEntry[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** Flush buffered entries to server via WebSocket. */
  function flush() {
    if (buffer.length === 0) return;
    // Drain the buffer
    const entries = buffer.splice(0, buffer.length);
    try {
      wsService.sendMessage('surface-console-log', {
        surfaceId,
        componentName,
        entries,
      });
    } catch {
      // WebSocket not available — logs are still in DevTools
    }
  }

  /** Schedule a debounced flush. */
  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, FLUSH_INTERVAL_MS);
  }

  /** Capture a log call. */
  function capture(level: ConsoleEntry['level'], args: unknown[]) {
    const entry: ConsoleEntry = {
      level,
      args: args.map(a => serialiseArg(a)),
      timestamp: Date.now(),
    };
    buffer.push(entry);
    // Enforce ring buffer limit
    while (buffer.length > MAX_BUFFER) buffer.shift();
    scheduleFlush();
  }

  // Build the proxy — forward to real console AND capture
  const proxy = {
    log: (...args: unknown[]) => { console.log(`[Surface:${componentName}]`, ...args); capture('log', args); },
    info: (...args: unknown[]) => { console.info(`[Surface:${componentName}]`, ...args); capture('info', args); },
    warn: (...args: unknown[]) => { console.warn(`[Surface:${componentName}]`, ...args); capture('warn', args); },
    error: (...args: unknown[]) => { console.error(`[Surface:${componentName}]`, ...args); capture('error', args); },
    debug: (...args: unknown[]) => { console.debug(`[Surface:${componentName}]`, ...args); capture('debug', args); },
    // Stubs for less-common console methods (prevent crashes)
    trace: (...args: unknown[]) => { console.trace(`[Surface:${componentName}]`, ...args); capture('debug', args); },
    table: (...args: unknown[]) => { console.table(...args); capture('log', ['[table]', ...args]); },
    dir: (...args: unknown[]) => { console.dir(...args); capture('log', args); },
    group: (...args: unknown[]) => { console.group(...args); },
    groupEnd: () => { console.groupEnd(); },
    groupCollapsed: (...args: unknown[]) => { console.groupCollapsed(...args); },
    time: (label?: string) => { console.time(label); },
    timeEnd: (label?: string) => { console.timeEnd(label); },
    timeLog: (label?: string, ...args: unknown[]) => { console.timeLog(label, ...args); },
    clear: () => { console.clear(); },
    count: (label?: string) => { console.count(label); },
    countReset: (label?: string) => { console.countReset(label); },
    assert: (condition?: boolean, ...args: unknown[]) => {
      console.assert(condition, ...args);
      if (!condition) capture('error', ['Assertion failed:', ...args]);
    },
    // Internal helpers
    _flush: flush,
    _buffer: buffer,
  };

  return proxy as Console & { _flush: () => void; _buffer: ConsoleEntry[] };
}
