/* eslint-disable no-unused-expressions, @typescript-eslint/no-unused-expressions */
/**
 * Surface API — Runtime API available to surface sandbox components.
 * Exposes workspace file ops, agent interaction, state, and tool invocation.
 */
import { wsService } from '../../../services/wsService';

// ─── Handler definition type ───
export interface HandlerDefinition {
  name: string;
  description: string;
  type: 'query' | 'action';
  inputSchema?: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

// ─── Handler registry (shared across all components on this page) ───
const _handlerRegistry = new Map<string, HandlerDefinition>();

export const surfaceApi = {
  // ─── Messaging ───
  sendMessage: (type: string, payload: unknown) => {
    wsService.sendMessage(type, payload);
  },

  // ─── Agent Interaction ───
  callAgent: (prompt: string): Promise<string> => {
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const unsub = wsService.on('surface-agent-response', (payload: unknown) => {
        const p = payload as { requestId: string; response: string };
        if (p.requestId === id) { unsub(); resolve(p.response); }
      });
      wsService.sendMessage('surface-agent-request', { requestId: id, prompt });
    });
  },

  defineHandler: (definition: HandlerDefinition): void => {
    _handlerRegistry.set(definition.name, definition);
  },

  invoke: <T = unknown>(handlerName: string, args?: Record<string, unknown>, surfaceId?: string): Promise<T> => {
    const handler = _handlerRegistry.get(handlerName);
    if (!handler) return Promise.reject(new Error(`Handler "${handlerName}" not defined.`));

    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); reject(new Error(`Handler "${handlerName}" timed out`)); }, 60000);
      const unsub = wsService.on('surface-handler-result', (payload: unknown) => {
        const p = payload as { requestId: string; success: boolean; data: T; error: string | null };
        if (p.requestId === requestId) {
          clearTimeout(timeout); unsub();
          p.success ? resolve(p.data) : reject(new Error(p.error || 'Handler failed'));
        }
      });
      wsService.sendMessage('surface-handler-invoke', {
        requestId, surfaceId: surfaceId || '', handlerName, handlerDefinition: handler, args: args || {}
      });
    });
  },

  // ─── Persisted State ───
  getState: <T = unknown>(key: string, surfaceId?: string): Promise<T | undefined> => {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); resolve(undefined); }, 5000);
      const unsub = wsService.on('surface-state-data', (payload: unknown) => {
        const p = payload as { requestId: string; value: T | undefined };
        if (p.requestId === requestId) { clearTimeout(timeout); unsub(); resolve(p.value); }
      });
      wsService.sendMessage('surface-get-state', { requestId, surfaceId: surfaceId || '', key });
    });
  },

  setState: (key: string, value: unknown, surfaceId?: string): void => {
    wsService.sendMessage('surface-set-state', { surfaceId: surfaceId || '', key, value });
  },

  // ─── Workspace File Operations ───
  readFile: (path: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); reject(new Error('readFile timed out')); }, 15000);
      const unsub = wsService.on('surface-file-result', (payload: unknown) => {
        const p = payload as { requestId: string; success: boolean; content: string | null; error: string | null };
        if (p.requestId === requestId) {
          clearTimeout(timeout); unsub();
          p.success ? resolve(p.content!) : reject(new Error(p.error || 'Failed'));
        }
      });
      wsService.sendMessage('surface-read-file', { requestId, path });
    });
  },

  writeFile: (path: string, content: string): Promise<{ success: boolean; message: string }> => {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); reject(new Error('writeFile timed out')); }, 15000);
      const unsub = wsService.on('surface-file-write-result', (payload: unknown) => {
        const p = payload as { requestId: string; success: boolean; message: string; error: string | null };
        if (p.requestId === requestId) {
          clearTimeout(timeout); unsub();
          resolve({ success: p.success, message: p.message || p.error || '' });
        }
      });
      wsService.sendMessage('surface-write-file', { requestId, path, content });
    });
  },

  listFiles: (path?: string, recursive?: boolean): Promise<string[]> => {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); reject(new Error('listFiles timed out')); }, 10000);
      const unsub = wsService.on('surface-file-list-result', (payload: unknown) => {
        const p = payload as { requestId: string; success: boolean; files: string[]; error: string | null };
        if (p.requestId === requestId) {
          clearTimeout(timeout); unsub();
          p.success ? resolve(p.files) : reject(new Error(p.error || 'Failed'));
        }
      });
      wsService.sendMessage('surface-list-files', { requestId, path: path || '.', recursive: !!recursive });
    });
  },

  readManyFiles: (paths: string[]): Promise<{ summary: string; results: Array<{ path: string; content: string | null; error?: string; truncated: boolean }> }> => {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); reject(new Error('readManyFiles timed out')); }, 30000);
      const unsub = wsService.on('surface-read-many-result', (payload: unknown) => {
        const p = payload as { requestId: string; success: boolean; summary: string; results: Array<{ path: string; content: string | null; error?: string; truncated: boolean }>; error: string | null };
        if (p.requestId === requestId) {
          clearTimeout(timeout); unsub();
          p.success ? resolve({ summary: p.summary, results: p.results }) : reject(new Error(p.error || 'Failed'));
        }
      });
      wsService.sendMessage('surface-read-many-files', { requestId, paths });
    });
  },

  // ─── Workspace Config ───
  getConfig: <T = unknown>(key?: string): Promise<T> => {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); reject(new Error('getConfig timed out')); }, 5000);
      const unsub = wsService.on('surface-config-result', (payload: unknown) => {
        const p = payload as { requestId: string; success: boolean; config: T; error: string | null };
        if (p.requestId === requestId) {
          clearTimeout(timeout); unsub();
          p.success ? resolve(p.config) : reject(new Error(p.error || 'Failed'));
        }
      });
      wsService.sendMessage('surface-get-config', { requestId, key: key || null });
    });
  },

  // ─── Direct Tool Invocation ───
  callTool: <T = unknown>(toolName: string, args?: Record<string, unknown>): Promise<T> => {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); reject(new Error(`callTool(${toolName}) timed out`)); }, 30000);
      const unsub = wsService.on('surface-tool-result', (payload: unknown) => {
        const p = payload as { requestId: string; success: boolean; result: T; error: string | null };
        if (p.requestId === requestId) {
          clearTimeout(timeout); unsub();
          p.success ? resolve(p.result) : reject(new Error(p.error || 'Tool call failed'));
        }
      });
      wsService.sendMessage('surface-call-tool', { requestId, toolName, args: args || {} });
    });
  }
};
