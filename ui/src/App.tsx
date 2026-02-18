import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Moon, Download, Users, Settings, Zap, Activity, Code2, Trash2, HelpCircle, FlaskConical, KeyRound, Terminal, ListTodo, FileSearch, FileCode, Eraser, Keyboard, BookOpen, FolderOpen, FileText, Palette, RotateCcw } from 'lucide-react';
import Header from './components/layout/Header';
import MessageList from './components/chat/MessageList';
import InputArea from './components/chat/InputArea';
import GlobalPalette from './components/features/GlobalPalette';
import LockScreen from './components/features/LockScreen';
import Sidebar from './components/layout/Sidebar';
import SettingsDialog from './components/features/SettingsDialog';
import DirectoryPicker from './components/features/DirectoryPicker';
import TabBar, { type EditorTab } from './components/layout/TabBar';
import FileEditor, { type FileEditorHandle } from './components/features/FileEditor';
import HtmlPreview from './components/features/HtmlPreview';
import KeyboardShortcutsHelp from './components/features/KeyboardShortcutsHelp';
import TaskManagerPanel from './components/features/TaskManagerPanel';
import SecretsPanel from './components/features/SecretsPanel';
import GuakeTerminal from './components/features/GuakeTerminal';
import LogPanel from './components/features/LogPanel';
import { useChat } from './hooks/useChat';
import { useSurface, type SurfaceMeta } from './hooks/useSurface';
import { useSecrets } from './hooks/useSecrets';
import { SurfaceRenderer } from './components/features/SurfaceRenderer';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useTheme } from './hooks/useTheme';
import { wsService } from './services/wsService';
import type { MessageActions } from './components/chat/MessageItem';
import type { Command, Message } from './types';

import { ConfirmationDialog } from './components/features/ConfirmationDialog';
import { ScreenshotManager } from './components/features/ScreenshotManager';
import { AgentLoopControls } from './components/features/AgentLoopControls';
import { useAgentLoop } from './hooks/useAgentLoop';
import { ToastProvider } from './surface-kit/feedback/Toast';

const CHAT_TAB: EditorTab = { id: 'chat', label: 'Chat', type: 'chat' };

function App() {
  const { messages, isWorking, queueCount, send, stop, projectStatus, setCwd, nextSteps, settings, updateSettings, fileTree, deleteMessage, editAndRerun, rerunFromUser, regenerateFromAI, activityLog, allLogs, logPanelOpen, setLogPanelOpen, clearAllLogs, isConnected, openClawStatus, configureOpenClaw, deployOpenClaw, confirmationRequest, respondToConfirmation, selectedModel, setSelectedModel } = useChat();
  const { surfaces, loadedSurfaces, componentSources, loadSurface, renameSurface, deleteSurface, duplicateSurface } = useSurface();
  const { secrets } = useSecrets();
  const { status: agentLoopStatus, lastInvocation: agentLoopLastInvocation, play: agentLoopPlay, pause: agentLoopPause, stop: agentLoopStop, setInterval: agentLoopSetInterval } = useAgentLoop();
  // Dynamic UI theming — the hook listens for WS theme events and applies CSS vars
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { themeState, setTheme, resetToOriginal } = useTheme();

  // Tab state
  const [tabs, setTabs] = useState<EditorTab[]>([CHAT_TAB]);
  const [activeTabId, setActiveTabId] = useState('chat');

  // Workspace state persistence
  // 1. Listen for file-content events to restore state
  useEffect(() => {
    const unsub = wsService.on('file-content', (payload: unknown) => {
      const p = payload as { path: string, content: string };
      if (p.path === '.ai-man/ui-state.json') {
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
  }, []);

  // 2. Trigger state load when CWD changes (and is confirmed by status update)
  useEffect(() => {
    if (projectStatus?.cwd && isConnected) {
      // Request workspace state file
      wsService.readFile('.ai-man/ui-state.json');
    }
  }, [projectStatus?.cwd, isConnected]);

  const handleSwitchWorkspace = useCallback((newPath: string) => {
    // 1. Save current workspace state
    const currentState = {
      tabs: tabs.filter(t => t.id !== 'chat'),
      activeTabId: activeTabId
    };
    
    // Fire-and-forget save (server handles dir creation now)
    wsService.saveFile('.ai-man/ui-state.json', JSON.stringify(currentState, null, 2));
    
    // 2. Close all non-chat tabs
    setTabs([CHAT_TAB]);
    setActiveTabId('chat');
    
    // 3. Switch workspace
    setCwd(newPath);
  }, [tabs, activeTabId, setCwd]);
  
  const [showGlobalPalette, setShowGlobalPalette] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDirPicker, setShowDirPicker] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [showTaskManager, setShowTaskManager] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  // Refs for each open file editor, keyed by tab id (file path)
  const editorRefs = useRef<Record<string, FileEditorHandle | null>>({});

  // Ref for the chat input textarea
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Open a surface tab
  const handleSurfaceClick = useCallback((surfaceId: string) => {
    // If surfaces not loaded yet, we might not find it, but we can still try to open
    // We'll trust the ID exists or will be loaded
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

  // Auto-open new surfaces
  useEffect(() => {
    const unsub = wsService.on('surface-created', (payload: unknown) => {
      const surface = payload as SurfaceMeta;
      // We need to wait a tick or just open it directly
      // Since handleSurfaceClick relies on 'surfaces' state which is updated by useSurface hook independently,
      // we might have a race condition where surface name is unknown.
      // But we can pass the name from payload.
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
    
    // Also listen for surface-opened event
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

  // Derive tabs with dynamic labels (e.g. from loaded surfaces)
  const visibleTabs = useMemo(() => {
    return tabs.map(tab => {
      if (tab.type === 'surface' && tab.surfaceId && loadedSurfaces[tab.surfaceId]) {
        return { ...tab, label: loadedSurfaces[tab.surfaceId].name };
      }
      return tab;
    });
  }, [tabs, loadedSurfaces]);

  // Pin toggle handler
  const handlePinSurface = useCallback((id: string) => {
      // Toggle pin locally optimistically or call API
      // Since we don't have an API for pinning in this iteration, we'll implement it later
      // For now, we can just let the backend handle it if we add a tool, but SurfaceManager has togglePin.
      // Let's assume we can add a simple WS message or tool for it.
      // For now, just ignore or log.
      console.log('Toggle pin', id);
  }, []);

  const globalActions: Command[] = [
    { id: 'theme', label: 'Toggle Interface Theme', desc: 'Switch obsidian modes', icon: <Moon size={14} />, shortcut: 'T' },
    { id: 'export', label: 'Export Protocol Log', desc: 'Download as JSON', icon: <Download size={14} />, shortcut: 'E' },
    { id: 'agents', label: 'Manage Personas', desc: 'Reconfigure collaborators', icon: <Users size={14} />, shortcut: 'A' },
    { id: 'settings', label: 'System Settings', desc: 'Configure engine', icon: <Settings size={14} />, shortcut: '⌘,' },
    { id: 'deploy-openclaw', label: 'Deploy OpenClaw', desc: 'Start local gateway', icon: <Zap size={14} /> },
    { id: 'connect-openclaw', label: 'Connect to OpenClaw', desc: 'Configure external gateway', icon: <Settings size={14} /> },
    { id: 'secrets', label: 'Secrets Vault', desc: 'Manage API keys & secrets', icon: <KeyRound size={14} />, shortcut: 'K' },
    { id: 'tasks', label: 'Task Manager', desc: 'Track implementation', icon: <ListTodo size={14} />, shortcut: '⌘⇧T' },
    { id: 'terminal', label: 'Toggle Terminal', desc: 'Drop-down shell', icon: <Terminal size={14} />, shortcut: '⌘`' },
    { id: 'console', label: 'Toggle Console', desc: 'Server log console', icon: <Terminal size={14} />, shortcut: '⌘J' },
    { id: 'shortcuts', label: 'Keyboard Shortcuts', desc: 'View key bindings', icon: <Keyboard size={14} />, shortcut: '⌘/' },
    { id: 'workspace', label: 'Change Workspace', desc: 'Switch project directory', icon: <FolderOpen size={14} /> },
    { id: 'lock', label: 'Lock Terminal', desc: 'Secure session', icon: <Settings size={14} />, shortcut: 'L' },
    { id: 'clear', label: 'Clear Chat', desc: 'Wipe thread memory', icon: <Eraser size={14} /> },
    { id: 'theme-reset', label: 'Reset UI Style', desc: 'Restore original appearance', icon: <RotateCcw size={14} /> },
    { id: 'theme-cyberpunk', label: 'Theme: Cyberpunk', desc: 'Neon pink/purple palette', icon: <Palette size={14} /> },
    { id: 'theme-ocean', label: 'Theme: Ocean', desc: 'Deep blue/teal palette', icon: <Palette size={14} /> },
    { id: 'theme-sunset', label: 'Theme: Sunset', desc: 'Warm rose/gold palette', icon: <Palette size={14} /> },
    { id: 'theme-matrix', label: 'Theme: Matrix', desc: 'Green terminal palette', icon: <Palette size={14} /> },
    { id: 'theme-midnight', label: 'Theme: Midnight', desc: 'Default dark palette', icon: <Palette size={14} /> },
    { id: 'theme-arctic', label: 'Theme: Arctic', desc: 'Cool ice-blue palette', icon: <Palette size={14} /> },
    { id: 'theme-forest', label: 'Theme: Forest', desc: 'Green nature palette', icon: <Palette size={14} /> },
    { id: 'theme-lavender', label: 'Theme: Lavender', desc: 'Soft purple palette', icon: <Palette size={14} /> },
    { id: 'theme-ember', label: 'Theme: Ember', desc: 'Warm orange palette', icon: <Palette size={14} /> },
    { id: 'theme-monochrome', label: 'Theme: Monochrome', desc: 'Grayscale palette', icon: <Palette size={14} /> },
  ];

  const inlineCommands: Command[] = [
    { id: 'analyze', label: '/analyze', desc: 'Deep system diagnostic', icon: <Zap size={14} /> },
    { id: 'visualize', label: '/visualize', desc: 'Real-time neural map', icon: <Activity size={14} /> },
    { id: 'plan', label: '/plan', desc: 'Create implementation plan', icon: <FileText size={14} /> },
    { id: 'tasks', label: '/tasks', desc: 'Manage project tasks', icon: <ListTodo size={14} /> },
    { id: 'sandbox', label: '/sandbox', desc: 'Init UI prototype', icon: <Code2 size={14} /> },
    { id: 'survey', label: '/survey', desc: 'Insert decision survey', icon: <HelpCircle size={14} /> },
    { id: 'test', label: '/test', desc: 'Run tests & show results', icon: <FlaskConical size={14} /> },
    { id: 'lint', label: '/lint', desc: 'Run code linter', icon: <FileSearch size={14} /> },
    { id: 'format', label: '/format', desc: 'Format project code', icon: <FileCode size={14} /> },
    { id: 'doc', label: '/doc', desc: 'Generate documentation', icon: <BookOpen size={14} /> },
    { id: 'terminal', label: '/term', desc: 'Open terminal', icon: <Terminal size={14} /> },
    { id: 'console', label: '/console', desc: 'Toggle server console', icon: <Terminal size={14} /> },
    { id: 'clear', label: '/clear', desc: 'Wipe thread memory', icon: <Trash2 size={14} /> },
    { id: 'secrets', label: '/secrets', desc: 'Manage secrets', icon: <KeyRound size={14} /> },
    { id: 'settings', label: '/settings', desc: 'System settings', icon: <Settings size={14} /> },
    { id: 'shortcuts', label: '/shortcuts', desc: 'Keyboard shortcuts', icon: <Keyboard size={14} /> },
  ];

  // Derive the currently focused surface ID (if any) for chat context
  const focusedSurfaceId = useMemo(() => {
    const activeTab = tabs.find(t => t.id === activeTabId);
    return activeTab?.type === 'surface' ? activeTab.surfaceId : undefined;
  }, [tabs, activeTabId]);

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
  }, [send, handleSwitchWorkspace, deployOpenClaw, focusedSurfaceId, setLogPanelOpen, resetToOriginal, setTheme]);

  // Determine if a file should be opened as HTML preview
  const isHtmlFile = useCallback((filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    return ext === 'html' || ext === 'htm';
  }, []);

  // Determine if a file is a surface definition
  const isSurfaceFile = useCallback((filePath: string) => {
    return filePath.endsWith('.sur');
  }, []);

  // Open a file tab or focus it if already open
  const handleFileClick = useCallback((filePath: string) => {
    if (isSurfaceFile(filePath)) {
      // Extract ID from filename (assuming filename is {id}.sur)
      const fileName = filePath.split('/').pop() || '';
      const surfaceId = fileName.replace('.sur', '');
      handleSurfaceClick(surfaceId);
      return;
    }

    const htmlPreview = isHtmlFile(filePath);
    const tabId = htmlPreview ? `html-preview:${filePath}` : filePath;

    const existingTab = tabs.find(t => t.id === tabId);
    if (existingTab) {
      setActiveTabId(tabId);
    } else {
      const fileName = filePath.split('/').pop() || filePath;
      const newTab: EditorTab = {
        id: tabId,
        label: htmlPreview ? `▶ ${fileName}` : fileName,
        type: htmlPreview ? 'html-preview' : 'file',
        filePath,
        isDirty: false,
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(tabId);
    }
  }, [tabs, isHtmlFile, isSurfaceFile, handleSurfaceClick]);

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

  // -- Keyboard shortcut action callbacks --

  const saveActiveFile = useCallback(() => {
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab?.type === 'file') {
      editorRefs.current[activeTab.id]?.save();
    }
  }, [activeTabId, tabs]);

  const closeActiveTab = useCallback(() => {
    if (activeTabId !== 'chat') {
      handleCloseTab(activeTabId);
    }
  }, [activeTabId, handleCloseTab]);

  const focusChat = useCallback(() => {
    setActiveTabId('chat');
    // Slight delay to let tab switch render, then focus the textarea
    setTimeout(() => {
      chatInputRef.current?.focus();
    }, 50);
  }, []);

  const switchToTabByIndex = useCallback((index: number) => {
    if (index === 8) {
      // Cmd+9 goes to last tab
      if (tabs.length > 0) {
        setActiveTabId(tabs[tabs.length - 1].id);
      }
    } else if (index >= 0 && index < tabs.length) {
      setActiveTabId(tabs[index].id);
    }
  }, [tabs]);

  const nextTab = useCallback(() => {
    const currentIndex = tabs.findIndex(t => t.id === activeTabId);
    if (currentIndex < tabs.length - 1) {
      setActiveTabId(tabs[currentIndex + 1].id);
    } else {
      setActiveTabId(tabs[0].id); // wrap around
    }
  }, [tabs, activeTabId]);

  const prevTab = useCallback(() => {
    const currentIndex = tabs.findIndex(t => t.id === activeTabId);
    if (currentIndex > 0) {
      setActiveTabId(tabs[currentIndex - 1].id);
    } else {
      setActiveTabId(tabs[tabs.length - 1].id); // wrap around
    }
  }, [tabs, activeTabId]);

  // Register keyboard shortcuts
  const { shortcuts } = useKeyboardShortcuts({
    openPalette: useCallback(() => setShowGlobalPalette(p => !p), []),
    openSettings: useCallback(() => setShowSettings(true), []),
    closeActiveTab,
    saveActiveFile,
    focusChat,
    switchToTabByIndex,
    nextTab,
    prevTab,
    showShortcutsHelp: useCallback(() => setShowShortcutsHelp(p => !p), []),
    openTaskManager: useCallback(() => setShowTaskManager(p => !p), []),
    toggleTerminal: useCallback(() => setShowTerminal(p => !p), []),
    toggleConsole: useCallback(() => setLogPanelOpen(p => !p), [setLogPanelOpen]),
  });

  // -- Message action handlers --
  const handleCopyMessage = useCallback((message: Message) => {
    const text = message.content || '';
    navigator.clipboard.writeText(text).catch(() => {
      // Fallback for non-secure contexts
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    });
  }, []);

  const messageActions: MessageActions = useMemo(() => ({
    onCopy: handleCopyMessage,
    onDelete: deleteMessage,
    onRerun: rerunFromUser,
    onEditAndRerun: editAndRerun,
    onRegenerate: regenerateFromAI,
  }), [handleCopyMessage, deleteMessage, rerunFromUser, editAndRerun, regenerateFromAI]);

  const isChat = activeTabId === 'chat';

  return (
    <div className="flex h-screen w-full bg-[#080808] text-zinc-100 font-sans overflow-hidden relative">
      {isLocked && <LockScreen onUnlock={() => setIsLocked(false)} />}

      {/* Guake-style drop-down terminal */}
      <GuakeTerminal
        isVisible={showTerminal}
        onClose={() => setShowTerminal(false)}
      />
      
      {showGlobalPalette && (
        <GlobalPalette 
          isOpen={true} 
          onClose={() => setShowGlobalPalette(false)} 
          onSelect={(label) => {
            setShowGlobalPalette(false);
            handleSend(label);
          }}
          actions={globalActions}
        />
      )}

      <SettingsDialog
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onSave={updateSettings}
        openClawStatus={openClawStatus}
        onConfigureOpenClaw={configureOpenClaw}
        onDeployOpenClaw={deployOpenClaw}
        secrets={secrets}
        onOpenSecrets={() => setShowSecrets(true)}
      />

      <DirectoryPicker
        isOpen={showDirPicker}
        currentPath={projectStatus?.cwd}
        onSelect={(newPath) => handleSwitchWorkspace(newPath)}
        onClose={() => setShowDirPicker(false)}
      />

      <TaskManagerPanel
        isOpen={showTaskManager}
        onClose={() => setShowTaskManager(false)}
      />

      <SecretsPanel
        isOpen={showSecrets}
        onClose={() => setShowSecrets(false)}
      />

      <KeyboardShortcutsHelp
        isOpen={showShortcutsHelp}
        onClose={() => setShowShortcutsHelp(false)}
        shortcuts={shortcuts}
      />

      <ScreenshotManager />

      {confirmationRequest && (
        <ConfirmationDialog
          request={confirmationRequest}
          onConfirm={() => respondToConfirmation('approved')}
          onDeny={() => respondToConfirmation('denied')}
          onAlwaysAllow={() => respondToConfirmation('always-allow')}
        />
      )}

      <div className={`flex w-full relative h-full transition-all duration-700 ${isLocked ? 'blur-[40px] grayscale' : ''}`}>
        <main className="flex-1 flex flex-col relative h-full bg-[#080808] min-w-0">
          <Header
            isAgentWorking={isWorking}
            queuedMessageCount={queueCount}
            onOpenPalette={() => setShowGlobalPalette(true)}
            onWorkspaceClick={() => setShowDirPicker(true)}
            onOpenClawClick={() => setShowSettings(true)}
            activeWorkspace={projectStatus?.cwd}
            isConnected={isConnected}
          />

          {/* Agent Loop Controls */}
          <AgentLoopControls
            status={agentLoopStatus}
            lastInvocation={agentLoopLastInvocation}
            onPlay={agentLoopPlay}
            onPause={agentLoopPause}
            onStop={agentLoopStop}
            onSetInterval={agentLoopSetInterval}
          />

          {/* Tab Bar */}
          <TabBar
            tabs={visibleTabs}
            activeTabId={activeTabId}
            onSelectTab={setActiveTabId}
            onCloseTab={handleCloseTab}
          />

          {/* Tab Content */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
            {/* Chat panel — always rendered, hidden when not active */}
            <div className={`flex-1 flex flex-col min-h-0 ${isChat ? '' : 'hidden'}`}>
              <MessageList messages={messages} isAgentWorking={isWorking} messageActions={messageActions} activityLog={activityLog} />
            </div>

            {/* File editor panels — render each open file tab, show only active */}
            {tabs.filter(t => t.type === 'file').map(tab => (
              <div
                key={tab.id}
                className={`flex-1 flex flex-col ${activeTabId === tab.id ? '' : 'hidden'}`}
              >
                <FileEditor
                  ref={(handle) => {
                    if (handle) {
                      editorRefs.current[tab.id] = handle;
                    } else {
                      delete editorRefs.current[tab.id];
                    }
                  }}
                  filePath={tab.filePath!}
                  onDirtyChange={handleDirtyChange}
                />
              </div>
            ))}

            {/* HTML preview panels — render each open html-preview tab, show only active */}
            {tabs.filter(t => t.type === 'html-preview').map(tab => (
              <div
                key={tab.id}
                className={`flex-1 flex flex-col ${activeTabId === tab.id ? '' : 'hidden'}`}
              >
                <HtmlPreview
                  filePath={tab.filePath!}
                  onSwitchToEditor={handleSwitchToEditor}
                />
              </div>
            ))}

            {/* Surface panels */}
            {tabs.filter(t => t.type === 'surface').map(tab => (
              <div
                key={tab.id}
                className={`flex-1 flex flex-col w-full min-w-0 min-h-0 ${activeTabId === tab.id ? '' : 'hidden'}`}
              >
                <SurfaceRenderer
                  surfaceId={tab.surfaceId!}
                  data={loadedSurfaces[tab.surfaceId!] ?? null}
                  sources={componentSources}
                  onRefresh={() => loadSurface(tab.surfaceId!)}
                  onPinToggle={handlePinSurface}
                  onDelete={() => {
                      handleCloseTab(tab.id);
                  }}
                />
              </div>
            ))}

            <InputArea
              isAgentWorking={isWorking}
              onSend={handleSend}
              onStop={stop}
              commands={inlineCommands}
              suggestions={nextSteps}
              inputRef={chatInputRef}
              availableModels={settings?.modelRegistry || {}}
              selectedModel={selectedModel}
              onSelectModel={setSelectedModel}
            />
          </div>
        </main>

        <Sidebar 
          projectStatus={projectStatus} 
          fileTree={fileTree} 
          surfaces={surfaces}
          onFileClick={handleFileClick} 
          onSurfaceClick={handleSurfaceClick}
          onSurfaceRename={renameSurface}
          onSurfaceDelete={(surfaceId) => {
            deleteSurface(surfaceId);
            // Close any open tab for this surface
            const tabId = `surface:${surfaceId}`;
            handleCloseTab(tabId);
          }}
          onSurfaceDuplicate={duplicateSurface}
        />
      </div>

      {/* Console Log Panel — terminal-style slide-up log viewer */}
      <LogPanel
        logs={allLogs}
        isOpen={logPanelOpen}
        onClose={() => setLogPanelOpen(false)}
        onClear={clearAllLogs}
      />
      <ToastProvider />
    </div>
  );
}

export default App;
