import { useState, useEffect, useCallback } from 'react';
import { wsService } from '../services/wsService';
import type { FlexGridLayout, SurfaceLayoutConfig } from '../components/layout/FlexGrid';

export interface SurfaceComponent {
  id: string;
  name: string;
  sourceFile: string;
  props: Record<string, unknown>;
  order: number;
  updatedAt: string;
}

export interface SurfaceMeta {
  id: string;
  name: string;
  description: string;
  layout: SurfaceLayoutConfig;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
}

export interface SurfaceData extends SurfaceMeta {
  components: SurfaceComponent[];
}

export type { FlexGridLayout, SurfaceLayoutConfig };

export const useSurface = () => {
  const [surfaces, setSurfaces] = useState<SurfaceMeta[]>([]);
  /** Map of surface ID → loaded SurfaceData (supports multiple open surfaces) */
  const [loadedSurfaces, setLoadedSurfaces] = useState<Record<string, SurfaceData>>({});
  const [componentSources, setComponentSources] = useState<Record<string, string>>({});

  const loadSurface = useCallback((id: string) => {
    wsService.getSurface(id);
  }, []);

  const refreshSurfaces = useCallback(() => {
    wsService.getSurfaces();
  }, []);

  useEffect(() => {
    // Initial load
    refreshSurfaces();

    // When a new surface list arrives (e.g. on workspace change), replace surfaces
    // and clear any stale loaded surface data / component sources
    const unsubList = wsService.on('surface-list', (payload: unknown) => {
      const newSurfaces = payload as SurfaceMeta[];
      setSurfaces(newSurfaces);

      // Build a set of valid surface IDs for the new workspace
      const validIds = new Set(newSurfaces.map(s => s.id));

      // Purge any loaded surfaces that no longer exist in the new list
      setLoadedSurfaces(prev => {
        const next: Record<string, SurfaceData> = {};
        for (const [id, data] of Object.entries(prev)) {
          if (validIds.has(id)) {
            next[id] = data;
          }
        }
        // Only update if something changed
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    });

    // Also re-fetch surfaces whenever the workspace CWD changes
    // (status-update is sent by the server on set-cwd)
    const unsubStatusUpdate = wsService.on('status-update', () => {
      refreshSurfaces();
    });

    const unsubData = wsService.on('surface-data', (payload: unknown) => {
      const { surface, sources } = payload as { surface: SurfaceData; sources: Record<string, string> };
      setLoadedSurfaces(prev => ({ ...prev, [surface.id]: surface }));
      setComponentSources(prev => ({ ...prev, ...sources }));
    });

    const unsubCreated = wsService.on('surface-created', (payload: unknown) => {
      const meta = payload as SurfaceMeta;
      setSurfaces(prev => [...prev, meta]);
      // Also add to loadedSurfaces as an empty surface so the tab can render immediately
      setLoadedSurfaces(prev => ({
        ...prev,
        [meta.id]: { ...meta, components: [] }
      }));
    });

    const unsubUpdated = wsService.on('surface-updated', (payload: unknown) => {
      const { surfaceId, component, source, layout } = payload as {
        surfaceId: string;
        component: SurfaceComponent & { deleted?: boolean };
        source?: string;
        layout?: SurfaceLayoutConfig;
      };

      // Update surface list timestamp (and layout if provided)
      setSurfaces(prev => prev.map(s =>
        s.id === surfaceId
          ? { ...s, updatedAt: new Date().toISOString(), ...(layout ? { layout } : {}) }
          : s
      ));

      // Update the loaded surface data (whichever surface matches)
      setLoadedSurfaces(prev => {
        const current = prev[surfaceId];
        if (!current) return prev;

        const next = { ...current, updatedAt: new Date().toISOString() };

        // Apply updated layout (contains auto-placed component assignments)
        if (layout) {
          next.layout = layout;
        }

        if (component.deleted) {
          next.components = next.components.filter(c => c.name !== component.name);
        } else {
          const idx = next.components.findIndex(c => c.name === component.name);
          if (idx >= 0) {
            next.components = [...next.components];
            next.components[idx] = component;
          } else {
            next.components = [...next.components, component];
          }
          next.components.sort((a, b) => a.order - b.order);
        }
        return { ...prev, [surfaceId]: next };
      });

      // Update source if provided
      if (source && component.id) {
        setComponentSources(prev => ({ ...prev, [component.id]: source }));
      }
    });

    const unsubDeleted = wsService.on('surface-deleted', (payload: unknown) => {
      const { surfaceId } = payload as { surfaceId: string };
      setSurfaces(prev => prev.filter(s => s.id !== surfaceId));
      setLoadedSurfaces(prev => {
        const next = { ...prev };
        delete next[surfaceId];
        return next;
      });
    });

    const unsubRenamed = wsService.on('surface-renamed', (payload: unknown) => {
      const { surfaceId, name } = payload as { surfaceId: string; name: string };
      // Update meta list
      setSurfaces(prev => prev.map(s =>
        s.id === surfaceId ? { ...s, name, updatedAt: new Date().toISOString() } : s
      ));
      // Update loaded surface data if present
      setLoadedSurfaces(prev => {
        const current = prev[surfaceId];
        if (!current) return prev;
        return { ...prev, [surfaceId]: { ...current, name, updatedAt: new Date().toISOString() } };
      });
    });

    const unsubLayoutUpdated = wsService.on('surface-layout-updated', (payload: unknown) => {
      const { surfaceId, layout } = payload as { surfaceId: string; layout: SurfaceLayoutConfig };
      // Update in loaded surfaces
      setLoadedSurfaces(prev => {
        const current = prev[surfaceId];
        if (!current) return prev;
        return { ...prev, [surfaceId]: { ...current, layout, updatedAt: new Date().toISOString() } };
      });
      // Update meta list
      setSurfaces(prev => prev.map(s =>
        s.id === surfaceId ? { ...s, layout, updatedAt: new Date().toISOString() } : s
      ));
    });

    return () => {
      unsubList();
      unsubStatusUpdate();
      unsubData();
      unsubCreated();
      unsubUpdated();
      unsubDeleted();
      unsubRenamed();
      unsubLayoutUpdated();
    };
  }, [refreshSurfaces]);

  const createSurface = useCallback((name: string, description: string = '', layout: string = 'vertical') => {
    wsService.createSurface(name, description, layout);
  }, []);

  const updateSurface = useCallback((surfaceId: string, componentName: string, jsxSource: string, props: Record<string, unknown> = {}, order?: number) => {
    wsService.updateSurface(surfaceId, componentName, jsxSource, props, order);
  }, []);

  const deleteSurface = useCallback((surfaceId: string) => {
    wsService.deleteSurface(surfaceId);
  }, []);

  const pinSurface = useCallback((surfaceId: string) => {
    wsService.pinSurface(surfaceId);
  }, []);

  const renameSurface = useCallback((surfaceId: string, newName: string) => {
    wsService.renameSurface(surfaceId, newName);
  }, []);

  const duplicateSurface = useCallback((surfaceId: string, newName?: string) => {
    wsService.duplicateSurface(surfaceId, newName);
  }, []);

  const removeSurfaceComponent = useCallback((surfaceId: string, componentName: string) => {
    wsService.removeSurfaceComponent(surfaceId, componentName);
  }, []);

  const updateSurfaceLayout = useCallback((surfaceId: string, layout: SurfaceLayoutConfig) => {
    wsService.updateSurfaceLayout(surfaceId, layout);
  }, []);

  return {
    surfaces,
    pinnedSurfaces: surfaces.filter(s => s.pinned),
    loadedSurfaces,
    componentSources,
    loadSurface,
    refreshSurfaces,
    createSurface,
    updateSurface,
    deleteSurface,
    renameSurface,
    duplicateSurface,
    pinSurface,
    removeSurfaceComponent,
    updateSurfaceLayout
  };
};
