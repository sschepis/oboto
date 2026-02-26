import { useState, useRef, useEffect } from 'react';
import { PanelLeft, Eye, EyeOff, Puzzle, ChevronDown } from 'lucide-react';

export interface SidebarPanelDescriptor {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** Whether it's a built-in panel or provided by a plugin */
  source: 'builtin' | 'plugin';
  /** Plugin name if source is 'plugin' */
  pluginName?: string;
}

interface SidebarToolbarProps {
  panels: SidebarPanelDescriptor[];
  visiblePanels: Set<string>;
  onTogglePanel: (panelId: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}

/**
 * A thin toolbar at the top of the left sidebar providing
 * quick actions and a panel-visibility popover so users can
 * control which sidebar sections (including plugin panels) are shown.
 */
const SidebarToolbar: React.FC<SidebarToolbarProps> = ({
  panels,
  visiblePanels,
  onTogglePanel,
  onShowAll,
  onHideAll,
}) => {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!isPopoverOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setIsPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isPopoverOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isPopoverOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsPopoverOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isPopoverOpen]);

  const builtinPanels = panels.filter(p => p.source === 'builtin');
  const pluginPanels = panels.filter(p => p.source === 'plugin');
  const hiddenCount = panels.length - visiblePanels.size;

  return (
    <div className="relative flex items-center justify-between h-8 px-2 border-b border-zinc-800/40 bg-zinc-900/30 shrink-0">
      {/* Left: label */}
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        <PanelLeft size={12} className="text-zinc-600" />
        <span>Panels</span>
      </div>

      {/* Right: configure button */}
      <button
        ref={triggerRef}
        onClick={() => setIsPopoverOpen(prev => !prev)}
        className={`
          flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]
          transition-all duration-150
          ${isPopoverOpen
            ? 'bg-indigo-500/20 text-indigo-300'
            : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
          }
        `}
        title="Configure visible panels"
      >
        {hiddenCount > 0 && (
          <span className="text-[9px] bg-indigo-500/20 text-indigo-400 px-1 rounded-sm font-mono">
            {hiddenCount}
          </span>
        )}
        <ChevronDown size={11} className={`transition-transform duration-200 ${isPopoverOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Popover */}
      {isPopoverOpen && (
        <div
          ref={popoverRef}
          className="
            absolute top-full right-0 mt-1 z-50
            w-56 bg-zinc-900 border border-zinc-700/50 rounded-lg shadow-xl shadow-black/40
            overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150
          "
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/50">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Visible Panels
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={onShowAll}
                className="text-[9px] text-zinc-500 hover:text-indigo-400 transition-colors px-1.5 py-0.5 rounded hover:bg-zinc-800/50"
              >
                Show all
              </button>
              <span className="text-zinc-700">|</span>
              <button
                onClick={onHideAll}
                className="text-[9px] text-zinc-500 hover:text-indigo-400 transition-colors px-1.5 py-0.5 rounded hover:bg-zinc-800/50"
              >
                Hide all
              </button>
            </div>
          </div>

          {/* Built-in panels */}
          <div className="px-1 py-1">
            {builtinPanels.map(panel => {
              const visible = visiblePanels.has(panel.id);
              return (
                <button
                  key={panel.id}
                  onClick={() => onTogglePanel(panel.id)}
                  className={`
                    flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-left
                    transition-all duration-150 group
                    ${visible
                      ? 'text-zinc-200 hover:bg-zinc-800/50'
                      : 'text-zinc-500 hover:bg-zinc-800/30 hover:text-zinc-400'
                    }
                  `}
                >
                  <span className="shrink-0">
                    {visible
                      ? <Eye size={12} className="text-indigo-400" />
                      : <EyeOff size={12} className="text-zinc-600" />
                    }
                  </span>
                  <span className="flex-1 text-[11px] truncate">
                    {panel.icon && <span className="mr-1.5 inline-flex">{panel.icon}</span>}
                    {panel.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Plugin panels section */}
          {pluginPanels.length > 0 && (
            <>
              <div className="mx-2 border-t border-zinc-800/50" />
              <div className="px-3 py-1.5">
                <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                  <Puzzle size={10} className="text-zinc-600" />
                  Plugin Panels
                </div>
              </div>
              <div className="px-1 pb-1">
                {pluginPanels.map(panel => {
                  const visible = visiblePanels.has(panel.id);
                  return (
                    <button
                      key={panel.id}
                      onClick={() => onTogglePanel(panel.id)}
                      className={`
                        flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-left
                        transition-all duration-150 group
                        ${visible
                          ? 'text-zinc-200 hover:bg-zinc-800/50'
                          : 'text-zinc-500 hover:bg-zinc-800/30 hover:text-zinc-400'
                        }
                      `}
                    >
                      <span className="shrink-0">
                        {visible
                          ? <Eye size={12} className="text-emerald-400" />
                          : <EyeOff size={12} className="text-zinc-600" />
                        }
                      </span>
                      <span className="flex-1 text-[11px] truncate">{panel.label}</span>
                      {panel.pluginName && (
                        <span className="text-[8px] text-zinc-600 bg-zinc-800/60 px-1 py-0.5 rounded font-mono shrink-0">
                          {panel.pluginName}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SidebarToolbar;
