import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Save, Loader2, AlertCircle, CheckCircle2, Package } from 'lucide-react';
import type { PluginInfo, PluginSettingsSchemaEntry } from '../../../hooks/usePlugins';
import { PropertyGrid, type PropertyItem } from './PropertyGrid';
import { wsService } from '../../../services/wsService';

interface PluginSettingsTabProps {
  plugins: PluginInfo[];
  pluginSettings: Record<string, Record<string, unknown>>;
  pluginSchemas: Record<string, PluginSettingsSchemaEntry[]>;
  fetchPluginSettings: (pluginName: string) => void;
  savePluginSettings: (pluginName: string, settings: Record<string, unknown>) => void;
  fetchPluginSchema: (pluginName: string) => void;
  loading: boolean;
}

/** Sort plugins: active first, then discovered, then disabled, then error */
function sortPlugins(plugins: PluginInfo[]): PluginInfo[] {
  const order: Record<string, number> = { active: 0, discovered: 1, disabled: 2, error: 3 };
  return [...plugins].sort((a, b) => (order[a.status] ?? 4) - (order[b.status] ?? 4));
}

/** Status badge color map */
function statusColor(status: string): string {
  switch (status) {
    case 'active': return 'bg-emerald-500';
    case 'discovered': return 'bg-blue-500';
    case 'disabled': return 'bg-zinc-600';
    case 'error': return 'bg-red-500';
    default: return 'bg-zinc-600';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'active': return 'Active';
    case 'discovered': return 'Discovered';
    case 'disabled': return 'Disabled';
    case 'error': return 'Error';
    default: return status;
  }
}

const PluginSettingsTab: React.FC<PluginSettingsTabProps> = ({
  plugins,
  pluginSettings,
  pluginSchemas,
  fetchPluginSettings,
  savePluginSettings,
  fetchPluginSchema,
  loading,
}) => {
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);
  const [localSettings, setLocalSettings] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [dirty, setDirty] = useState(false);
  const fetchedRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sorted = useMemo(() => sortPlugins(plugins), [plugins]);

  // Auto-select first active plugin if nothing selected
  const effectiveSelected = useMemo(() => {
    if (selectedPlugin) return selectedPlugin;
    if (sorted.length === 0) return null;
    const firstActive = sorted.find(p => p.status === 'active');
    return firstActive?.name ?? sorted[0].name;
  }, [selectedPlugin, sorted]);

  // Ensure we fetch settings/schema for the effectively selected plugin
  useEffect(() => {
    if (effectiveSelected && !fetchedRef.current.has(effectiveSelected)) {
      fetchedRef.current.add(effectiveSelected);
      fetchPluginSettings(effectiveSelected);
      fetchPluginSchema(effectiveSelected);
    }
  }, [effectiveSelected, fetchPluginSettings, fetchPluginSchema]);

  // Derive current settings from server data merged with local overrides
  const serverSettings = effectiveSelected ? pluginSettings[effectiveSelected] : undefined;
  const currentSettings = dirty ? localSettings : (serverSettings ?? {});

  // Listen for server confirmation of save
  useEffect(() => {
    const unsub = wsService.on('plugin:settings-saved', (payload: unknown) => {
      const data = payload as { name: string; success: boolean };
      if (data.name === effectiveSelected && data.success) {
        setSaving(false);
        setSaveSuccess(true);
        setDirty(false);
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => setSaveSuccess(false), 2000);
        // Re-fetch persisted values from server
        if (effectiveSelected) {
          fetchPluginSettings(effectiveSelected);
        }
      }
    });
    return () => {
      unsub();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [effectiveSelected, fetchPluginSettings]);

  // Clean up save-success timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleSelectPlugin = useCallback((name: string) => {
    setSelectedPlugin(name);
    setDirty(false);
    setSaveSuccess(false);
    setSaving(false);
    if (!fetchedRef.current.has(name)) {
      fetchedRef.current.add(name);
      fetchPluginSettings(name);
      fetchPluginSchema(name);
    }
  }, [fetchPluginSettings, fetchPluginSchema]);

  const handleChange = useCallback((key: string, value: string | number | boolean) => {
    setLocalSettings(prev => {
      const base = dirty ? prev : (serverSettings ?? {});
      return { ...base, [key]: value };
    });
    setDirty(true);
    setSaveSuccess(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, serverSettings]);

  const handleSave = useCallback(() => {
    if (!effectiveSelected) return;
    setSaving(true);
    savePluginSettings(effectiveSelected, localSettings);
    // Timeout: reset saving state if server never responds within 10s
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setSaving(false);
    }, 10000);
  }, [effectiveSelected, localSettings, savePluginSettings]);

  const selectedPluginInfo = plugins.find(p => p.name === effectiveSelected);
  const schema = effectiveSelected ? pluginSchemas[effectiveSelected] : undefined;

  // Build PropertyGrid items from schema + current values
  const propertyItems: PropertyItem[] = (schema || []).map(entry => ({
    key: entry.key,
    label: entry.label,
    type: entry.type,
    description: entry.description,
    value: (currentSettings[entry.key] ?? entry.default) as string | number | boolean,
    options: entry.options
        ? (entry.options as Array<string | { value: string; label: string }>).map(opt =>
            typeof opt === 'string' ? { value: opt, label: opt } : opt
          )
        : undefined,
    onChange: (val: string | number | boolean) => handleChange(entry.key, val),
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin text-zinc-500" />
        <span className="ml-2 text-xs text-zinc-500">Loading plugins…</span>
      </div>
    );
  }

  if (plugins.length === 0) {
    return (
      <div className="text-center py-12">
        <Package size={32} className="mx-auto text-zinc-700 mb-3" />
        <p className="text-sm text-zinc-500">No plugins installed.</p>
        <p className="text-xs text-zinc-600 mt-1">Plugins are auto-discovered from the plugins directory.</p>
      </div>
    );
  }

  return (
    <div className="flex gap-5 min-h-[400px]">
      {/* Left sub-nav: plugin list */}
      <div className="w-48 shrink-0 flex flex-col gap-0.5 overflow-y-auto custom-scrollbar pr-1">
        {sorted.map(plugin => (
          <button
            key={plugin.name}
            onClick={() => handleSelectPlugin(plugin.name)}
            className={`
              w-full text-left px-3 py-2.5 rounded-lg text-[12px] font-medium
              transition-all duration-200 relative
              ${effectiveSelected === plugin.name
                ? 'bg-zinc-800/60 text-white shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'}
            `}
          >
            {effectiveSelected === plugin.name && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-full bg-indigo-500" />
            )}
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor(plugin.status)}`} />
              <span className="truncate">{plugin.name}</span>
            </div>
            <div className="text-[9px] text-zinc-600 ml-3.5 mt-0.5 truncate">
              v{plugin.version || '0.0.0'}
            </div>
          </button>
        ))}
      </div>

      {/* Right: plugin detail & settings */}
      <div className="flex-1 min-w-0">
        {selectedPluginInfo ? (
          <div className="space-y-5 animate-fade-in">
            {/* Plugin header */}
            <div className="bg-zinc-900/20 rounded-xl border border-zinc-800/30 p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <h4 className="text-sm font-semibold text-zinc-100 truncate">{selectedPluginInfo.name}</h4>
                    <span className={`
                      text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded
                      ${selectedPluginInfo.status === 'active'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/20'
                        : selectedPluginInfo.status === 'error'
                          ? 'bg-red-500/20 text-red-300 border border-red-500/20'
                          : 'bg-zinc-700/30 text-zinc-400 border border-zinc-700/30'}
                    `}>
                      {statusLabel(selectedPluginInfo.status)}
                    </span>
                  </div>
                  {selectedPluginInfo.description && (
                    <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">{selectedPluginInfo.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-[10px] text-zinc-600 font-mono">v{selectedPluginInfo.version || '0.0.0'}</span>
                    <span className="text-[10px] text-zinc-700">•</span>
                    {selectedPluginInfo.source === 'builtin' ? (
                      <span className="text-[10px] text-indigo-400/80 font-medium">Built-in</span>
                    ) : (
                      <span className="text-[10px] text-zinc-600 capitalize">{selectedPluginInfo.source}</span>
                    )}
                  </div>
                </div>
              </div>
              {selectedPluginInfo.error && (
                <div className="mt-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                  <AlertCircle size={12} className="text-red-400 shrink-0 mt-0.5" />
                  <span className="text-[11px] text-red-300 leading-relaxed">{selectedPluginInfo.error}</span>
                </div>
              )}
            </div>

            {/* Settings */}
            {selectedPluginInfo.status !== 'active' ? (
              <div className="text-center py-8">
                <AlertCircle size={20} className="mx-auto text-zinc-600 mb-2" />
                <p className="text-xs text-zinc-500">Plugin must be active to configure settings.</p>
                <p className="text-[10px] text-zinc-600 mt-1">Enable the plugin first, then reload this page.</p>
              </div>
            ) : schema === undefined ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={16} className="animate-spin text-zinc-500" />
                <span className="ml-2 text-xs text-zinc-500">Loading settings schema…</span>
              </div>
            ) : schema.length === 0 ? (
              <div className="text-center py-8">
                <Package size={20} className="mx-auto text-zinc-600 mb-2" />
                <p className="text-xs text-zinc-500">No settings available for this plugin.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <PropertyGrid items={propertyItems} />

                {/* Save button */}
                <div className="flex justify-end gap-2 items-center">
                  {saveSuccess && (
                    <div className="flex items-center gap-1.5 text-emerald-400 text-[11px] font-medium animate-fade-in">
                      <CheckCircle2 size={13} />
                      Saved
                    </div>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={!dirty || saving}
                    className={`
                      flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold
                      transition-all duration-200 active:scale-95
                      ${dirty && !saving
                        ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 hover:shadow-xl hover:shadow-indigo-500/30 hover:-translate-y-0.5'
                        : 'bg-zinc-800/50 text-zinc-500 cursor-not-allowed'}
                    `}
                  >
                    {saving ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Save size={13} />
                    )}
                    {saving ? 'Saving…' : 'Save Plugin Settings'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-12 text-zinc-600 text-xs">
            Select a plugin to view its settings.
          </div>
        )}
      </div>
    </div>
  );
};

export default PluginSettingsTab;
