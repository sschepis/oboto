import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type { EditorTab } from '../components/layout/TabBar';
import { wsService } from '../services/wsService';
import type { SurfaceMeta, SurfaceData } from './useSurface';
import type { FileEditorHandle } from '../components/features/FileEditor';
import type { ConversationInfo } from './useChat';

export const CHAT_TAB: EditorTab = { id: 'chat', label: 'Chat', type: 'chat' };

export function useTabManager(
  surfaces: SurfaceMeta[],
  loadedSurfaces: Record<string, SurfaceData>,
  loadSurface: (id: string) => void,
  conversations: ConversationInfo[],
  createConversation: (name: string) => void
) {
  const [tabs, setTabs] = useState<EditorTab[]>([CHAT_TAB]);
  const [activeTabId, setActiveTabId] = useState('chat');
  
  // Refs for each open file editor, keyed by tab id (file path)
  const editorRefs = useRef<Record<string, FileEditorHandle | null>>({});

  // Derive tabs with dynamic labels (e.g. from loaded surfaces)
  const visibleTabs = useMemo(() => {
    return tabs.map(tab => {
      if (tab.type === 'surface' && tab.surfaceId && loadedSurfaces[tab.surfaceId]) {
        return { ...tab, label: loadedSurfaces[tab.surfaceId].name };
      }
      return tab;
    });
  }, [tabs, loadedSurfaces]);

  // Open a surface tab
  const handleSurfaceClick = useCallback((surfaceId: string) => {
    const surface = surfaces.find(s => s.id === surfaceId);
    const label = surface ? surface.name : 'Surface'; // Fallback label
    
    const tabId = `surface:${surfaceId}`;
    const existingTab = tabs.find(t => t.id === tabId);
    
    // Always load fresh data
    loadSurface(surfaceId);

    if (existingTab) {
      setActiveTabId(tabId);
    } else {
      setTabs(prev => [...prev, {
        id: tabId,
        label,
        type: 'surface',
        surfaceId
      }]);
      setActiveTabId(tabId);
    }
  }, [tabs, surfaces, loadSurface]);

  // Auto-open new surfaces / listen for surface events
  useEffect(() => {
    const unsub = wsService.on('surface-created', (payload: unknown) => {
      const surface = payload as SurfaceMeta;
      const tabId = `surface:${surface.id}`;
      
      setTabs(prev => {
        if (prev.find(t => t.id === tabId)) return prev;
        return [...prev, {
          id: tabId,
          label: surface.name,
          type: 'surface',
          surfaceId: surface.id
        }];
      });
      setActiveTabId(tabId);
      loadSurface(surface.id);
    });
    
    const unsubOpen = wsService.on('surface-opened', (payload: unknown) => {
      const { surfaceId, surface } = payload as { surfaceId: string, surface: SurfaceMeta };
      const tabId = `surface:${surfaceId}`;
      
      setTabs(prev => {
        if (prev.find(t => t.id === tabId)) return prev;
        return [...prev, {
          id: tabId,
          label: surface ? surface.name : 'Surface',
          type: 'surface',
          surfaceId: surfaceId
        }];
      });
      setActiveTabId(tabId);
      loadSurface(surfaceId);
    });

    return () => {
        unsub();
        unsubOpen();
    };
  }, [loadSurface]);

  // Determine if a file should be opened as HTML preview
  const isHtmlFile = useCallback((filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    return ext === 'html' || ext === 'htm';
  }, []);

  // Determine if a file is an image
  const isImageFile = useCallback((filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext);
  }, []);

  // Determine if a file is a PDF
  const isPdfFile = useCallback((filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    return ext === 'pdf';
  }, []);

  // Determine if a file is a surface definition
  const isSurfaceFile = useCallback((filePath: string) => {
    return filePath.endsWith('.sur');
  }, []);

  // Open a file tab or focus it if already open
  const handleFileClick = useCallback((filePath: string) => {
    if (isSurfaceFile(filePath)) {
      const fileName = filePath.split('/').pop() || '';
      const surfaceId = fileName.replace('.sur', '');
      handleSurfaceClick(surfaceId);
      return;
    }

    const htmlPreview = isHtmlFile(filePath);
    const imagePreview = isImageFile(filePath);
    const pdfPreview = isPdfFile(filePath);
    const tabId = htmlPreview ? `html-preview:${filePath}` : filePath;

    const existingTab = tabs.find(t => t.id === tabId);
    if (existingTab) {
      setActiveTabId(tabId);
    } else {
      const fileName = filePath.split('/').pop() || filePath;
      const newTab: EditorTab = {
        id: tabId,
        label: htmlPreview ? `▶ ${fileName}` : fileName,
        type: htmlPreview ? 'html-preview' : imagePreview ? 'image' : pdfPreview ? 'pdf' : 'file',
        filePath,
        isDirty: false,
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(tabId);
    }
  }, [tabs, isHtmlFile, isImageFile, isPdfFile, isSurfaceFile, handleSurfaceClick]);

  // Switch from HTML preview to code editor for the same file
  const handleSwitchToEditor = useCallback((filePath: string) => {
    const editorTabId = filePath;
    const existingTab = tabs.find(t => t.id === editorTabId);
    if (existingTab) {
      setActiveTabId(editorTabId);
    } else {
      const fileName = filePath.split('/').pop() || filePath;
      const newTab: EditorTab = {
        id: editorTabId,
        label: fileName,
        type: 'file',
        filePath,
        isDirty: false,
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(editorTabId);
    }
  }, [tabs]);

  // Close a file tab
  const handleCloseTab = useCallback((tabId: string) => {
    if (tabId === 'chat') return; // Can't close chat
    // Clean up editor ref
    delete editorRefs.current[tabId];
    setTabs(prev => prev.filter(t => t.id !== tabId));
    // If closing the active tab, switch to the previous tab or chat
    if (activeTabId === tabId) {
      const currentTabs = tabs.filter(t => t.id !== tabId);
      const closedIndex = tabs.findIndex(t => t.id === tabId);
      if (currentTabs.length === 0) {
        setActiveTabId('chat');
      } else {
        const newIndex = Math.min(closedIndex, currentTabs.length - 1);
        setActiveTabId(currentTabs[Math.max(0, newIndex)].id);
      }
    }
  }, [activeTabId, tabs]);

  // Track dirty state for file tabs
  const handleDirtyChange = useCallback((filePath: string, isDirty: boolean) => {
    setTabs(prev => prev.map(t => 
      t.id === filePath ? { ...t, isDirty } : t
    ));
  }, []);

  const handleNewChat = useCallback(() => {
    // Generate name: "New Conversation X"
    const prefix = 'New Conversation ';
    let max = 0;
    for (const c of conversations) {
      if (c.name.startsWith(prefix)) {
        const numStr = c.name.substring(prefix.length);
        const num = parseInt(numStr, 10);
        if (!isNaN(num) && num > max) {
          max = num;
        }
      }
    }
    const name = `${prefix}${max + 1}`;
    
    createConversation(name);
    // Switch to chat tab
    setActiveTabId('chat');
  }, [createConversation, conversations]);

  const handleNewFile = useCallback(() => {
    // Create an untitled file tab (not saved to disk until user saves)
    const untitledIndex = tabs.filter(t => t.label.startsWith('Untitled')).length + 1;
    const label = `Untitled-${untitledIndex}`;
    const tabId = `untitled:${Date.now()}`;
    const newTab: EditorTab = {
      id: tabId,
      label,
      type: 'file',
      filePath: label,
      isDirty: true,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(tabId);
  }, [tabs]);

  const handleNewSurface = useCallback(() => {
    const name = `Surface ${surfaces.length + 1}`;
    wsService.createSurface(name);
    // The surface-created event listener will auto-open the tab
  }, [surfaces]);

  // Pin toggle handler
  const handlePinSurface = useCallback((id: string) => {
      // TODO: Implement pin logic
      console.log('Toggle pin', id);
  }, []);

  return {
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    editorRefs,
    visibleTabs,
    handleFileClick,
    handleSurfaceClick,
    handleSwitchToEditor,
    handleCloseTab,
    handleDirtyChange,
    handleNewChat,
    handleNewFile,
    handleNewSurface,
    handlePinSurface,
    CHAT_TAB // Export for workspace state restoration usage
  };
}
