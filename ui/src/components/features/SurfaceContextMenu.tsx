import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Pencil, Trash2, Copy, X, Check } from 'lucide-react';

export interface SurfaceContextMenuState {
  surfaceId: string;
  surfaceName: string;
  x: number;
  y: number;
}

interface SurfaceContextMenuProps {
  menu: SurfaceContextMenuState;
  onClose: () => void;
  onRename: (surfaceId: string, newName: string) => void;
  onDelete: (surfaceId: string) => void;
  onDuplicate: (surfaceId: string) => void;
}

const SurfaceContextMenu: React.FC<SurfaceContextMenuProps> = ({
  menu,
  onClose,
  onRename,
  onDelete,
  onDuplicate,
}) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(menu.surfaceName);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isRenaming) {
          setIsRenaming(false);
          setRenameValue(menu.surfaceName);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, isRenaming, menu.surfaceName]);

  // Focus rename input when it becomes visible
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const handleRenameSubmit = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== menu.surfaceName) {
      onRename(menu.surfaceId, trimmed);
    }
    onClose();
  }, [renameValue, menu.surfaceId, menu.surfaceName, onRename, onClose]);

  const handleDeleteClick = useCallback(() => {
    if (confirmDelete) {
      onDelete(menu.surfaceId);
      onClose();
    } else {
      setConfirmDelete(true);
    }
  }, [confirmDelete, menu.surfaceId, onDelete, onClose]);

  const handleDuplicate = useCallback(() => {
    onDuplicate(menu.surfaceId);
    onClose();
  }, [menu.surfaceId, onDuplicate, onClose]);

  // Position menu so it doesn't overflow viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: menu.x,
    top: menu.y,
    zIndex: 9999,
  };

  return (
    <div
      ref={menuRef}
      style={style}
      className="min-w-[180px] bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-2xl shadow-black/60 py-1 animate-in fade-in zoom-in-95 duration-100"
    >
      {isRenaming ? (
        <div className="px-2 py-1.5 flex items-center gap-1.5">
          <input
            ref={inputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') {
                setIsRenaming(false);
                setRenameValue(menu.surfaceName);
              }
            }}
            className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-[11px] text-zinc-100 outline-none focus:border-indigo-500 transition-colors"
          />
          <button
            onClick={handleRenameSubmit}
            className="p-1 rounded hover:bg-zinc-700 text-emerald-400 transition-colors"
            title="Confirm"
          >
            <Check size={13} />
          </button>
          <button
            onClick={() => {
              setIsRenaming(false);
              setRenameValue(menu.surfaceName);
            }}
            className="p-1 rounded hover:bg-zinc-700 text-zinc-400 transition-colors"
            title="Cancel"
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <>
          {/* Surface name header */}
          <div className="px-3 py-1.5 text-[10px] text-zinc-500 font-medium uppercase tracking-wider border-b border-zinc-800 truncate max-w-[220px]">
            {menu.surfaceName}
          </div>

          <button
            onClick={() => setIsRenaming(true)}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left"
          >
            <Pencil size={13} className="text-zinc-500" />
            <span>Rename</span>
          </button>

          <button
            onClick={handleDuplicate}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left"
          >
            <Copy size={13} className="text-zinc-500" />
            <span>Duplicate</span>
          </button>

          <div className="border-t border-zinc-800 my-0.5" />

          <button
            onClick={handleDeleteClick}
            className={`flex items-center gap-2.5 w-full px-3 py-2 text-[11px] transition-colors text-left ${
              confirmDelete
                ? 'text-red-400 bg-red-500/10 hover:bg-red-500/20'
                : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            <Trash2 size={13} className={confirmDelete ? 'text-red-400' : 'text-zinc-500'} />
            <span>{confirmDelete ? 'Click again to confirm' : 'Delete'}</span>
          </button>
        </>
      )}
    </div>
  );
};

export default SurfaceContextMenu;
