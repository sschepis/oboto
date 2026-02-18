import React, { useState } from 'react';
import { LayoutDashboard, Pin, ChevronRight, FolderTree, Activity } from 'lucide-react';
import ProjectStatus, { type ProjectStatusData } from '../features/ProjectStatus';
import FileTree from '../features/FileTree';
import SurfaceContextMenu, { type SurfaceContextMenuState } from '../features/SurfaceContextMenu';
import type { FileNode } from '../../hooks/useChat';
import type { SurfaceMeta } from '../../hooks/useSurface';

interface SidebarProps {
  projectStatus?: ProjectStatusData | null;
  fileTree?: FileNode[];
  surfaces?: SurfaceMeta[];
  onFileClick?: (filePath: string) => void;
  onSurfaceClick?: (surfaceId: string) => void;
  onSurfaceRename?: (surfaceId: string, newName: string) => void;
  onSurfaceDelete?: (surfaceId: string) => void;
  onSurfaceDuplicate?: (surfaceId: string) => void;
}

const COLLAPSE_KEY = 'ai-man:sidebar-collapse-state';

interface CollapseState {
  projectStatus: boolean;
  surfaces: boolean;
  files: boolean;
}

/** Animated collapsible wrapper */
const CollapsibleContent: React.FC<{ isOpen: boolean; children: React.ReactNode }> = ({ isOpen, children }) => (
  <div
    className={`
      grid transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
      ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}
    `}
  >
    <div className="overflow-hidden">
      {children}
    </div>
  </div>
);

/** Section header button */
const SectionHeader: React.FC<{
  icon: React.ReactNode;
  label: string;
  isCollapsed: boolean;
  onClick: () => void;
  badge?: React.ReactNode;
}> = ({ icon, label, isCollapsed, onClick, badge }) => (
  <button 
    onClick={onClick}
    className="
      flex items-center justify-between px-4 py-3 w-full
      text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/20
      transition-all duration-200 group
    "
  >
    <div className="flex items-center gap-2">
      <span className="transition-colors duration-200 group-hover:text-indigo-400">
        {icon}
      </span>
      <span className="text-[10px] font-bold uppercase tracking-[0.15em]">{label}</span>
      {badge}
    </div>
    <div className={`transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}>
      <ChevronRight size={13} className="text-zinc-600" />
    </div>
  </button>
);

const Sidebar: React.FC<SidebarProps> = ({
  projectStatus,
  fileTree = [],
  surfaces = [],
  onFileClick,
  onSurfaceClick,
  onSurfaceRename,
  onSurfaceDelete,
  onSurfaceDuplicate
}) => {
  const [showAllSurfaces, setShowAllSurfaces] = useState(true);
  const [contextMenu, setContextMenu] = useState<SurfaceContextMenuState | null>(null);

  const handleSurfaceContextMenu = (e: React.MouseEvent, surface: SurfaceMeta) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      surfaceId: surface.id,
      surfaceName: surface.name,
      x: e.clientX,
      y: e.clientY,
    });
  };
  
  // Collapse state
  const [collapseState, setCollapseState] = useState<CollapseState>(() => {
    try {
      const saved = localStorage.getItem(COLLAPSE_KEY);
      return saved ? JSON.parse(saved) : {
        projectStatus: false,
        surfaces: false,
        files: false
      };
    } catch {
      return {
        projectStatus: false,
        surfaces: false,
        files: false
      };
    }
  });

  const toggleSection = (section: keyof CollapseState) => {
    setCollapseState(prev => {
      const next = { ...prev, [section]: !prev[section] };
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Show loading skeleton if no project status
  if (!projectStatus) {
    return (
      <aside className="hidden xl:flex flex-col w-80 bg-[#080808] border-l border-zinc-800/40 p-6 space-y-6 overflow-y-auto custom-scrollbar">
        <div className="space-y-4">
          <div className="h-20 bg-zinc-900/30 rounded-xl shimmer"></div>
          <div className="space-y-2">
            <div className="h-4 bg-zinc-900/30 rounded w-1/3 shimmer" style={{ animationDelay: '0.1s' }}></div>
            <div className="h-8 bg-zinc-900/30 rounded shimmer" style={{ animationDelay: '0.2s' }}></div>
            <div className="h-8 bg-zinc-900/30 rounded shimmer" style={{ animationDelay: '0.3s' }}></div>
          </div>
          <div className="flex-1 bg-zinc-900/30 rounded-xl h-64 shimmer" style={{ animationDelay: '0.4s' }}></div>
        </div>
      </aside>
    );
  }

  const pinnedSurfaces = surfaces.filter(s => s.pinned);
  const otherSurfaces = surfaces.filter(s => !s.pinned);

  return (
    <aside className="hidden xl:flex flex-col w-80 bg-[#080808] border-l border-zinc-800/40 overflow-y-auto custom-scrollbar relative">
      {/* Subtle top-left gradient accent */}
      <div className="absolute top-0 left-0 w-32 h-32 bg-gradient-to-br from-indigo-500/[0.03] to-transparent pointer-events-none" />
      
      {/* Project Status Section */}
      <div className="flex flex-col border-b border-zinc-800/30">
        <SectionHeader
          icon={<Activity size={13} />}
          label="Project Status"
          isCollapsed={collapseState.projectStatus}
          onClick={() => toggleSection('projectStatus')}
        />
        
        <CollapsibleContent isOpen={!collapseState.projectStatus}>
          <div className="px-4 pb-4">
            <ProjectStatus data={projectStatus} />
          </div>
        </CollapsibleContent>
      </div>

      {/* Surfaces Section */}
      {surfaces.length > 0 && (
        <div className="flex flex-col border-b border-zinc-800/30">
          <SectionHeader
            icon={<LayoutDashboard size={13} />}
            label="Surfaces"
            isCollapsed={collapseState.surfaces}
            onClick={() => toggleSection('surfaces')}
            badge={
              <span className="text-[9px] font-mono text-zinc-600 bg-zinc-900/50 px-1.5 py-0.5 rounded-md">
                {surfaces.length}
              </span>
            }
          />
          
          <CollapsibleContent isOpen={!collapseState.surfaces}>
            <div className="px-4 pb-4 flex flex-col gap-1.5">
              {/* Pinned Surfaces */}
              {pinnedSurfaces.map(surface => (
                <button
                  key={surface.id}
                  onClick={() => onSurfaceClick?.(surface.id)}
                  onContextMenu={(e) => handleSurfaceContextMenu(e, surface)}
                  className="
                    flex items-center gap-2 px-2.5 py-2 text-[11px] text-zinc-300
                    hover:text-white hover:bg-indigo-500/5 rounded-lg
                    transition-all duration-200 group text-left
                    border border-transparent hover:border-indigo-500/10
                  "
                >
                  <Pin size={11} className="text-indigo-400 shrink-0 transition-transform duration-200 group-hover:scale-110" />
                  <span className="truncate font-medium">{surface.name}</span>
                </button>
              ))}

              {/* All Surfaces Group */}
              {otherSurfaces.length > 0 && (
                <div className="mt-1">
                  <button
                    onClick={() => setShowAllSurfaces(!showAllSurfaces)}
                    className="
                      flex items-center gap-1 px-2 py-1 text-[10px] text-zinc-500
                      hover:text-zinc-300 transition-all duration-200 w-full text-left
                    "
                  >
                    <span className={`transition-transform duration-200 ${showAllSurfaces ? 'rotate-90' : ''}`}>
                      <ChevronRight size={11} />
                    </span>
                    <span>All Surfaces</span>
                  </button>
                  
                  <CollapsibleContent isOpen={showAllSurfaces}>
                    <div className="ml-2 mt-1 pl-2 border-l border-zinc-800/40 flex flex-col gap-0.5">
                      {otherSurfaces.map(surface => (
                        <button
                          key={surface.id}
                          onClick={() => onSurfaceClick?.(surface.id)}
                          onContextMenu={(e) => handleSurfaceContextMenu(e, surface)}
                          className="
                            flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-zinc-400
                            hover:text-white hover:bg-zinc-800/40 rounded-lg
                            transition-all duration-200 group text-left
                          "
                        >
                          <LayoutDashboard size={11} className="text-zinc-600 group-hover:text-zinc-400 shrink-0 transition-colors duration-200" />
                          <span className="truncate">{surface.name}</span>
                        </button>
                      ))}
                    </div>
                  </CollapsibleContent>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </div>
      )}

      {/* File Tree Section */}
      <div className="flex flex-col flex-1 min-h-0">
        <SectionHeader
          icon={<FolderTree size={13} />}
          label="Explorer"
          isCollapsed={collapseState.files}
          onClick={() => toggleSection('files')}
        />
        
        <CollapsibleContent isOpen={!collapseState.files}>
          <div className="px-4 pb-4 flex-1 min-h-0">
            <FileTree files={fileTree} onFileClick={onFileClick} />
          </div>
        </CollapsibleContent>
      </div>
      {/* Surface Context Menu */}
      {contextMenu && (
        <SurfaceContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onRename={(id, name) => onSurfaceRename?.(id, name)}
          onDelete={(id) => onSurfaceDelete?.(id)}
          onDuplicate={(id) => onSurfaceDuplicate?.(id)}
        />
      )}
    </aside>
  );
};

export default Sidebar;
