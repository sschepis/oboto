import { useState, useEffect } from 'react';
import { wsService } from '../services/wsService';

export function useUIState() {
  const [showGlobalPalette, setShowGlobalPalette] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDirPicker, setShowDirPicker] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [showTaskManager, setShowTaskManager] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [showTaskSidebar, setShowTaskSidebar] = useState(false);
  const [workspacePort, setWorkspacePort] = useState<number | null>(null);

  // Sidebar resizing logic
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingSidebar) return;
      const newWidth = Math.max(240, Math.min(e.clientX, 600));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    if (isResizingSidebar) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

  // Listen for LLM auth errors — automatically open the Secrets panel
  useEffect(() => {
    const unsubAuth = wsService.on('llm-auth-error', (payload: unknown) => {
      const p = payload as { errorMessage: string; context: string; suggestion: string };
      console.error('[LLM Auth Error]', p.suggestion || p.errorMessage);
      // Open the secrets panel so the user can configure API keys
      setShowSecrets(true);
    });

    // Listen for workspace server info
    const unsubServer = wsService.on('workspace:server-info', (payload: unknown) => {
      const p = payload as { port: number };
      setWorkspacePort(p.port);
    });

    return () => {
      unsubAuth();
      unsubServer();
    };
  }, []);

  return {
    showGlobalPalette, setShowGlobalPalette,
    showSettings, setShowSettings,
    showDirPicker, setShowDirPicker,
    showShortcutsHelp, setShowShortcutsHelp,
    showTaskManager, setShowTaskManager,
    showTerminal, setShowTerminal,
    showSecrets, setShowSecrets,
    isLocked, setIsLocked,
    sidebarWidth, setSidebarWidth,
    isResizingSidebar, setIsResizingSidebar,
    showWizard, setShowWizard,
    showTaskSidebar, setShowTaskSidebar,
    workspacePort
  };
}
