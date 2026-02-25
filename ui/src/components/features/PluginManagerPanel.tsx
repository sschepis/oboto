import React, { useState } from 'react';
import { Puzzle, ToggleLeft, ToggleRight, RefreshCw, AlertCircle, CheckCircle, Package, Globe, FolderOpen, ChevronDown, ChevronRight, Settings } from 'lucide-react';
import type { PluginInfo } from '../../hooks/usePlugins';

interface PluginManagerPanelProps {
  plugins: PluginInfo[];
  loading: boolean;
  onEnable: (name: string) => void;
  onDisable: (name: string) => void;
  onReload: (name: string) => void;
}

const sourceIcons: Record<string, React.ReactNode> = {
  builtin: <Package size={12} className="text-indigo-400" />,
  npm: <Package size={12} className="text-red-400" />,
  global: <Globe size={12} className="text-cyan-400" />,
  workspace: <FolderOpen size={12} className="text-amber-400" />,
};

const statusBadge: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  active: {
    color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    icon: <CheckCircle size={10} />,
    label: 'Active',
  },
  disabled: {
    color: 'bg-zinc-700/40 text-zinc-500 border-zinc-600/30',
    icon: <ToggleLeft size={10} />,
    label: 'Disabled',
  },
  error: {
    color: 'bg-red-500/20 text-red-400 border-red-500/30',
    icon: <AlertCircle size={10} />,
    label: 'Error',
  },
  discovered: {
    color: 'bg-zinc-700/40 text-zinc-400 border-zinc-600/30',
    icon: <Package size={10} />,
    label: 'Discovered',
  },
};

const PluginManagerPanel: React.FC<PluginManagerPanelProps> = ({
  plugins,
  loading,
  onEnable,
  onDisable,
  onReload,
}) => {
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        <RefreshCw size={16} className="animate-spin mr-2" />
        Loading plugins...
      </div>
    );
  }

  if (plugins.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-3 px-8">
        <Puzzle size={48} className="text-zinc-700" />
        <p className="text-sm text-center">No plugins found.</p>
        <p className="text-xs text-zinc-600 text-center">
          Place plugins in <code className="text-indigo-400 bg-zinc-800 px-1 py-0.5 rounded">plugins/</code>,{' '}
          <code className="text-indigo-400 bg-zinc-800 px-1 py-0.5 rounded">.plugins/</code>, or install via npm.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Puzzle size={16} className="text-indigo-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Plugins</h2>
        <span className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded-full">
          {plugins.filter(p => p.status === 'active').length}/{plugins.length}
        </span>
      </div>

      {plugins.map((plugin) => {
        const isExpanded = expandedPlugin === plugin.name;
        const badge = statusBadge[plugin.status] || statusBadge.discovered;
        const isActive = plugin.status === 'active';

        return (
          <div
            key={plugin.name}
            className="bg-zinc-900/60 border border-zinc-800/50 rounded-lg overflow-hidden"
          >
            {/* Plugin header */}
            <div
              className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-zinc-800/30 transition-colors"
              onClick={() => setExpandedPlugin(isExpanded ? null : plugin.name)}
            >
              {/* Expand icon */}
              {isExpanded ? (
                <ChevronDown size={12} className="text-zinc-500 shrink-0" />
              ) : (
                <ChevronRight size={12} className="text-zinc-500 shrink-0" />
              )}

              {/* Source icon */}
              <span className="shrink-0">{sourceIcons[plugin.source] || sourceIcons.workspace}</span>

              {/* Name and version */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-zinc-200 truncate">{plugin.name}</span>
                  <span className="text-[9px] text-zinc-600">{plugin.version}</span>
                </div>
                {plugin.description && (
                  <p className="text-[10px] text-zinc-500 truncate mt-0.5">{plugin.description}</p>
                )}
              </div>

              {/* Status badge */}
              <span className={`flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full border ${badge.color} shrink-0`}>
                {badge.icon}
                {badge.label}
              </span>

              {/* Toggle button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isActive) {
                    onDisable(plugin.name);
                  } else {
                    onEnable(plugin.name);
                  }
                }}
                className="shrink-0 p-1 rounded hover:bg-zinc-700/50 transition-colors"
                title={isActive ? 'Disable' : 'Enable'}
              >
                {isActive ? (
                  <ToggleRight size={16} className="text-emerald-400" />
                ) : (
                  <ToggleLeft size={16} className="text-zinc-500" />
                )}
              </button>
            </div>

            {/* Expanded details */}
            {isExpanded && (
              <div className="border-t border-zinc-800/40 px-3 py-2.5 space-y-2">
                {/* Error message */}
                {plugin.error && (
                  <div className="flex items-start gap-2 text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5">
                    <AlertCircle size={12} className="shrink-0 mt-0.5" />
                    <span>{plugin.error}</span>
                  </div>
                )}

                {/* Capabilities */}
                {Object.keys(plugin.capabilities).length > 0 && (
                  <div>
                    <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Capabilities</p>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(plugin.capabilities).map(([cap, enabled]) => (
                        <span
                          key={cap}
                          className={`text-[9px] px-1.5 py-0.5 rounded ${
                            enabled
                              ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/20'
                              : 'bg-zinc-800/50 text-zinc-600 border border-zinc-700/30'
                          }`}
                        >
                          {cap}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* UI Components */}
                {(plugin.ui.tabs.length > 0 || plugin.ui.sidebarSections.length > 0 || plugin.ui.settingsPanels.length > 0) && (
                  <div>
                    <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">UI Components</p>
                    <div className="flex flex-wrap gap-1">
                      {plugin.ui.tabs.map(t => (
                        <span key={t.id} className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/20">
                          Tab: {t.label}
                        </span>
                      ))}
                      {plugin.ui.sidebarSections.map(s => (
                        <span key={s.id} className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/20">
                          Sidebar: {s.label}
                        </span>
                      ))}
                      {plugin.ui.settingsPanels.map(p => (
                        <span key={p.id} className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
                          Settings: {p.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => onReload(plugin.name)}
                    disabled={plugin.status !== 'active'}
                    className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <RefreshCw size={10} />
                    Reload
                  </button>
                  <button
                    onClick={() => {
                      // TODO: open plugin settings panel
                    }}
                    disabled={plugin.status !== 'active'}
                    className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <Settings size={10} />
                    Settings
                  </button>
                </div>

                {/* Source info */}
                <p className="text-[9px] text-zinc-600">
                  Source: {plugin.source}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PluginManagerPanel;
