import React, { useEffect, useState, useCallback } from 'react';
import { wsService } from '../../services/wsService';
import { Folder, FolderOpen, ChevronRight, ArrowUp, Loader2, X, Check, Plus } from 'lucide-react';

interface DirectoryPickerProps {
  isOpen: boolean;
  currentPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

const DirectoryPicker: React.FC<DirectoryPickerProps> = ({ isOpen, currentPath, onSelect, onClose }) => {
  const [browsePath, setBrowsePath] = useState(currentPath || '/');
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && currentPath) {
      setBrowsePath(currentPath);
    }
  }, [isOpen, currentPath]);

  const loadDirs = useCallback((dirPath: string) => {
    setLoading(true);
    setError(null);
    setDirs([]);
    setBrowsePath(dirPath);
    
    const timeoutId = setTimeout(() => {
      setLoading((prev) => {
        if (prev) {
          setError("Request timed out. Server may be unreachable.");
          return false;
        }
        return prev;
      });
    }, 5000);

    try {
      wsService.listDirs(dirPath);
    } catch {
      clearTimeout(timeoutId);
      setError("Failed to send request.");
      setLoading(false);
    }
    
    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const unsub = wsService.on('dir-list', (payload: unknown) => {
      const p = payload as { path: string; dirs: string[] };
      if (p.path === browsePath) {
        setDirs(p.dirs);
        setLoading(false);
      }
    });

    const unsubErr = wsService.on('error', (payload: unknown) => {
      const msg = payload as string;
      if (msg.includes('list dirs')) {
        setError(msg);
        setLoading(false);
      }
    });

    const unsubDirCreated = wsService.on('dir-created', () => {
      loadDirs(browsePath);
    });

    const cleanupTimeout = loadDirs(browsePath);

    return () => {
      unsub();
      unsubErr();
      unsubDirCreated();
      if (cleanupTimeout) cleanupTimeout();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, browsePath]);

  const goUp = () => {
    const parent = browsePath.replace(/\/[^/]+\/?$/, '') || '/';
    loadDirs(parent);
  };

  const navigateInto = (dirName: string) => {
    const newPath = browsePath === '/' ? `/${dirName}` : `${browsePath}/${dirName}`;
    loadDirs(newPath);
  };

  const handleCreateFolder = () => {
    const name = window.prompt("New Folder Name:");
    if (!name) return;
    
    const parent = browsePath.endsWith('/') ? browsePath : `${browsePath}/`;
    const newPath = `${parent}${name}`;
    
    wsService.createDir(newPath);
  };

  const handleSelect = () => {
    onSelect(browsePath);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  if (!isOpen) return null;

  // Breadcrumb segments
  const pathSegments = browsePath.split('/').filter(Boolean);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md animate-fade-in"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-[#0a0a0a] border border-zinc-800/60 rounded-2xl shadow-2xl shadow-black/50 w-full max-w-lg mx-4 flex flex-col max-h-[80vh] animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/40">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-zinc-200">Select Workspace Directory</h2>
            {/* Breadcrumb path */}
            <div className="flex items-center gap-1 mt-1.5 overflow-x-auto custom-scrollbar">
              <button 
                onClick={() => loadDirs('/')}
                className="text-[10px] text-zinc-500 hover:text-indigo-400 font-mono shrink-0 transition-colors duration-100"
              >
                /
              </button>
              {pathSegments.map((seg, i) => (
                <React.Fragment key={i}>
                  <ChevronRight size={8} className="text-zinc-700 shrink-0" />
                  <button 
                    onClick={() => loadDirs('/' + pathSegments.slice(0, i + 1).join('/'))}
                    className={`text-[10px] font-mono shrink-0 transition-colors duration-100 ${
                      i === pathSegments.length - 1 
                        ? 'text-indigo-400 font-semibold' 
                        : 'text-zinc-500 hover:text-indigo-400'
                    }`}
                  >
                    {seg}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 rounded-lg hover:bg-zinc-800/60 text-zinc-500 hover:text-zinc-300 transition-all duration-150 active:scale-90 ml-3 shrink-0"
          >
            <X size={14} />
          </button>
        </div>

        {/* Navigation bar */}
        <div className="flex items-center gap-2 px-5 py-2 border-b border-zinc-800/20 bg-zinc-900/10">
          <button
            onClick={goUp}
            disabled={browsePath === '/'}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold rounded-lg bg-zinc-800/30 hover:bg-zinc-700/30 text-zinc-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 active:scale-95 border border-zinc-800/30"
          >
            <ArrowUp size={11} />
            Up
          </button>
          <div className="flex-1" />
          <span className="text-[9px] text-zinc-600 tabular-nums">{dirs.length} items</span>
        </div>

        {/* Directory list */}
        <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[400px] custom-scrollbar">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 animate-fade-in">
              <Loader2 size={16} className="animate-spin text-indigo-400/50" />
              <span className="text-[10px] text-zinc-600 font-medium">Loading...</span>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center py-12 animate-fade-in">
              <span className="text-xs text-red-400/80">{error}</span>
            </div>
          )}

          {!loading && !error && dirs.length === 0 && (
            <div className="flex items-center justify-center py-12 animate-fade-in">
              <span className="text-[11px] text-zinc-600 italic">No subdirectories</span>
            </div>
          )}

          {!loading && !error && dirs.map((dir, idx) => (
            <button
              key={dir}
              onClick={() => navigateInto(dir)}
              className="flex items-center gap-2.5 w-full text-left px-5 py-2.5 hover:bg-zinc-800/30 transition-all duration-100 group animate-fade-in"
              style={{ animationDelay: `${idx * 0.015}s` }}
            >
              <Folder size={14} className="text-amber-500/50 shrink-0 group-hover:hidden transition-opacity duration-100" />
              <FolderOpen size={14} className="text-amber-500/60 shrink-0 hidden group-hover:block transition-opacity duration-100" />
              <span className="text-[12px] text-zinc-400 group-hover:text-zinc-200 truncate transition-colors duration-100">{dir}</span>
              <ChevronRight size={11} className="ml-auto text-zinc-800 group-hover:text-zinc-600 shrink-0 transition-colors duration-100" />
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800/40 bg-zinc-900/10 rounded-b-2xl">
          <span className="text-[10px] text-zinc-600 font-mono truncate max-w-[220px]">
            {browsePath}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreateFolder}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800/50 transition-all duration-150 active:scale-95 border border-zinc-800/30"
              title="Create New Folder"
            >
              <Plus size={11} />
              <span className="hidden sm:inline">New Folder</span>
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[10px] font-medium text-zinc-400 rounded-lg hover:bg-zinc-800/50 transition-all duration-150"
            >
              Cancel
            </button>
            <button
              onClick={handleSelect}
              className="flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-bold text-white rounded-lg bg-indigo-600 hover:bg-indigo-500 transition-all duration-150 shadow-lg shadow-indigo-600/20 active:scale-95"
            >
              <Check size={11} />
              Select
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DirectoryPicker;
