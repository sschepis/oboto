import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquarePlus, ChevronDown, Trash2, GitBranch, Crown, Pencil } from 'lucide-react';
import type { ConversationInfo } from '../../hooks/useChat';

interface ConversationSwitcherProps {
  conversations: ConversationInfo[];
  activeConversation: string;
  onSwitch: (name: string) => void;
  onCreate: (name: string) => void;
  onDelete: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  className?: string;
}

/** Compute the next auto-generated conversation name (chat-1, chat-2, …) */
function getNextChatName(conversations: ConversationInfo[]): string {
  let max = 0;
  for (const c of conversations) {
    const m = c.name.match(/^chat-(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `chat-${max + 1}`;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  conversationName: string;
}

const ConversationSwitcher: React.FC<ConversationSwitcherProps> = ({
  conversations,
  activeConversation,
  onSwitch,
  onCreate,
  onDelete,
  onRename,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [renamingConversation, setRenamingConversation] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, conversationName: '' });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setRenamingConversation(null);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

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

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingConversation && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingConversation]);

  const handleNewConversation = useCallback(() => {
    const name = getNextChatName(conversations);
    onCreate(name);
  }, [conversations, onCreate]);

  const handleRenameSubmit = useCallback(() => {
    if (!renamingConversation) return;
    const trimmed = renameValue.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (trimmed && trimmed !== renamingConversation) {
      onRename(renamingConversation, trimmed);
    }
    setRenamingConversation(null);
    setRenameValue('');
  }, [renamingConversation, renameValue, onRename]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      setRenamingConversation(null);
      setRenameValue('');
    }
  }, [handleRenameSubmit]);

  const handleContextMenu = useCallback((e: React.MouseEvent, convName: string) => {
    if (convName === 'chat') return; // No context menu for default conversation
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      conversationName: convName,
    });
  }, []);

  const startRename = useCallback((convName: string) => {
    setContextMenu(prev => ({ ...prev, visible: false }));
    setRenamingConversation(convName);
    setRenameValue(convName);
  }, []);

  const handleContextMenuDelete = useCallback((convName: string) => {
    setContextMenu(prev => ({ ...prev, visible: false }));
    onDelete(convName);
  }, [onDelete]);

  const isDefault = (name: string) => name === 'chat';

  // Don't render if no conversations loaded
  if (conversations.length === 0) return null;

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className="
          flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium font-mono
          transition-all duration-200 cursor-pointer select-none
          text-zinc-500 hover:text-indigo-400 hover:bg-indigo-500/10
        "
        title="Switch conversation"
      >
        <GitBranch size={11} className="text-indigo-400/70" />
        <span className="max-w-[120px] truncate">{activeConversation}</span>
        {conversations.length > 1 && (
          <span className="text-[9px] text-zinc-600">
            ({conversations.length})
          </span>
        )}
        <ChevronDown size={10} className={`text-zinc-600 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="
          absolute top-full left-0 mt-1 w-64 z-[99999]
          bg-[#111111] border border-zinc-800/60 rounded-xl shadow-2xl shadow-black/60
          overflow-hidden animate-fade-in
        ">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/40">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Conversations
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleNewConversation();
              }}
              className="
                flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300
                transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-indigo-500/10
              "
              title="New conversation"
            >
              <MessageSquarePlus size={11} />
              <span>New</span>
            </button>
          </div>

          {/* Conversation list */}
          <div className="max-h-60 overflow-y-auto py-1">
            {conversations.map((conv) => {
              const active = conv.name === activeConversation;
              const isRenaming = renamingConversation === conv.name;
              return (
                <div
                  key={conv.name}
                  className={`
                    flex items-center gap-2 px-3 py-1.5 cursor-pointer
                    transition-all duration-150 group
                    ${active
                      ? 'bg-indigo-500/10 text-indigo-300'
                      : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'}
                  `}
                  onClick={() => {
                    if (!isRenaming) {
                      onSwitch(conv.name);
                      setIsOpen(false);
                    }
                  }}
                  onContextMenu={(e) => handleContextMenu(e, conv.name)}
                >
                  {/* Icon */}
                  <div className="shrink-0">
                    {isDefault(conv.name) ? (
                      <Crown size={12} className={active ? 'text-amber-400' : 'text-amber-500/40'} />
                    ) : (
                      <GitBranch size={12} className={active ? 'text-indigo-400' : 'text-zinc-600'} />
                    )}
                  </div>

                  {/* Name + info */}
                  <div className="flex-1 min-w-0">
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={handleRenameKeyDown}
                        onBlur={() => {
                          setRenamingConversation(null);
                          setRenameValue('');
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="
                          w-full bg-zinc-900 text-zinc-100 text-[11px] font-mono
                          px-1.5 py-0.5 rounded border border-zinc-600
                          focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/20
                        "
                      />
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[11px] font-mono truncate ${active ? 'font-semibold' : ''}`}>
                            {conv.name}
                          </span>
                          {isDefault(conv.name) && (
                            <span className="text-[8px] uppercase tracking-wider text-amber-500/60 font-bold bg-amber-500/5 px-1 rounded">
                              main
                            </span>
                          )}
                        </div>
                        <div className="text-[9px] text-zinc-600 mt-0.5">
                          {conv.messageCount} messages
                          {conv.parentReports && conv.parentReports.length > 0 && (
                            <span className="ml-1 text-emerald-500/60">
                              · {conv.parentReports.length} report{conv.parentReports.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Active indicator */}
                  {active && !isRenaming && (
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 shadow-[0_0_6px_rgba(99,102,241,0.5)]" />
                  )}

                  {/* Delete button (not for default) */}
                  {!isDefault(conv.name) && !active && !isRenaming && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(conv.name);
                      }}
                      className="
                        opacity-0 group-hover:opacity-100 transition-opacity
                        text-zinc-600 hover:text-red-400 p-0.5 rounded cursor-pointer
                      "
                      title={`Delete "${conv.name}"`}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer hint */}
          <div className="px-3 py-1.5 border-t border-zinc-800/40 text-[9px] text-zinc-600">
            Child conversations can report to the main &quot;chat&quot; thread
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu.visible && (
        <div
          ref={contextMenuRef}
          className="fixed z-[99999] bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl shadow-black/50 py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="
              w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-zinc-300
              hover:bg-zinc-700/60 hover:text-zinc-100 transition-colors cursor-pointer text-left
            "
            onClick={() => startRename(contextMenu.conversationName)}
          >
            <Pencil size={12} className="text-zinc-400" />
            Rename
          </button>
          <button
            className="
              w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-zinc-300
              hover:bg-red-500/10 hover:text-red-400 transition-colors cursor-pointer text-left
            "
            onClick={() => handleContextMenuDelete(contextMenu.conversationName)}
          >
            <Trash2 size={12} className="text-zinc-400" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

export default ConversationSwitcher;
