import React from 'react';
import { X, MessageSquare, FileText, Eye, LayoutDashboard } from 'lucide-react';

export interface EditorTab {
  id: string;        // 'chat' or file path
  label: string;     // display name
  type: 'chat' | 'file' | 'html-preview' | 'surface';
  filePath?: string;
  surfaceId?: string;
  isDirty?: boolean;
}

interface TabBarProps {
  tabs: EditorTab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}

const TabBar: React.FC<TabBarProps> = ({ tabs, activeTabId, onSelectTab, onCloseTab }) => {
  return (
    <div className="flex items-end bg-[#0a0a0a] border-b border-zinc-800/40 overflow-x-auto custom-scrollbar min-h-[36px] relative">
      {/* Subtle bottom highlight line */}
      <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-zinc-800/30 to-transparent" />

      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isChat = tab.type === 'chat';

        // Icon color per type
        const iconColor = isActive
          ? tab.type === 'chat' ? 'text-indigo-400'
            : tab.type === 'html-preview' ? 'text-emerald-400'
            : tab.type === 'surface' ? 'text-purple-400'
            : 'text-amber-400'
          : 'text-zinc-600';

        return (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={`
              group flex items-center gap-1.5 px-3.5 py-2 text-[11px] font-medium
              border-r border-zinc-800/30 transition-all duration-200 relative shrink-0
              ${isActive
                ? 'bg-[#080808] text-zinc-200'
                : 'bg-[#0c0c0c] text-zinc-500 hover:text-zinc-300 hover:bg-[#0e0e0e]'
              }
            `}
          >
            {/* Active tab top accent */}
            <div className={`
              absolute top-0 left-0 right-0 h-[2px] transition-all duration-300
              ${isActive
                ? 'bg-gradient-to-r from-indigo-500/80 via-indigo-500 to-indigo-500/80 shadow-[0_1px_8px_rgba(99,102,241,0.3)]'
                : 'bg-transparent'
              }
            `} />

            {/* Active tab bottom connector */}
            {isActive && (
              <div className="absolute bottom-[-1px] left-0 right-0 h-[1px] bg-[#080808] z-10" />
            )}

            {isChat ? (
              <MessageSquare size={12} className={`${iconColor} transition-colors duration-200`} />
            ) : tab.type === 'html-preview' ? (
              <Eye size={12} className={`${iconColor} transition-colors duration-200`} />
            ) : tab.type === 'surface' ? (
              <LayoutDashboard size={12} className={`${iconColor} transition-colors duration-200`} />
            ) : (
              <FileText size={12} className={`${iconColor} transition-colors duration-200`} />
            )}
            <span className="max-w-[120px] truncate">
              {tab.label}
            </span>
            {tab.isDirty && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 animate-pulse shadow-[0_0_4px_rgba(251,191,36,0.4)]" />
            )}
            {!isChat && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className="
                  ml-1 p-0.5 rounded-md
                  hover:bg-zinc-600/30 hover:text-zinc-300
                  opacity-0 group-hover:opacity-100
                  transition-all duration-150 active:scale-90
                "
              >
                <X size={10} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default TabBar;
