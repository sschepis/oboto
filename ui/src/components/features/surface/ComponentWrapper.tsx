/**
 * ComponentWrapper — Compiles and renders a single surface component.
 * Handles compilation errors with auto-fix, wraps in ErrorBoundary for runtime errors.
 */
import React, { useMemo, useEffect, Suspense } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import type { SurfaceComponent } from '../../../hooks/useSurface';
import { wsService } from '../../../services/wsService';
import { compileComponent } from './surfaceCompiler';
import { SurfaceErrorBoundary } from './SurfaceErrorBoundary';

const MAX_COMP_FIX_ATTEMPTS = 3;

/** Module-level tracker to deduplicate auto-fix requests across renders */
const _compFixTracker = new Map<string, { attempts: number; lastError: string }>();

export const ComponentWrapper: React.FC<{
  component: SurfaceComponent;
  source: string;
  surfaceId: string;
  useSurfaceLifecycle?: () => unknown;
}> = ({ component, source, surfaceId, useSurfaceLifecycle }) => {
  const { Component, error } = useMemo(() => {
    if (!source) return { Component: null, error: null };
    try {
      const Comp = compileComponent(source, component.name, useSurfaceLifecycle);
      return { Component: Comp, error: null };
    } catch (err: unknown) {
      return { Component: null, error: (err as Error).message };
    }
  }, [source, component.name, useSurfaceLifecycle]);

  const fixTrackerKey = `${surfaceId}:${component.name}`;

  // Send compilation errors to server for auto-fix
  useEffect(() => {
    if (!error) return;
    const tracker = _compFixTracker.get(fixTrackerKey);
    if (tracker?.lastError === error || (tracker?.attempts ?? 0) >= MAX_COMP_FIX_ATTEMPTS) return;

    const newAttempts = (tracker?.attempts ?? 0) + 1;
    _compFixTracker.set(fixTrackerKey, { attempts: newAttempts, lastError: error });
    wsService.sendMessage('surface-auto-fix', {
      surfaceId,
      componentName: component.name,
      errorType: 'compilation',
      error,
      source,
      attempt: newAttempts
    });
  }, [error, component.name, surfaceId, source, fixTrackerKey]);

  // Reset tracker when source changes (new code arrived)
  useEffect(() => {
    _compFixTracker.delete(fixTrackerKey);
  }, [source, fixTrackerKey]);

  if (error) {
    const tracker = _compFixTracker.get(fixTrackerKey);
    const attempts = tracker?.attempts ?? 0;
    const fixing = attempts > 0 && attempts < MAX_COMP_FIX_ATTEMPTS;

    return (
      <div className="p-4 mb-4 bg-red-500/10 border border-red-500/30 rounded-lg text-sm font-mono whitespace-pre-wrap">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 font-bold text-red-400">
            <AlertTriangle size={14} />
            Compilation Error: {component.name}
          </div>
          {fixing && (
            <div className="flex items-center gap-1.5 text-amber-400 text-xs">
              <Loader2 size={12} className="animate-spin" />
              Auto-fixing (attempt {attempts}/{MAX_COMP_FIX_ATTEMPTS})...
            </div>
          )}
        </div>
        <div className="text-red-400/80 text-xs max-h-[120px] overflow-y-auto">{error}</div>
        {!fixing && attempts >= MAX_COMP_FIX_ATTEMPTS && (
          <button
            onClick={() => {
              _compFixTracker.delete(fixTrackerKey);
              wsService.sendMessage('surface-auto-fix', {
                surfaceId,
                componentName: component.name,
                errorType: 'compilation',
                error,
                source,
                attempt: 1
              });
              _compFixTracker.set(fixTrackerKey, { attempts: 1, lastError: error });
            }}
            className="mt-2 px-3 py-1 text-xs bg-amber-500/20 text-amber-400 rounded hover:bg-amber-500/30 transition-colors"
          >
            Retry Auto-Fix
          </button>
        )}
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
    <SurfaceErrorBoundary surfaceId={surfaceId} componentName={component.name} source={source}>
      <div className="surface-component-scope flex-1 min-h-0 w-full min-w-0">
        <Suspense fallback={<div className="h-20 animate-pulse bg-zinc-800/20 rounded-xl w-full" />}>
          <Component {...component.props} />
        </Suspense>
      </div>
    </SurfaceErrorBoundary>
  );
};
