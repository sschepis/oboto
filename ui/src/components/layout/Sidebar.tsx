import FileTree from '../features/FileTree';
import SurfaceContextMenu, { type SurfaceContextMenuState } from '../features/SurfaceContextMenu';
import type { FileNode } from '../../hooks/useChat';
import type { SurfaceMeta } from '../../hooks/useSurface';
import type { ProjectStatusData } from '../features/ProjectStatus';
import { Activity, ChevronRight, FolderTree, GripVertical, LayoutDashboard, Pin } from 'lucide-react';
import { useState, useRef, useCallback } from 'react';
import ProjectStatus from '../features/ProjectStatus';

interface SidebarProps {
  projectStatus?: ProjectStatusData | null;
  fileTree?: FileNode[];
  surfaces?: SurfaceMeta[];
  onFileClick?: (filePath: string) => void;
  onSurfaceClick?: (surfaceId: string) => void;
  onSurfaceRename?: (surfaceId: string, newName: string) => void;
  onSurfaceDelete?: (surfaceId: string) => void;
  onSurfaceDuplicate?: (surfaceId: string) => void;
  width?: number;
}

const COLLAPSE_KEY = 'ai-man:sidebar-collapse-state';
const PANEL_ORDER_KEY = 'ai-man:sidebar-panel-order';

type PanelId = 'projectStatus' | 'surfaces' | 'files';
const DEFAULT_PANEL_ORDER: PanelId[] = ['projectStatus', 'surfaces', 'files'];

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

/** Section header button with drag handle */
const SectionHeader: React.FC<{
  icon: React.ReactNode;
  label: string;
  isCollapsed: boolean;
  onClick: () => void;
  badge?: React.ReactNode;
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}> = ({ icon, label, isCollapsed, onClick, badge, isDragging, isDragOver, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop }) => (
  <div
    draggable
    onDragStart={onDragStart}
    onDragEnd={onDragEnd}
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
    className={`
      flex items-center transition-all duration-200
      ${isDragging ? 'opacity-40' : ''}
      ${isDragOver ? 'border-t-2 border-indigo-500' : 'border-t-2 border-transparent'}
    `}
  >
    {/* Drag handle */}
    <div className="pl-2 pr-0.5 py-3 cursor-grab active:cursor-grabbing text-zinc-700 hover:text-zinc-500 transition-colors">
      <GripVertical size={11} />
    </div>
    <button 
      onClick={onClick}
      className="
        flex items-center justify-between flex-1 px-2 py-3
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
  </div>
);

const Sidebar: React.FC<SidebarProps> = ({
  projectStatus,
  fileTree = [],
  surfaces = [],
  onFileClick,
  onSurfaceClick,
  onSurfaceRename,
  onSurfaceDelete,
  onSurfaceDuplicate,
  width
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

  // Panel order state
  const [panelOrder, setPanelOrder] = useState<PanelId[]>(() => {
    try {
      const saved = localStorage.getItem(PANEL_ORDER_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as PanelId[];
        // Validate: must contain all default panels
        if (DEFAULT_PANEL_ORDER.every(p => parsed.includes(p))) {
          return parsed;
        }
      }
    } catch { /* use default */ }
    return [...DEFAULT_PANEL_ORDER];
  });

  // Drag state
  const [draggedPanel, setDraggedPanel] = useState<PanelId | null>(null);
  const [dragOverPanel, setDragOverPanel] = useState<PanelId | null>(null);
  const dragCounter = useRef<Record<string, number>>({});

  const toggleSection = (section: keyof CollapseState) => {
    setCollapseState(prev => {
      const next = { ...prev, [section]: !prev[section] };
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleDragStart = useCallback((panelId: PanelId) => (e: React.DragEvent) => {
    setDraggedPanel(panelId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', panelId);
    // Make the drag image semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedPanel(null);
    setDragOverPanel(null);
    dragCounter.current = {};
  }, []);

  const handleDragOver = useCallback((panelId: PanelId) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (panelId !== draggedPanel) {
      setDragOverPanel(panelId);
    }
  }, [draggedPanel]);

  const handleDragLeave = useCallback((panelId: PanelId) => (e: React.DragEvent) => {
    e.preventDefault();
    // Only clear if actually leaving the panel area
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const { clientX, clientY } = e;
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      if (dragOverPanel === panelId) {
        setDragOverPanel(null);
      }
    }
  }, [dragOverPanel]);

  const handleDrop = useCallback((targetPanelId: PanelId) => (e: React.DragEvent) => {
    e.preventDefault();
    const sourcePanelId = e.dataTransfer.getData('text/plain') as PanelId;
    if (!sourcePanelId || sourcePanelId === targetPanelId) {
      setDraggedPanel(null);
      setDragOverPanel(null);
      return;
    }

    setPanelOrder(prev => {
      const newOrder = [...prev];
      const sourceIdx = newOrder.indexOf(sourcePanelId);
      const targetIdx = newOrder.indexOf(targetPanelId);
      if (sourceIdx === -1 || targetIdx === -1) return prev;

      // Remove source and insert before target
      newOrder.splice(sourceIdx, 1);
      const insertIdx = newOrder.indexOf(targetPanelId);
      newOrder.splice(insertIdx, 0, sourcePanelId);

      localStorage.setItem(PANEL_ORDER_KEY, JSON.stringify(newOrder));
      return newOrder;
    });

    setDraggedPanel(null);
    setDragOverPanel(null);
  }, []);

  // Show loading skeleton if no project status
  if (!projectStatus) {
    return (
      <aside
        className="hidden xl:flex flex-col bg-[#080808] border-r border-zinc-800/40 p-6 space-y-6 overflow-y-auto custom-scrollbar"
        style={{ width: width || 320 }}
      >
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

  // Render a panel by its ID
  const renderPanel = (panelId: PanelId) => {
    const isLast = panelOrder.indexOf(panelId) === panelOrder.length - 1;

    switch (panelId) {
      case 'projectStatus':
        return (
          <div key={panelId} className={`flex flex-col ${!isLast ? 'border-b border-zinc-800/30' : 'flex-1 min-h-0'}`}>
            <SectionHeader
              icon={<Activity size={13} />}
              label="Project Status"
              isCollapsed={collapseState.projectStatus}
              onClick={() => toggleSection('projectStatus')}
              isDragging={draggedPanel === panelId}
              isDragOver={dragOverPanel === panelId}
              onDragStart={handleDragStart(panelId)}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver(panelId)}
              onDragLeave={handleDragLeave(panelId)}
              onDrop={handleDrop(panelId)}
            />
            <CollapsibleContent isOpen={!collapseState.projectStatus}>
              <div className="px-4 pb-4">
                <ProjectStatus data={projectStatus} />
              </div>
            </CollapsibleContent>
          </div>
        );

      case 'surfaces':
        if (surfaces.length === 0) return null;
        return (
          <div key={panelId} className={`flex flex-col ${!isLast ? 'border-b border-zinc-800/30' : 'flex-1 min-h-0'}`}>
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
              isDragging={draggedPanel === panelId}
              isDragOver={dragOverPanel === panelId}
              onDragStart={handleDragStart(panelId)}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver(panelId)}
              onDragLeave={handleDragLeave(panelId)}
              onDrop={handleDrop(panelId)}
            />
            <CollapsibleContent isOpen={!collapseState.surfaces}>
              <div className="px-4 pb-4 flex flex-col gap-1.5">
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
        );

      case 'files':
        return (
          <div key={panelId} className={`flex flex-col ${!isLast ? 'border-b border-zinc-800/30' : 'flex-1 min-h-0'}`}>
            <SectionHeader
              icon={<FolderTree size={13} />}
              label="Explorer"
              isCollapsed={collapseState.files}
              onClick={() => toggleSection('files')}
              isDragging={draggedPanel === panelId}
              isDragOver={dragOverPanel === panelId}
              onDragStart={handleDragStart(panelId)}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver(panelId)}
              onDragLeave={handleDragLeave(panelId)}
              onDrop={handleDrop(panelId)}
            />
            <CollapsibleContent isOpen={!collapseState.files}>
              <div className="px-4 pb-4 flex-1 min-h-0">
                <FileTree files={fileTree} onFileClick={onFileClick} />
              </div>
            </CollapsibleContent>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <aside
      className="hidden xl:flex flex-col bg-[#080808] border-r border-zinc-800/40 overflow-y-auto custom-scrollbar relative"
      style={{ width: width || 320 }}
    >
      {/* Subtle top-left gradient accent */}
      <div className="absolute top-0 left-0 w-32 h-32 bg-gradient-to-br from-indigo-500/[0.03] to-transparent pointer-events-none" />
      
      {/* Render panels in saved order */}
      {panelOrder.map(renderPanel)}

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
