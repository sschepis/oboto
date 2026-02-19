import { useCallback } from 'react';
import { wsService } from '../services/wsService';

interface SendHandlerDependencies {
  send: (text: string, contextId?: string) => void;
  setShowTaskManager: (v: boolean) => void;
  setShowTerminal: (v: boolean) => void;
  setLogPanelOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  setShowShortcutsHelp: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  setShowSecrets: (v: boolean) => void;
  setShowDirPicker: (v: boolean) => void;
  setIsLocked: (v: boolean) => void;
  deployOpenClaw: () => void;
  handleSwitchWorkspace: (path: string) => void;
  createConversation: (name: string) => void;
  setActiveTabId: (id: string) => void;
  setTheme: (theme: string) => void;
  resetToOriginal: () => void;
  focusedSurfaceId?: string;
}

export function useSendHandler({
  send,
  setShowTaskManager,
  setShowTerminal,
  setLogPanelOpen,
  setShowShortcutsHelp,
  setShowSettings,
  setShowSecrets,
  setShowDirPicker,
  setIsLocked,
  deployOpenClaw,
  handleSwitchWorkspace,
  createConversation,
  setActiveTabId,
  setTheme,
  resetToOriginal,
  focusedSurfaceId
}: SendHandlerDependencies) {
  
  const handleSend = useCallback((text: string) => {
    if (!text.trim()) return;
    
    // UI Commands
    if (text === '/tasks' || text === 'Task Manager') {
      setShowTaskManager(true);
      return;
    }
    if (text === '/term' || text === '/terminal' || text === 'Toggle Terminal') {
      setShowTerminal(true);
      return;
    }
    if (text === '/console' || text === 'Toggle Console') {
      setLogPanelOpen(p => !p);
      return;
    }
    if (text === '/shortcuts' || text === 'Keyboard Shortcuts') {
      setShowShortcutsHelp(true);
      return;
    }
    if (text === '/settings' || text === 'System Settings') {
      setShowSettings(true);
      return;
    }
    if (text === 'Deploy OpenClaw') {
      deployOpenClaw();
      return;
    }
    if (text === 'Connect to OpenClaw') {
      setShowSettings(true);
      return;
    }
    if (text === '/secrets' || text === 'Secrets Vault') {
      setShowSecrets(true);
      return;
    }
    if (text === '/workspace' || text === 'Change Workspace') {
      setShowDirPicker(true);
      return;
    }
    if (text === '/clear' || text === 'Clear Chat') {
      send('/clear');
      return;
    }

    // Directives mappings
    if (text === '/lint') {
      send('Directive: Run Linter');
      return;
    }
    if (text === '/format') {
      send('Directive: Format Project');
      return;
    }
    if (text === '/doc') {
      send('Directive: Generate Documentation');
      return;
    }
    if (text === '/plan') {
      send('Directive: Create Implementation Plan');
      return;
    }

    // Handle global palette labels that should be directives
    if (['Toggle Interface Theme', 'Export Protocol Log', 'Manage Personas'].includes(text)) {
      send(`Directive: ${text}`);
      return;
    }

    // Theme commands from palette
    if (text === 'Reset UI Style') {
      resetToOriginal();
      return;
    }
    const themeMatch = text.match(/^Theme: (.+)$/);
    if (themeMatch) {
      setTheme(themeMatch[1].toLowerCase());
      return;
    }

    // /new-chat [optional name] — create and switch to a new conversation
    if (text === '/new-chat' || text.startsWith('/new-chat ')) {
      const name = text.substring(10).trim() || `chat-${Date.now().toString(36)}`;
      createConversation(name);
      setActiveTabId('chat');
      return;
    }

    if (text.startsWith('/cd ')) {
      const newPath = text.substring(4).trim();
      if (newPath) {
        handleSwitchWorkspace(newPath);
      }
      return;
    }

    // /test [optional custom command]
    if (text === '/test' || text.startsWith('/test ')) {
      const customCmd = text.substring(5).trim() || undefined;
      wsService.runTests(customCmd);
      return;
    }

    if (text.startsWith('Directive:') || text === '/lock' || text === 'Lock Terminal') {
      if (text.includes('Lock Terminal') || text === '/lock') {
        setIsLocked(true);
        return;
      }
    }
    
    send(text, focusedSurfaceId);
  }, [
    send, 
    setShowTaskManager, 
    setShowTerminal, 
    setLogPanelOpen, 
    setShowShortcutsHelp, 
    setShowSettings, 
    setShowSecrets, 
    setShowDirPicker, 
    setIsLocked, 
    deployOpenClaw, 
    handleSwitchWorkspace, 
    createConversation, 
    setActiveTabId, 
    setTheme, 
    resetToOriginal, 
    focusedSurfaceId
  ]);

  return { handleSend };
}
