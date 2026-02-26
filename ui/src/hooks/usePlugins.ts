import { useState, useEffect, useCallback, useRef } from 'react';
import { wsService } from '../services/wsService';

/**
 * Plugin info from the backend.
 */
export interface PluginInfo {
  name: string;
  status: 'discovered' | 'active' | 'error' | 'disabled';
  source: 'builtin' | 'global' | 'workspace' | 'npm';
  version: string;
  description: string;
  error: string | null;
  capabilities: Record<string, boolean>;
  ui: PluginUIRegistrations;
}

/**
 * Schema entry describing a single plugin setting field.
 */
export interface PluginSettingsSchemaEntry {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'password';
  description?: string;
  default: unknown;
  options?: (string | { value: string; label: string })[];
  min?: number;
  max?: number;
}

/**
 * A single plugin-registered UI tab.
 */
export interface PluginTab {
  id: string;
  label: string;
  icon?: string;
  component: string; // component filename relative to plugin dir
  pluginName: string;
}

/**
 * A single plugin-registered sidebar section.
 */
export interface PluginSidebarSection {
  id: string;
  label: string;
  component: string;
  pluginName: string;
}

/**
 * A single plugin-registered settings panel.
 */
export interface PluginSettingsPanel {
  id: string;
  label: string;
  component: string;
  pluginName: string;
}

/**
 * Aggregated UI registrations from all active plugins.
 */
export interface PluginUIManifest {
  tabs: PluginTab[];
  sidebarSections: PluginSidebarSection[];
  settingsPanels: PluginSettingsPanel[];
}

interface PluginUIRegistrations {
  tabs: PluginTab[];
  sidebarSections: PluginSidebarSection[];
  settingsPanels: PluginSettingsPanel[];
}

/**
 * React hook for managing plugins via WebSocket.
 * 
 * Provides:
 * - Plugin list with status
 * - UI manifest (tabs, sidebar sections, settings panels)
 * - Enable/disable/reload actions
 */
export function usePlugins() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [uiManifest, setUIManifest] = useState<PluginUIManifest>({
    tabs: [],
    sidebarSections: [],
    settingsPanels: [],
  });
  const [loading, setLoading] = useState(true);

  // Cached settings and schemas per plugin name
  const [pluginSettings, setPluginSettings] = useState<Record<string, Record<string, unknown>>>({});
  const [pluginSchemas, setPluginSchemas] = useState<Record<string, PluginSettingsSchemaEntry[]>>({});

  // Track active schema listeners to avoid duplicates; stores unsubscribe functions
  const schemaUnsubsRef = useRef<Map<string, () => void>>(new Map());

  // Track schema fetch timeouts so they can be cleared on unmount or re-invocation
  const schemaTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Listen for plugin events from the server
  useEffect(() => {
    const unsubList = wsService.on('plugin:list', (payload: unknown) => {
      const data = payload as { plugins: PluginInfo[] };
      setPlugins(data.plugins || []);
      setLoading(false);
    });

    const unsubManifest = wsService.on('plugin:ui-manifest', (payload: unknown) => {
      const manifest = payload as PluginUIManifest;
      setUIManifest(manifest || { tabs: [], sidebarSections: [], settingsPanels: [] });
    });

    // Listen for generic plugin settings responses
    const unsubSettings = wsService.on('plugin:settings', (payload: unknown) => {
      const data = payload as { name: string; settings: Record<string, unknown> };
      if (data.name && data.settings) {
        setPluginSettings(prev => ({ ...prev, [data.name]: data.settings }));
      }
    });

    // Request initial data
    wsService.sendMessage('plugin:list');
    wsService.sendMessage('plugin:get-ui-manifest');

    return () => {
      unsubList();
      unsubManifest();
      unsubSettings();
      schemaUnsubsRef.current.forEach(unsub => unsub());
      schemaUnsubsRef.current.clear();
      schemaTimeoutsRef.current.forEach(t => clearTimeout(t));
      schemaTimeoutsRef.current.clear();
    };
  }, []);

  const enablePlugin = useCallback((name: string) => {
    wsService.sendMessage('plugin:enable', { name });
  }, []);

  const disablePlugin = useCallback((name: string) => {
    wsService.sendMessage('plugin:disable', { name });
  }, []);

  const reloadPlugin = useCallback((name: string) => {
    wsService.sendMessage('plugin:reload', { name });
  }, []);

  /**
   * Fetch settings for a plugin via the generic plugin:get-settings handler.
   * Response arrives as plugin:settings event.
   */
  const fetchPluginSettings = useCallback((pluginName: string) => {
    wsService.sendMessage('plugin:get-settings', { name: pluginName });
  }, []);

  /**
   * Save settings for a plugin via the generic plugin:set-settings handler.
   */
  const savePluginSettings = useCallback((pluginName: string, settings: Record<string, unknown>) => {
    wsService.sendMessage('plugin:set-settings', { name: pluginName, settings });
  }, []);

  /**
   * Fetch the settings schema for a plugin.
   * Sends plugin-specific schema request (e.g. plugin:<name>:get-schema)
   * and listens for the plugin-specific response (e.g. plugin:<name>:settings-schema).
   */
  const fetchPluginSchema = useCallback((pluginName: string) => {
    const responseEvent = `plugin:${pluginName}:settings-schema`;

    // Only register the listener once per plugin
    if (!schemaUnsubsRef.current.has(pluginName)) {
      const unsub = wsService.on(responseEvent, (payload: unknown) => {
        const data = payload as { schema?: PluginSettingsSchemaEntry[]; defaults?: Record<string, unknown> };
        if (data.schema) {
          setPluginSchemas(prev => ({ ...prev, [pluginName]: data.schema as PluginSettingsSchemaEntry[] }));
        }
      });
      schemaUnsubsRef.current.set(pluginName, unsub);
    }

    // Send the schema request
    wsService.sendMessage(`plugin:${pluginName}:get-schema`);

    // Clear any existing timeout for this plugin before setting a new one
    if (schemaTimeoutsRef.current.has(pluginName)) {
      clearTimeout(schemaTimeoutsRef.current.get(pluginName)!);
    }

    // Timeout: if no schema arrives within 5s, set empty schema so UI doesn't hang
    const timerId = setTimeout(() => {
      schemaTimeoutsRef.current.delete(pluginName);
      setPluginSchemas(prev => {
        // Only set empty if we still don't have a schema for this plugin
        if (prev[pluginName] === undefined) {
          return { ...prev, [pluginName]: [] };
        }
        return prev;
      });
    }, 5000);
    schemaTimeoutsRef.current.set(pluginName, timerId);
  }, []);

  const getComponentSource = useCallback((pluginName: string, componentFile: string) => {
    wsService.sendMessage('plugin:get-component', { pluginName, componentFile });
  }, []);

  return {
    plugins,
    uiManifest,
    loading,
    pluginSettings,
    pluginSchemas,
    enablePlugin,
    disablePlugin,
    reloadPlugin,
    fetchPluginSettings,
    savePluginSettings,
    fetchPluginSchema,
    getComponentSource,
  };
}
