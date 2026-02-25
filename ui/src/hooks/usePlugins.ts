import { useState, useEffect, useCallback } from 'react';
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

    // Request initial data
    wsService.sendMessage('plugin:list');
    wsService.sendMessage('plugin:get-ui-manifest');

    return () => {
      unsubList();
      unsubManifest();
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

  const getPluginSettings = useCallback((name: string) => {
    wsService.sendMessage('plugin:get-settings', { name });
  }, []);

  const setPluginSettings = useCallback((name: string, settings: Record<string, unknown>) => {
    wsService.sendMessage('plugin:set-settings', { name, settings });
  }, []);

  const getComponentSource = useCallback((pluginName: string, componentFile: string) => {
    wsService.sendMessage('plugin:get-component', { pluginName, componentFile });
  }, []);

  return {
    plugins,
    uiManifest,
    loading,
    enablePlugin,
    disablePlugin,
    reloadPlugin,
    getPluginSettings,
    setPluginSettings,
    getComponentSource,
  };
}
