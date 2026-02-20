import { useEffect, useRef, useCallback, useSyncExternalStore } from 'react';

/**
 * Surface lifecycle event bus.
 * Allows surface components to subscribe to focus/blur/mount/unmount events.
 * 
 * This is instantiated per-surface in SurfaceRenderer and injected into the
 * component sandbox as a global.
 */
export class SurfaceLifecycleEmitter {
  private _focused = false;
  private _listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();
  private _storeVersion = 0;
  private _storeListeners: Set<() => void> = new Set();

  get isFocused(): boolean {
    return this._focused;
  }

  /** Called by SurfaceRenderer when focus state changes */
  setFocused(focused: boolean) {
    if (this._focused === focused) return;
    this._focused = focused;
    this._storeVersion++;
    // Notify React subscriptions
    this._storeListeners.forEach(cb => cb());
    // Fire event callbacks
    if (focused) {
      this._emit('focus');
    } else {
      this._emit('blur');
    }
  }

  /** Subscribe to a lifecycle event */
  on(event: 'focus' | 'blur' | 'mount' | 'unmount', callback: () => void): () => void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(callback);
    return () => {
      this._listeners.get(event)?.delete(callback);
    };
  }

  /** For useSyncExternalStore */
  subscribe = (listener: () => void) => {
    this._storeListeners.add(listener);
    return () => { this._storeListeners.delete(listener); };
  };

  getSnapshot = () => this._storeVersion;

  private _emit(event: string) {
    const set = this._listeners.get(event);
    if (set) {
      set.forEach(cb => {
        try { cb(); } catch (e) { console.error(`[SurfaceLifecycle] Error in ${event} handler:`, e); }
      });
    }
  }

  /** Fire mount event */
  emitMount() { this._emit('mount'); }
  /** Fire unmount event */
  emitUnmount() { this._emit('unmount'); }
}

/**
 * React hook for surface components to observe lifecycle events.
 * Injected into the sandbox as `useSurfaceLifecycle`.
 * 
 * Usage inside surface components:
 * ```
 * const lifecycle = useSurfaceLifecycle();
 * // lifecycle.isFocused — boolean, reactive
 * // lifecycle.onFocus(cb) — returns cleanup fn
 * // lifecycle.onBlur(cb)  — returns cleanup fn
 * ```
 */
export function createUseSurfaceLifecycle(emitter: SurfaceLifecycleEmitter) {
  return function useSurfaceLifecycle() {
    // Use external store for reactive isFocused
    useSyncExternalStore(emitter.subscribe, emitter.getSnapshot);

    const isFocused = emitter.isFocused;

    const onFocus = useCallback((cb: () => void) => {
      return emitter.on('focus', cb);
    }, []);

    const onBlur = useCallback((cb: () => void) => {
      return emitter.on('blur', cb);
    }, []);

    const onMount = useCallback((cb: () => void) => {
      return emitter.on('mount', cb);
    }, []);

    const onUnmount = useCallback((cb: () => void) => {
      return emitter.on('unmount', cb);
    }, []);

    // Auto-register mount/unmount for the component's own lifecycle
    const mountedRef = useRef(false);
    useEffect(() => {
      if (!mountedRef.current) {
        mountedRef.current = true;
      }
      return () => {
        mountedRef.current = false;
      };
    }, []);

    return {
      isFocused,
      onFocus,
      onBlur,
      onMount,
      onUnmount,
    };
  };
}
