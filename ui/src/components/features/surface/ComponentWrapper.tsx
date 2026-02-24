/**
 * ComponentWrapper — Compiles and renders a single surface component.
 * Handles compilation errors with a manual "Fix…" button, wraps in ErrorBoundary for runtime errors.
 */
import React, { useMemo, useState, useCallback, useEffect, useRef, Suspense } from 'react';
import { Loader2, AlertTriangle, Wrench } from 'lucide-react';
import type { SurfaceComponent } from '../../../hooks/useSurface';
import { wsService } from '../../../services/wsService';
import { compileComponent } from './surfaceCompiler';
import { SurfaceErrorBoundary } from './SurfaceErrorBoundary';

const MAX_COMP_FIX_ATTEMPTS = 3;
const FIX_TIMEOUT_MS = 30_000; // Fallback timeout if server never responds

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

  // Key fix state on source so it resets automatically when new code arrives.
  const [fixState, setFixState] = useState<{ source: string; attempts: number; fixing: boolean }>({
    source, attempts: 0, fixing: false
  });

  // Derive current values, resetting when source changes.
  // Safety invariant: when source changes, derived values fall back to 0/false here;
  // the setter callbacks below always stamp the current `source` into state, so any
  // update (e.g. from a WebSocket event) will re-sync the key automatically.
  const fixAttempts = fixState.source === source ? fixState.attempts : 0;
  const fixing = fixState.source === source ? fixState.fixing : false;

  const setFixAttempts = useCallback((n: number) => setFixState(s => ({ ...s, source, attempts: n })), [source]);
  const setFixing = useCallback((v: boolean) => setFixState(s => ({ ...s, source, fixing: v })), [source]);

  // Listen for surface-updated to clear the fixing spinner
  useEffect(() => {
    const unsub = wsService.on('surface-updated', (payload: unknown) => {
      const p = payload as { surfaceId: string; component?: { name: string; deleted?: boolean } };
      if (p.surfaceId === surfaceId && p.component?.name === component.name && !p.component?.deleted) {
        setFixing(false);
      }
    });
    return unsub;
  }, [surfaceId, component.name, setFixing]);

  // Listen for auto-fix failure
  useEffect(() => {
    const unsub = wsService.on('surface-auto-fix-failed', (payload: unknown) => {
      const p = payload as { surfaceId: string; componentName: string };
      if (p.surfaceId === surfaceId && p.componentName === component.name) {
        setFixing(false);
      }
    });
    return unsub;
  }, [surfaceId, component.name, setFixing]);

  // Timeout ref so we can clear it on unmount or when fix completes
  const fixTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timeout when fixing becomes false (success or failure event received)
  useEffect(() => {
    if (!fixing && fixTimeoutRef.current) {
      clearTimeout(fixTimeoutRef.current);
      fixTimeoutRef.current = null;
    }
  }, [fixing]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => { if (fixTimeoutRef.current) clearTimeout(fixTimeoutRef.current); };
  }, []);

  const handleFix = () => {
    const attempt = fixAttempts + 1;
    setFixAttempts(attempt);
    setFixing(true);
    // Clear any lingering timeout first (defensive)
    if (fixTimeoutRef.current) clearTimeout(fixTimeoutRef.current);
    // Fallback: if server never responds, stop the spinner after FIX_TIMEOUT_MS
    fixTimeoutRef.current = setTimeout(() => setFixing(false), FIX_TIMEOUT_MS);
    wsService.sendMessage('surface-auto-fix', {
      surfaceId,
      componentName: component.name,
      errorType: 'compilation',
      error,
      source,
      attempt
    });
  };

  if (error) {
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
              Fixing (attempt {fixAttempts}/{MAX_COMP_FIX_ATTEMPTS})…
            </div>
          )}
        </div>
        <div className="text-red-400/80 text-xs max-h-[120px] overflow-y-auto">{error}</div>
        {!fixing && (
          <button
            onClick={handleFix}
            disabled={fixAttempts >= MAX_COMP_FIX_ATTEMPTS}
            className="mt-2 px-3 py-1 text-xs bg-amber-500/20 text-amber-400 rounded hover:bg-amber-500/30 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Wrench size={12} />
            {fixAttempts >= MAX_COMP_FIX_ATTEMPTS ? 'Max fix attempts reached' : 'Fix…'}
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
