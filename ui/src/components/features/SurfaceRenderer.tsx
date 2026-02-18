import React, { useMemo, Suspense, useState, useCallback } from 'react';
import { transform } from 'sucrase';
import { Loader2, RefreshCw, AlertTriangle, Pin, Trash2, LayoutGrid } from 'lucide-react';
import type { SurfaceData, SurfaceComponent } from '../../hooks/useSurface';
import { wsService } from '../../services/wsService';
import { FlexGridContainer } from '../layout/FlexGrid';
import type { FlexGridLayout } from '../layout/FlexGrid';
import { WorkflowStatusBar } from './WorkflowStatusBar';
import type { Workflow, WorkflowInteraction } from '../../hooks/useWorkflow';
import { UI } from '../../surface-kit';

interface SurfaceRendererProps {
  surfaceId: string;
  data: SurfaceData | null;
  sources: Record<string, string>;
  onRefresh: () => void;
  onPinToggle?: (id: string) => void;
  onDelete?: (id: string) => void;
  workflows?: Workflow[];
  interactions?: WorkflowInteraction[];
  onSubmitInteraction?: (workflowId: string, interactionId: string, data: Record<string, unknown>) => void;
  onCancelWorkflow?: (workflowId: string) => void;
}

// ─── Handler definition type ───
interface HandlerDefinition {
  name: string;
  description: string;
  type: 'query' | 'action';
  inputSchema?: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

// ─── Handler registry (shared across all components on this page) ───
const _handlerRegistry = new Map<string, HandlerDefinition>();

// Sandbox API for components
const surfaceApi = {
  /** Send a raw WebSocket message */
  sendMessage: (type: string, payload: unknown) => {
    wsService.sendMessage(type, payload);
  },

  /** Legacy: send a free-text prompt to the agent (unstructured response) */
  callAgent: (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      const unsub = wsService.on('surface-agent-response', (payload: unknown) => {
        const p = payload as { requestId: string; response: string };
        if (p.requestId === id) {
          unsub();
          resolve(p.response);
        }
      });
      wsService.sendMessage('surface-agent-request', { requestId: id, prompt });
    });
  },

  /**
   * Define a named handler with typed input/output schemas.
   * The AI will be instructed to return JSON matching the outputSchema.
   */
  defineHandler: (definition: HandlerDefinition): void => {
    _handlerRegistry.set(definition.name, definition);
  },

  /**
   * Invoke a previously defined handler (or provide an inline definition).
   * Returns a Promise that resolves with the parsed JSON matching the handler's outputSchema.
   */
  invoke: <T = unknown>(handlerName: string, args?: Record<string, unknown>, surfaceId?: string): Promise<T> => {
    const handler = _handlerRegistry.get(handlerName);
    if (!handler) {
      return Promise.reject(new Error(`Handler "${handlerName}" not defined. Call surfaceApi.defineHandler() first.`));
    }

    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        unsub();
        reject(new Error(`Handler "${handlerName}" timed out after 60s`));
      }, 60000);

      const unsub = wsService.on('surface-handler-result', (payload: unknown) => {
        const p = payload as { requestId: string; success: boolean; data: T; error: string | null };
        if (p.requestId === requestId) {
          clearTimeout(timeout);
          unsub();
          if (p.success) {
            resolve(p.data);
          } else {
            reject(new Error(p.error || 'Handler invocation failed'));
          }
        }
      });

      wsService.sendMessage('surface-handler-invoke', {
        requestId,
        surfaceId: surfaceId || '',
        handlerName,
        handlerDefinition: handler,
        args: args || {}
      });
    });
  },

  /**
   * Get persisted state for this surface.
   */
  getState: <T = unknown>(key: string, surfaceId?: string): Promise<T | undefined> => {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { unsub(); resolve(undefined); }, 5000);
      const unsub = wsService.on('surface-state-data', (payload: unknown) => {
        const p = payload as { requestId: string; value: T | undefined };
        if (p.requestId === requestId) {
          clearTimeout(timeout);
          unsub();
          resolve(p.value);
        }
      });
      wsService.sendMessage('surface-get-state', { requestId, surfaceId: surfaceId || '', key });
    });
  },

  /**
   * Set persisted state for this surface.
   */
  setState: (key: string, value: unknown, surfaceId?: string): void => {
    wsService.sendMessage('surface-set-state', { surfaceId: surfaceId || '', key, value });
  }
};

const compileComponent = (source: string, componentName: string): React.ComponentType<unknown> | null => {
  try {
    const { code } = transform(source, {
      transforms: ['jsx', 'typescript'],
      production: true,
    });

    // Create module scope
    const moduleFactory = new Function(
      'React', 'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo',
      'surfaceApi', 'UI', 'exports',
      code
    );

    const exports: { default?: React.ComponentType<unknown> } = {};
    
    moduleFactory(
      React, useState, React.useEffect, React.useRef, React.useCallback, useMemo,
      surfaceApi, UI, exports
    );

    return exports.default || null;
  } catch (err) {
    console.error(`Failed to compile component ${componentName}:`, err);
    throw err;
  }
};

const ComponentWrapper: React.FC<{ 
  component: SurfaceComponent; 
  source: string;
}> = ({ component, source }) => {
  const { Component, error } = useMemo(() => {
    if (!source) return { Component: null, error: null };
    try {
      const Comp = compileComponent(source, component.name);
      return { Component: Comp, error: null };
    } catch (err: unknown) {
      return { Component: null, error: (err as Error).message };
    }
  }, [source, component.name]);

  if (error) {
    return (
      <div className="p-4 mb-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm font-mono whitespace-pre-wrap">
        <div className="flex items-center gap-2 mb-2 font-bold">
          <AlertTriangle size={14} />
          Compilation Error: {component.name}
        </div>
        {error}
      </div>
    );
  }

  if (!Component) {
    return (
      <div className="p-8 flex justify-center text-zinc-600">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="surface-component-scope flex-1 min-h-0 w-full min-w-0">
      <Suspense fallback={<div className="h-20 animate-pulse bg-zinc-800/20 rounded-xl w-full" />}>
        <Component {...component.props} />
      </Suspense>
    </div>
  );
};

/** Check if layout is a FlexGridLayout object */
function isFlexGridLayout(layout: unknown): layout is FlexGridLayout {
  return typeof layout === 'object' && layout !== null && (layout as FlexGridLayout).type === 'flex-grid';
}

export const SurfaceRenderer: React.FC<SurfaceRendererProps> = ({ 
  surfaceId,
  data, 
  sources,
  onRefresh,
  onPinToggle,
  onDelete,
  workflows = [],
  interactions = [],
  onSubmitInteraction,
  onCancelWorkflow,
}) => {
  const useFlexGrid = isFlexGridLayout(data?.layout);

  /** Build a component map for quick lookup by name */
  const componentMap = useMemo(() => {
    const map: Record<string, SurfaceComponent> = {};
    if (data) {
      for (const comp of data.components) {
        map[comp.name] = comp;
      }
    }
    return map;
  }, [data]);

  /** Render components by name array — used by FlexGridContainer */
  const renderComponentsByName = useCallback((names: string[]) => {
    return names.map(name => {
      const comp = componentMap[name];
      if (!comp) {
        return (
          <div key={name} className="p-3 text-xs text-zinc-600 border border-dashed border-zinc-800 rounded-lg text-center">
            Component &quot;{name}&quot; not found
          </div>
        );
      }
      return (
        <ComponentWrapper
          key={comp.id}
          component={comp}
          source={sources[comp.id]}
        />
      );
    });
  }, [componentMap, sources]);

  /** 
   * For flex-grid layout: collect component names that are NOT placed in any cell.
   * These "unplaced" components are rendered in a fallback area.
   */
  const unplacedComponents = useMemo(() => {
    if (!data) return [];
    if (!useFlexGrid) return data.components;
    
    const layout = data.layout as FlexGridLayout;
    const placedNames = new Set<string>();
    for (const row of layout.rows) {
      for (const cell of row.cells) {
        for (const name of cell.components) {
          placedNames.add(name);
        }
      }
    }
    return data.components.filter(c => !placedNames.has(c.name));
  }, [data, useFlexGrid]);

  /** Layout indicator label */
  const layoutLabel = useMemo(() => {
    if (useFlexGrid) return 'flex-grid';
    if (data) return data.layout as string;
    return 'loading';
  }, [data, useFlexGrid]);

  const handleDelete = useCallback(() => {
    if (!data) return;
    if (confirm(`Are you sure you want to delete "${data.name}"?`)) {
      wsService.sendMessage('delete_surface', { surface_id: surfaceId });
      if (onDelete) onDelete(surfaceId);
    }
  }, [data, surfaceId, onDelete]);

  // Loading state
  if (!data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-3">
        <Loader2 size={24} className="animate-spin" />
        <p className="text-xs uppercase tracking-widest">Loading Surface...</p>
      </div>
    );
  }

  return (
    <div id={`surface-${surfaceId}`} className="flex-1 flex flex-col bg-[#080808] min-h-0 overflow-hidden text-zinc-200 w-full min-w-0">
      {/* Toolbar */}
      <div className="h-9 border-b border-zinc-800/60 flex items-center justify-between px-3 bg-[#0c0c0c] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-[12px] font-bold text-zinc-200 truncate">{data.name}</h2>
          {data.description && <span className="text-[10px] text-zinc-600 truncate hidden md:inline">— {data.description}</span>}
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800/60 text-zinc-500 font-mono uppercase tracking-wider flex items-center gap-1">
            <LayoutGrid size={9} />
            {layoutLabel}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => onPinToggle?.(surfaceId)}
            className={`p-1.5 rounded transition-colors ${data.pinned ? 'bg-indigo-500/20 text-indigo-400' : 'hover:bg-zinc-800 text-zinc-600'}`}
            title={data.pinned ? "Unpin surface" : "Pin surface"}
          >
            <Pin size={12} />
          </button>
          <button
            onClick={onRefresh}
            className="p-1.5 hover:bg-zinc-800 text-zinc-600 rounded transition-colors"
            title="Refresh surface"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={handleDelete}
            className="p-1.5 hover:bg-red-500/20 text-zinc-600 hover:text-red-400 rounded transition-colors"
            title="Delete surface"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Workflow Status Bar */}
      {(workflows.length > 0 || interactions.length > 0) && (
        <WorkflowStatusBar
          workflows={workflows}
          interactions={interactions}
          onSubmitInteraction={onSubmitInteraction || (() => {})}
          onCancelWorkflow={onCancelWorkflow || (() => {})}
        />
      )}

      {/* Content Area */}
      {useFlexGrid ? (
        /* ─── Flex-Grid Layout ─── */
        <div className="flex-1 flex flex-col min-h-0 w-full min-w-0">
          <FlexGridContainer
            layout={data.layout as FlexGridLayout}
            renderComponents={renderComponentsByName}
            className="flex-1"
          />

          {/* Unplaced components fallback */}
          {unplacedComponents.length > 0 && (
            <div className="border-t border-zinc-800/40 p-4 flex flex-col gap-4 overflow-y-auto max-h-[200px]">
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest">Unplaced Components</div>
              {unplacedComponents.map(comp => (
                <ComponentWrapper 
                  key={comp.id} 
                  component={comp} 
                  source={sources[comp.id]} 
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ─── Legacy Layout (vertical/horizontal/grid) ─── */
        <div className={`flex-1 overflow-y-auto p-4 w-full min-w-0 ${
          data.layout === 'grid' ? 'grid grid-cols-1 gap-6' :
          data.layout === 'horizontal' ? 'flex flex-row gap-6 overflow-x-auto' :
          'flex flex-col gap-6'
        }`}>
          {data.components.length === 0 ? (
            <div className="col-span-full" />
          ) : (
            data.components.map(comp => (
              <ComponentWrapper 
                key={comp.id} 
                component={comp} 
                source={sources[comp.id]} 
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};
