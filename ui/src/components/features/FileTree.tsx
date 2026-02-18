import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, Folder, FileText, FolderOpen, Copy, Trash2, ExternalLink, Files } from 'lucide-react';
import type { FileNode } from '../../hooks/useChat';
import { wsService } from '../../services/wsService';

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  parentPath: string;
  onFileClick?: (filePath: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, type: 'file' | 'directory') => void;
}

const FileTreeNode: React.FC<FileTreeNodeProps> = ({ node, depth, parentPath, onFileClick, onContextMenu }) => {
  const [isOpen, setIsOpen] = useState(depth < 1);
  const isDir = node.type === 'directory';
  const hasChildren = isDir && node.children && node.children.length > 0;
  const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;

  const handleClick = () => {
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
      default: return 'text-zinc-600';
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className="flex items-center gap-1.5 w-full text-left py-[3px] px-1 rounded-md hover:bg-zinc-800/40 transition-all duration-100 group cursor-pointer relative"
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
              className={`text-zinc-600 shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`} 
            />
            {isOpen ? (
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
        <span className={`text-[10px] truncate transition-colors duration-100 ${
          isDir 
            ? 'text-zinc-400 font-medium group-hover:text-zinc-300' 
            : 'text-zinc-500 group-hover:text-zinc-400'
        }`}>
          {node.name}
        </span>
      </button>
      
      {/* Children with collapse transition */}
      {isDir && hasChildren && (
        <div className={`overflow-hidden transition-all duration-150 ${isOpen ? 'max-h-[9999px] opacity-100' : 'max-h-0 opacity-0'}`}>
          {node.children!.map((child, i) => (
            <FileTreeNode 
              key={`${child.name}-${i}`} 
              node={child} 
              depth={depth + 1} 
              parentPath={fullPath} 
              onFileClick={onFileClick}
              onContextMenu={onContextMenu}
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
  const menuRef = useRef<HTMLDivElement>(null);

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

  const handleAction = async (action: 'open' | 'copy-path' | 'duplicate' | 'delete') => {
    if (!contextMenu) return;
    const { path } = contextMenu;
    setContextMenu(null);

    switch (action) {
      case 'open':
        onFileClick?.(path);
        break;
      case 'copy-path':
        try {
          await navigator.clipboard.writeText(path);
        } catch (err) {
          console.error('Failed to copy path', err);
        }
        break;
      case 'duplicate': {
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
        if (window.confirm(`Are you sure you want to delete ${path}?`)) {
          wsService.deleteFile(path);
        }
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
    <div className="space-y-0 relative">
      <h4 className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.15em] mb-2 px-1">
        Workspace Files
      </h4>
      <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
        {files.map((node, i) => (
          <FileTreeNode 
            key={`${node.name}-${i}`} 
            node={node} 
            depth={0} 
            parentPath="" 
            onFileClick={onFileClick}
            onContextMenu={handleContextMenu}
          />
        ))}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 w-48 bg-[#0e0e0e] border border-zinc-800/60 rounded-xl shadow-2xl shadow-black/50 py-1 animate-scale-in overflow-hidden"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.type === 'file' && (
            <button
              onClick={() => handleAction('open')}
              className="w-full text-left px-3 py-2 text-[11px] text-zinc-300 hover:bg-zinc-800/50 hover:text-white flex items-center gap-2.5 transition-colors duration-100"
            >
              <ExternalLink size={12} className="text-zinc-500" />
              Open
            </button>
          )}
          <button
            onClick={() => handleAction('copy-path')}
            className="w-full text-left px-3 py-2 text-[11px] text-zinc-300 hover:bg-zinc-800/50 hover:text-white flex items-center gap-2.5 transition-colors duration-100"
          >
            <Copy size={12} className="text-zinc-500" />
            Copy Path
          </button>
          <button
            onClick={() => handleAction('duplicate')}
            className="w-full text-left px-3 py-2 text-[11px] text-zinc-300 hover:bg-zinc-800/50 hover:text-white flex items-center gap-2.5 transition-colors duration-100"
          >
            <Files size={12} className="text-zinc-500" />
            Duplicate
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
