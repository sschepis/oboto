import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronRight, Folder, FileText, FolderOpen, Copy, Trash2, ExternalLink, Files, X, RefreshCw, ChevronsDown, ChevronsUp, Pencil, FolderInput, AppWindow } from 'lucide-react';
import type { FileNode } from '../../hooks/useChat';
import { wsService } from '../../services/wsService';

function globToRegex(pattern: string): RegExp {
  if (!pattern) return new RegExp('');
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex special chars (but NOT * and ?)
    .replace(/\*/g, '.*')                    // glob * → regex .*
    .replace(/\?/g, '.');                    // glob ? → regex .
  return new RegExp(escaped, 'i');            // case-insensitive
}

function filterTree(nodes: FileNode[], regex: RegExp): FileNode[] {
  return nodes.reduce<FileNode[]>((acc, node) => {
    if (node.type === 'file') {
      if (regex.test(node.name)) acc.push(node);
    } else {
      const filteredChildren = filterTree(node.children || [], regex);
      if (filteredChildren.length > 0) {
        acc.push({ ...node, children: filteredChildren });
      }
    }
    return acc;
  }, []);
}

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  parentPath: string;
  onFileClick?: (filePath: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, type: 'file' | 'directory') => void;
  forceExpand?: boolean;
  /** When true, all directories start expanded; when false, all start collapsed */
  defaultExpanded?: boolean;
  /** Drag-and-drop: currently dragged path */
  draggedPath: string | null;
  onDragStart: (path: string) => void;
  onDragEnd: () => void;
  onDropOnFolder: (targetFolder: string) => void;
  /** Inline rename state */
  renamingPath: string | null;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
}

const FileTreeNode: React.FC<FileTreeNodeProps> = ({
  node, depth, parentPath, onFileClick, onContextMenu,
  forceExpand, defaultExpanded,
  draggedPath, onDragStart, onDragEnd, onDropOnFolder,
  renamingPath, renameValue, onRenameChange, onRenameCommit, onRenameCancel,
}) => {
  const [isOpen, setIsOpen] = useState(defaultExpanded !== undefined ? defaultExpanded : depth < 1);
  const [isDragOver, setIsDragOver] = useState(false);
  const isDir = node.type === 'directory';
  const hasChildren = isDir && node.children && node.children.length > 0;
  const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;
  const effectiveOpen = forceExpand || isOpen;
  const isRenaming = renamingPath === fullPath;
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      // Select filename without extension for files
      if (!isDir) {
        const dotIdx = renameValue.lastIndexOf('.');
        if (dotIdx > 0) {
          renameInputRef.current.setSelectionRange(0, dotIdx);
        } else {
          renameInputRef.current.select();
        }
      } else {
        renameInputRef.current.select();
      }
    }
  }, [isRenaming]);

  const handleClick = () => {
    if (isRenaming) return;
    if (isDir) {
      setIsOpen(!isOpen);
    } else {
      onFileClick?.(fullPath);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, fullPath, node.type);
  };

  // Drag-and-drop handlers
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', fullPath);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart(fullPath);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isDir) return;
    if (draggedPath === fullPath) return; // Can't drop on self
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (isDir && draggedPath && draggedPath !== fullPath) {
      onDropOnFolder(fullPath);
    }
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onRenameCommit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onRenameCancel();
    }
  };

  // File extension color hints
  const getFileColor = (name: string): string => {
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts': case 'tsx': return 'text-blue-400/60';
      case 'js': case 'jsx': return 'text-amber-400/60';
      case 'json': return 'text-yellow-400/60';
      case 'css': case 'scss': return 'text-pink-400/60';
      case 'md': return 'text-zinc-400/60';
      case 'html': return 'text-orange-400/60';
      case 'svg': case 'png': case 'jpg': return 'text-emerald-400/60';
      case 'mp3': case 'wav': case 'ogg': case 'm4a': case 'flac': case 'aac': return 'text-violet-400/60';
      case 'mp4': case 'webm': case 'mov': return 'text-fuchsia-400/60';
      default: return 'text-zinc-600';
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        draggable={!isRenaming}
        onDragStart={handleDragStart}
        onDragEnd={onDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex items-center gap-1.5 w-full text-left py-[3px] px-1 rounded-md hover:bg-zinc-800/40 transition-all duration-100 group cursor-pointer relative ${
          isDragOver ? 'bg-indigo-500/15 ring-1 ring-indigo-500/30' : ''
        } ${draggedPath === fullPath ? 'opacity-40' : ''}`}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        {/* Indentation guides */}
        {depth > 0 && Array.from({ length: depth }).map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 w-px bg-zinc-800/30 group-hover:bg-zinc-700/30 transition-colors duration-100"
            style={{ left: `${i * 14 + 10}px` }}
          />
        ))}
        
        {isDir ? (
          <>
            <ChevronRight
              size={10}
              className={`text-zinc-600 shrink-0 transition-transform duration-150 ${effectiveOpen ? 'rotate-90' : ''}`}
            />
            {effectiveOpen ? (
              <FolderOpen size={12} className="text-amber-500/60 shrink-0" />
            ) : (
              <Folder size={12} className="text-amber-500/50 shrink-0" />
            )}
          </>
        ) : (
          <>
            <span className="w-[10px] shrink-0" />
            <FileText size={11} className={`shrink-0 ${getFileColor(node.name)}`} />
          </>
        )}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={onRenameCommit}
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] bg-zinc-900 border border-indigo-500/50 rounded px-1 py-0 text-zinc-200 focus:outline-none focus:border-indigo-400 min-w-[60px] flex-1"
          />
        ) : (
          <span className={`text-[10px] truncate transition-colors duration-100 ${
            isDir 
              ? 'text-zinc-400 font-medium group-hover:text-zinc-300' 
              : 'text-zinc-500 group-hover:text-zinc-400'
          }`}>
            {node.name}
          </span>
        )}
      </button>
      
      {/* Children with collapse transition */}
      {isDir && hasChildren && (
        <div className={`overflow-hidden transition-all duration-150 ${effectiveOpen ? 'max-h-[9999px] opacity-100' : 'max-h-0 opacity-0'}`}>
          {node.children!.map((child, i) => (
            <FileTreeNode
              key={`${child.name}-${i}`}
              node={child}
              depth={depth + 1}
              parentPath={fullPath}
              onFileClick={onFileClick}
              onContextMenu={onContextMenu}
              forceExpand={forceExpand}
              defaultExpanded={defaultExpanded}
              draggedPath={draggedPath}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDropOnFolder={onDropOnFolder}
              renamingPath={renamingPath}
              renameValue={renameValue}
              onRenameChange={onRenameChange}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface FileTreeProps {
  files: FileNode[];
  onFileClick?: (filePath: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  path: string;
  type: 'file' | 'directory';
}

const FileTree: React.FC<FileTreeProps> = ({ files, onFileClick }) => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [filterPattern, setFilterPattern] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  /** Incremented to force tree remount on expand/collapse all */
  const [treeKey, setTreeKey] = useState(0);
  /** undefined = default (depth < 1), true = expand all, false = collapse all */
  const [defaultExpanded, setDefaultExpanded] = useState<boolean | undefined>(undefined);
  const menuRef = useRef<HTMLDivElement>(null);
  const treeContainerRef = useRef<HTMLDivElement>(null);

  // Drag-and-drop state
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [isDragOverPanel, setIsDragOverPanel] = useState(false);

  // Inline rename state
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleExpandAll = useCallback(() => {
    setDefaultExpanded(true);
    setTreeKey(k => k + 1);
  }, []);

  const handleCollapseAll = useCallback(() => {
    setDefaultExpanded(false);
    setTreeKey(k => k + 1);
  }, []);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    wsService.getFiles();
    // Reset the spinner after a short delay (the file-tree event will update the tree)
    setTimeout(() => setIsRefreshing(false), 800);
  }, []);

  const filteredFiles = filterPattern
    ? filterTree(files, globToRegex(filterPattern))
    : files;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };

    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent, path: string, type: 'file' | 'directory') => {
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      path,
      type
    });
  };

  // Drag-and-drop handlers
  const handleDragStart = useCallback((path: string) => {
    setDraggedPath(path);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedPath(null);
    setIsDragOverPanel(false);
  }, []);

  const handleDropOnFolder = useCallback((targetFolder: string) => {
    if (draggedPath && draggedPath !== targetFolder) {
      wsService.moveFile(draggedPath, targetFolder);
    }
    setDraggedPath(null);
  }, [draggedPath]);

  // Panel-level drop (drop on root / background area)
  const handlePanelDragOver = useCallback((e: React.DragEvent) => {
    if (!draggedPath) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOverPanel(true);
  }, [draggedPath]);

  const handlePanelDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the panel container itself
    if (treeContainerRef.current && !treeContainerRef.current.contains(e.relatedTarget as Node)) {
      setIsDragOverPanel(false);
    }
  }, []);

  const handlePanelDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverPanel(false);
    if (draggedPath) {
      // Drop on root = move to workspace root
      wsService.moveFile(draggedPath, '.');
      setDraggedPath(null);
    }
  }, [draggedPath]);

  // Rename handlers
  const startRename = useCallback((path: string) => {
    const name = path.split('/').pop() || '';
    setRenamingPath(path);
    setRenameValue(name);
    setContextMenu(null);
  }, []);

  const commitRename = useCallback(() => {
    if (!renamingPath || !renameValue.trim()) {
      setRenamingPath(null);
      setRenameValue('');
      return;
    }
    const oldName = renamingPath.split('/').pop() || '';
    if (renameValue.trim() !== oldName) {
      const parent = renamingPath.substring(0, renamingPath.lastIndexOf('/'));
      const newPath = parent ? `${parent}/${renameValue.trim()}` : renameValue.trim();
      wsService.renameFile(renamingPath, newPath);
    }
    setRenamingPath(null);
    setRenameValue('');
  }, [renamingPath, renameValue]);

  const cancelRename = useCallback(() => {
    setRenamingPath(null);
    setRenameValue('');
  }, []);

  const handleAction = async (action: 'open' | 'copy-path' | 'duplicate' | 'delete' | 'rename' | 'reveal-in-finder' | 'open-with-default') => {
    if (!contextMenu) return;
    const { path } = contextMenu;

    switch (action) {
      case 'open':
        setContextMenu(null);
        onFileClick?.(path);
        break;
      case 'copy-path':
        setContextMenu(null);
        try {
          await navigator.clipboard.writeText(path);
        } catch (err) {
          console.error('Failed to copy path', err);
        }
        break;
      case 'duplicate': {
        setContextMenu(null);
        const name = path.split('/').pop() || '';
        const parent = path.substring(0, path.lastIndexOf('/'));
        const newName = window.prompt('Enter new name for duplicate:', `copy_${name}`);
        if (newName) {
          const dest = parent ? `${parent}/${newName}` : newName;
          wsService.copyFile(path, dest);
        }
        break;
      }
      case 'delete':
        setContextMenu(null);
        if (window.confirm(`Are you sure you want to delete ${path}?`)) {
          wsService.deleteFile(path);
        }
        break;
      case 'rename':
        startRename(path);
        break;
      case 'reveal-in-finder':
        setContextMenu(null);
        wsService.revealInFinder(path);
        break;
      case 'open-with-default':
        setContextMenu(null);
        wsService.openWithDefault(path);
        break;
    }
  };

  if (!files || files.length === 0) {
    return (
      <div className="text-[10px] text-zinc-600 italic px-2 py-4 animate-fade-in">
        No files loaded
      </div>
    );
  }

  return (
    <div
      ref={treeContainerRef}
      className={`space-y-0 relative ${isDragOverPanel ? 'bg-indigo-500/5 ring-1 ring-inset ring-indigo-500/20 rounded-lg' : ''}`}
      onDragOver={handlePanelDragOver}
      onDragLeave={handlePanelDragLeave}
      onDrop={handlePanelDrop}
    >
      <div className="flex items-center justify-between mb-2 px-1">
        <h4 className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.15em]">
          Workspace Files
        </h4>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleExpandAll}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 transition-all duration-150 cursor-pointer"
            aria-label="Expand all"
            title="Expand all"
          >
            <ChevronsDown size={11} />
          </button>
          <button
            onClick={handleCollapseAll}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 transition-all duration-150 cursor-pointer"
            aria-label="Collapse all"
            title="Collapse all"
          >
            <ChevronsUp size={11} />
          </button>
          <button
            onClick={handleRefresh}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 transition-all duration-150 cursor-pointer"
            aria-label="Refresh file tree"
            title="Refresh file tree"
          >
            <RefreshCw size={11} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      <div className="px-1 py-1 relative">
        <input
          type="text"
          placeholder="Filter files... (e.g. *.tsx, config*)"
          value={filterPattern}
          onChange={(e) => setFilterPattern(e.target.value)}
          className="w-full px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
        />
        {filterPattern && (
          <button
            onClick={() => setFilterPattern('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors duration-100"
            aria-label="Clear filter"
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
        {filteredFiles.length === 0 && filterPattern && (
          <div className="px-3 py-2 text-xs text-zinc-500 italic">
            No files match &quot;{filterPattern}&quot;
          </div>
        )}
        {filteredFiles.map((node, i) => (
          <FileTreeNode
            key={`${node.name}-${i}-${treeKey}`}
            node={node}
            depth={0}
            parentPath=""
            onFileClick={onFileClick}
            onContextMenu={handleContextMenu}
            forceExpand={!!filterPattern}
            defaultExpanded={defaultExpanded}
            draggedPath={draggedPath}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDropOnFolder={handleDropOnFolder}
            renamingPath={renamingPath}
            renameValue={renameValue}
            onRenameChange={setRenameValue}
            onRenameCommit={commitRename}
            onRenameCancel={cancelRename}
          />
        ))}
      </div>

      {/* Drop hint when dragging over the panel background */}
      {isDragOverPanel && draggedPath && (
        <div className="absolute inset-x-0 bottom-0 py-1 text-center text-[9px] text-indigo-400/70 pointer-events-none">
          Drop to move to workspace root
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 w-52 bg-[#0e0e0e] border border-zinc-800/60 rounded-xl shadow-2xl shadow-black/50 py-1 animate-scale-in overflow-hidden"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.type === 'file' && (
            <button
              onClick={() => handleAction('open')}
              className="w-full text-left px-3 py-2 text-[11px] text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-100 flex items-center gap-2.5 transition-colors duration-100"
            >
              <ExternalLink size={12} className="text-zinc-500" />
              Open
            </button>
          )}
          <button
            onClick={() => handleAction('rename')}
            className="w-full text-left px-3 py-2 text-[11px] text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-100 flex items-center gap-2.5 transition-colors duration-100"
          >
            <Pencil size={12} className="text-zinc-500" />
            Rename
          </button>
          <button
            onClick={() => handleAction('copy-path')}
            className="w-full text-left px-3 py-2 text-[11px] text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-100 flex items-center gap-2.5 transition-colors duration-100"
          >
            <Copy size={12} className="text-zinc-500" />
            Copy Path
          </button>
          <button
            onClick={() => handleAction('duplicate')}
            className="w-full text-left px-3 py-2 text-[11px] text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-100 flex items-center gap-2.5 transition-colors duration-100"
          >
            <Files size={12} className="text-zinc-500" />
            Duplicate
          </button>
          <div className="h-px bg-zinc-800/40 mx-2 my-1" />
          <button
            onClick={() => handleAction('reveal-in-finder')}
            className="w-full text-left px-3 py-2 text-[11px] text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-100 flex items-center gap-2.5 transition-colors duration-100"
          >
            <FolderInput size={12} className="text-zinc-500" />
            Reveal in Finder
          </button>
          <button
            onClick={() => handleAction('open-with-default')}
            className="w-full text-left px-3 py-2 text-[11px] text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-100 flex items-center gap-2.5 transition-colors duration-100"
          >
            <AppWindow size={12} className="text-zinc-500" />
            Open...
          </button>
          <div className="h-px bg-zinc-800/40 mx-2 my-1" />
          <button
            onClick={() => handleAction('delete')}
            className="w-full text-left px-3 py-2 text-[11px] text-red-400 hover:bg-red-500/10 hover:text-red-300 flex items-center gap-2.5 transition-colors duration-100"
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

export default FileTree;
