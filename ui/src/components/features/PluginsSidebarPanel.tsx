import React from 'react';
import { Puzzle, ToggleLeft, ToggleRight, Loader2, Package, Globe, FolderOpen, CheckCircle, AlertCircle } from 'lucide-react';
import type { PluginInfo } from '../../hooks/usePlugins';

interface PluginsSidebarPanelProps {
  plugins: PluginInfo[];
  loading: boolean;
  onEnable: (name: string) => void;
  onDisable: (name: string) => void;
  onPluginClick?: (name: string) => void;
}

const sourceIcons: Record<string, React.ReactNode> = {
  builtin: <Package size={10} className="text-indigo-400" />,
  npm: <Package size={10} className="text-red-400" />,
  global: <Globe size={10} className="text-cyan-400" />,
  workspace: <FolderOpen size={10} className="text-amber-400" />,
};

const statusIcon: Record<string, React.ReactNode> = {
  active: <CheckCircle size={9} className="text-emerald-400" />,
  disabled: <ToggleLeft size={9} className="text-zinc-600" />,
  error: <AlertCircle size={9} className="text-red-400" />,
  discovered: <Package size={9} className="text-zinc-500" />,
};

const PluginsSidebarPanel: React.FC<PluginsSidebarPanelProps> = ({
  plugins,
  loading,
  onEnable,
  onDisable,
  onPluginClick,
}) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 size={14} className="text-zinc-500 animate-spin" />
      </div>
    );
  }

  if (plugins.length === 0) {
    return (
      <div className="flex flex-col items-center py-6 text-zinc-600 text-[11px] gap-1.5 px-2 text-center">
        <Puzzle size={18} className="text-zinc-700" />
        <span>No plug-ins found</span>
      </div>
    );
  }

  const activeCount = plugins.filter(p => p.status === 'active').length;

  return (
    <div className="flex flex-col gap-0.5">
      {/* Summary line */}
      <div className="flex items-center gap-1.5 px-2 py-1 text-[9px] text-zinc-600">
        <span>{activeCount}/{plugins.length} active</span>
      </div>

      {plugins.map(plugin => {
        const isActive = plugin.status === 'active';

        return (
          <div
            key={plugin.name}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-800/30 transition-colors group cursor-pointer"
            onClick={() => onPluginClick?.(plugin.name)}
          >
            {/* Source icon */}
            <span className="shrink-0">{sourceIcons[plugin.source] || sourceIcons.workspace}</span>

            {/* Name + status */}
            <div className="flex-1 min-w-0 flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-300 truncate">{plugin.name}</span>
              {statusIcon[plugin.status]}
            </div>

            {/* Toggle */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isActive) {
                  onDisable(plugin.name);
                } else {
                  onEnable(plugin.name);
                }
              }}
              className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-zinc-700/50 transition-all"
              title={isActive ? 'Disable' : 'Enable'}
            >
              {isActive ? (
                <ToggleRight size={14} className="text-emerald-400" />
              ) : (
                <ToggleLeft size={14} className="text-zinc-500" />
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default PluginsSidebarPanel;
