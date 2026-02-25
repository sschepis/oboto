import { useEffect, useCallback } from 'react';
import { wsService } from '../services/wsService';
import type { EditorTab } from '../components/layout/TabBar';
import { CHAT_TAB } from './useTabManager';

export function useWorkspaceState(
  tabs: EditorTab[],
  activeTabId: string,
  setTabs: React.Dispatch<React.SetStateAction<EditorTab[]>>,
  setActiveTabId: React.Dispatch<React.SetStateAction<string>>,
  cwd: string | undefined,
  isConnected: boolean,
  setCwd: (path: string) => void
) {
  // 1. Listen for file-content events to restore state
  useEffect(() => {
    const unsub = wsService.on('file-content', (payload: unknown) => {
      const p = payload as { path: string, content: string };
      if (p.path === '.oboto/ui-state.json') {
        try {
          const state = JSON.parse(p.content);
          if (state.tabs && Array.isArray(state.tabs)) {
            // Restore tabs, filtering out duplicates or invalid ones
            const restoredTabs = state.tabs.filter((t: EditorTab) => t.id !== 'chat' && t.type);
            setTabs([CHAT_TAB, ...restoredTabs]);
            
            // Restore active tab
            if (state.activeTabId && state.activeTabId !== 'chat') {
              setActiveTabId(state.activeTabId);
            }
          }
        } catch (e) {
          console.error('Failed to parse workspace state:', e);
        }
      }
    });
    return unsub;
  }, [setTabs, setActiveTabId]);

  // 2. Trigger state load when CWD changes (and is confirmed by status update)
  useEffect(() => {
    if (cwd && isConnected) {
      // Request workspace state file
      wsService.readFile('.oboto/ui-state.json');
    }
  }, [cwd, isConnected]);

  const handleSwitchWorkspace = useCallback((newPath: string) => {
    // 1. Save current workspace state
    const currentState = {
      tabs: tabs.filter(t => t.id !== 'chat'),
      activeTabId: activeTabId
    };
    
    // Fire-and-forget save (server handles dir creation now)
    wsService.saveFile('.oboto/ui-state.json', JSON.stringify(currentState, null, 2));
    
    // 2. Close all non-chat tabs
    setTabs([CHAT_TAB]);
    setActiveTabId('chat');
    
    // 3. Switch workspace
    setCwd(newPath);
  }, [tabs, activeTabId, setCwd, setTabs, setActiveTabId]);

  return { handleSwitchWorkspace };
}
