import React, { useState, useRef, useEffect } from 'react';
import { X, MessageSquare, FileText, Eye, LayoutDashboard, Plus, MessageSquarePlus, FilePlus2, PanelTop, Pencil, Trash2, Image as ImageIcon } from 'lucide-react';
import type { ConversationInfo } from '../../hooks/useChat';

export interface EditorTab {
  id: string;        // 'chat' or file path
  label: string;     // display name
  type: 'chat' | 'file' | 'html-preview' | 'surface' | 'image' | 'pdf';
  filePath?: string;
  surfaceId?: string;
  isDirty?: boolean;
  conversationName?: string; // conversation name for chat tabs
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  tabId: string;
  isMainChat: boolean;
}

interface TabBarProps {
  tabs: EditorTab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewChat?: () => void;
  onNewFile?: () => void;
  onNewSurface?: () => void;
  // Conversation management
  conversations?: ConversationInfo[];
  activeConversation?: string;
  onSwitchConversation?: (name: string) => void;
  onRenameConversation?: (oldName: string, newName: string) => void;
  onDeleteConversation?: (name: string) => void;
}

const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewChat,
  onNewFile,
  onNewSurface,
  conversations = [],
  activeConversation = 'chat',
  onSwitchConversation,
  onRenameConversation,
  onDeleteConversation,
}) => {
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, tabId: '', isMainChat: false });
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setShowPlusMenu(false);
      }
    };
    if (showPlusMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPlusMenu]);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu.visible) return;
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(prev => ({ ...prev, visible: false }));
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(prev => ({ ...prev, visible: false }));
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu.visible]);

  // Focus edit input when entering edit mode
  useEffect(() => {
    if (editingTabId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTabId]);

  // Build conversation tabs: main "Chat" tab + one tab per extra conversation
  const conversationTabs: EditorTab[] = (() => {
    // Always have the main Chat tab first
    const result: EditorTab[] = [{ id: 'chat', label: 'Chat', type: 'chat', conversationName: 'chat' }];
    // Add additional conversation tabs
    for (const conv of conversations) {
      if (conv.name === 'chat') continue; // main chat already added
      result.push({
        id: `conv:${conv.name}`,
        label: conv.name,
        type: 'chat',
        conversationName: conv.name,
      });
    }
    return result;
  })();

  // Non-chat tabs from the tabs prop (file, surface, html-preview)
  const nonChatTabs = tabs.filter(t => t.type !== 'chat');

  // Determine which conversation tab is active
  const activeConvTabId = activeConversation === 'chat' ? 'chat' : `conv:${activeConversation}`;

  // Handle context menu on a conversation tab
  const handleContextMenu = (e: React.MouseEvent, tabId: string, isMainChat: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      tabId,
      isMainChat,
    });
  };

  // Start rename
  const startRename = (tabId: string) => {
    setContextMenu(prev => ({ ...prev, visible: false }));
    const convTab = conversationTabs.find(t => t.id === tabId);
    if (convTab && convTab.conversationName) {
      setEditingTabId(tabId);
      setEditValue(convTab.label);
    }
  };

  // Handle rename submit (Enter)
  const handleRenameSubmit = () => {
    if (!editingTabId) return;
    const convTab = conversationTabs.find(t => t.id === editingTabId);
    if (convTab && convTab.conversationName) {
      const trimmed = editValue.trim();
      if (trimmed && trimmed !== convTab.conversationName) {
        onRenameConversation?.(convTab.conversationName, trimmed);
      }
    }
    setEditingTabId(null);
    setEditValue('');
  };

  // Handle rename key events
  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      setEditingTabId(null);
      setEditValue('');
    }
  };

  // Handle rename cancel (blur)
  const handleRenameBlur = () => {
    setEditingTabId(null);
    setEditValue('');
  };

  // Handle delete from context menu
  const handleDeleteConversation = (tabId: string) => {
    setContextMenu(prev => ({ ...prev, visible: false }));
    const convTab = conversationTabs.find(t => t.id === tabId);
    if (convTab && convTab.conversationName) {
      onDeleteConversation?.(convTab.conversationName);
    }
  };

  // Click on a conversation tab
  const handleConversationTabClick = (convName: string) => {
    // Switch conversation if different
    if (convName !== activeConversation) {
      onSwitchConversation?.(convName);
    }
    // Always select the chat tab view
    onSelectTab('chat');
  };

  return (
    <div className="flex items-end bg-[#0a0a0a] border-b border-zinc-800/40 min-h-[36px] relative">
      {/* Scrollable Tabs Container */}
      <div className="flex-1 flex items-end overflow-x-auto custom-scrollbar relative">
        {/* Subtle bottom highlight line */}
        <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-zinc-800/30 to-transparent pointer-events-none" />

        {/* Conversation tabs */}
        {conversationTabs.map((tab) => {
          const isActive = tab.id === activeConvTabId && activeTabId === 'chat';
          const isMainChat = tab.id === 'chat';
          const isEditing = editingTabId === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => {
                if (!isEditing) {
                  handleConversationTabClick(tab.conversationName!);
                }
              }}
              onContextMenu={(e) => handleContextMenu(e, tab.id, isMainChat)}
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

              <MessageSquare size={12} className={`${isActive ? 'text-indigo-400' : 'text-zinc-600'} transition-colors duration-200`} />
              
              {isEditing ? (
                <input
                  ref={editInputRef}
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={handleRenameBlur}
                  onClick={(e) => e.stopPropagation()}
                  className="
                    w-[100px] bg-zinc-900 text-zinc-100 text-[11px] font-medium
                    px-1.5 py-0.5 rounded border border-indigo-500/60
                    focus:outline-none focus:ring-1 focus:ring-indigo-500/30
                  "
                />
              ) : (
                <span className="max-w-[120px] truncate">
                  {tab.label}
                </span>
              )}

              {/* Close button for non-main conversation tabs */}
              {!isMainChat && !isEditing && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    if (tab.conversationName) {
                      onDeleteConversation?.(tab.conversationName);
                    }
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

        {/* Non-chat tabs (file, surface, html-preview) */}
        {nonChatTabs.map((tab) => {
          const isActive = tab.id === activeTabId;

          // Icon color per type
          const iconColor = isActive
            ? tab.type === 'html-preview' ? 'text-emerald-400'
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

              {tab.type === 'html-preview' ? (
                <Eye size={12} className={`${iconColor} transition-colors duration-200`} />
              ) : tab.type === 'surface' ? (
                <LayoutDashboard size={12} className={`${iconColor} transition-colors duration-200`} />
              ) : tab.type === 'image' ? (
                <ImageIcon size={12} className={`${iconColor} transition-colors duration-200`} />
              ) : tab.type === 'pdf' ? (
                <FileText size={12} className={`${isActive ? 'text-red-400' : 'text-zinc-600'} transition-colors duration-200`} />
              ) : (
                <FileText size={12} className={`${iconColor} transition-colors duration-200`} />
              )}
              <span className="max-w-[120px] truncate">
                {tab.label}
              </span>
              {tab.isDirty && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 animate-pulse shadow-[0_0_4px_rgba(251,191,36,0.4)]" />
              )}
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
            </button>
          );
        })}
      </div>

      {/* Plus button with dropdown (Fixed on right, outside scroll container) */}
      <div className="relative shrink-0 border-l border-zinc-800/30" ref={plusMenuRef}>
        <button
          onClick={() => setShowPlusMenu(prev => !prev)}
          className={`
            flex items-center justify-center px-2.5 py-2 text-zinc-500
            hover:text-zinc-300 hover:bg-zinc-800/40 transition-all duration-200
            cursor-pointer active:scale-90
            ${showPlusMenu ? 'text-zinc-300 bg-zinc-800/40' : ''}
          `}
          title="Create new…"
        >
          <Plus size={14} />
        </button>

        {/* Dropdown menu */}
        {showPlusMenu && (
          <div className="
            absolute top-full right-0 mt-1 w-52 z-50
            bg-[#111111] border border-zinc-800/60 rounded-xl shadow-2xl shadow-black/60
            overflow-hidden animate-fade-in
          ">
            <div className="py-1">
              {/* New Chat Conversation */}
              <button
                onClick={() => {
                  setShowPlusMenu(false);
                  onNewChat?.();
                }}
                className="
                  flex items-center gap-2.5 w-full px-3 py-2 text-[11px] text-zinc-400
                  hover:bg-zinc-800/50 hover:text-zinc-200 transition-all duration-150
                  cursor-pointer
                "
              >
                <MessageSquarePlus size={13} className="text-indigo-400/70" />
                <div className="flex flex-col items-start">
                  <span className="font-medium">New Chat</span>
                  <span className="text-[9px] text-zinc-600">Start a new conversation</span>
                </div>
              </button>

              {/* New Empty File */}
              <button
                onClick={() => {
                  setShowPlusMenu(false);
                  onNewFile?.();
                }}
                className="
                  flex items-center gap-2.5 w-full px-3 py-2 text-[11px] text-zinc-400
                  hover:bg-zinc-800/50 hover:text-zinc-200 transition-all duration-150
                  cursor-pointer
                "
              >
                <FilePlus2 size={13} className="text-amber-400/70" />
                <div className="flex flex-col items-start">
                  <span className="font-medium">New File</span>
                  <span className="text-[9px] text-zinc-600">Create an empty file</span>
                </div>
              </button>

              {/* New Surface */}
              <button
                onClick={() => {
                  setShowPlusMenu(false);
                  onNewSurface?.();
                }}
                className="
                  flex items-center gap-2.5 w-full px-3 py-2 text-[11px] text-zinc-400
                  hover:bg-zinc-800/50 hover:text-zinc-200 transition-all duration-150
                  cursor-pointer
                "
              >
                <PanelTop size={13} className="text-purple-400/70" />
                <div className="flex flex-col items-start">
                  <span className="font-medium">New Surface</span>
                  <span className="text-[9px] text-zinc-600">Create a visual dashboard</span>
                </div>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Context menu for conversation tabs */}
      {contextMenu.visible && (
        <div
          ref={contextMenuRef}
          className="fixed z-[99999] bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl shadow-black/50 py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className={`
              w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left
              transition-colors cursor-pointer
              ${contextMenu.isMainChat
                ? 'text-zinc-600 cursor-not-allowed'
                : 'text-zinc-300 hover:bg-zinc-700/60 hover:text-zinc-100'}
            `}
            onClick={() => {
              if (!contextMenu.isMainChat) {
                startRename(contextMenu.tabId);
              }
            }}
            disabled={contextMenu.isMainChat}
          >
            <Pencil size={12} className={contextMenu.isMainChat ? 'text-zinc-700' : 'text-zinc-400'} />
            Rename
          </button>
          <button
            className={`
              w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left
              transition-colors cursor-pointer
              ${contextMenu.isMainChat
                ? 'text-zinc-600 cursor-not-allowed'
                : 'text-zinc-300 hover:bg-red-500/10 hover:text-red-400'}
            `}
            onClick={() => {
              if (!contextMenu.isMainChat) {
                handleDeleteConversation(contextMenu.tabId);
              }
            }}
            disabled={contextMenu.isMainChat}
          >
            <Trash2 size={12} className={contextMenu.isMainChat ? 'text-zinc-700' : 'text-zinc-400'} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

export default TabBar;
