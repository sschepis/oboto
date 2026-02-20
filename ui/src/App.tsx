import { useRef, useMemo } from 'react';
import Header from './components/layout/Header';
import StatusBar from './components/layout/StatusBar';
import MessageList from './components/chat/MessageList';
import InputArea from './components/chat/InputArea';
import GlobalPalette from './components/features/GlobalPalette';
import LockScreen from './components/features/LockScreen';
import Sidebar from './components/layout/Sidebar';
import SettingsDialog from './components/features/SettingsDialog';
import DirectoryPicker from './components/features/DirectoryPicker';
import TabBar from './components/layout/TabBar';
import FileEditor from './components/features/FileEditor';
import ImageViewer from './components/features/ImageViewer';
import PdfViewer from './components/features/PdfViewer';
import HtmlPreview from './components/features/HtmlPreview';
import KeyboardShortcutsHelp from './components/features/KeyboardShortcutsHelp';
import TaskManagerPanel from './components/features/TaskManagerPanel';
import TaskSidebar from './components/layout/TaskSidebar';
import SecretsPanel from './components/features/SecretsPanel';
import GuakeTerminal from './components/features/GuakeTerminal';
import LogPanel from './components/features/LogPanel';
import { useChat } from './hooks/useChat';
import { useSurface } from './hooks/useSurface';
import { useSecrets } from './hooks/useSecrets';
import { SurfaceRenderer } from './components/features/SurfaceRenderer';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useTheme } from './hooks/useTheme';
import { useDisplayNames } from './hooks/useDisplayNames';
import { ConfirmationDialog } from './components/features/ConfirmationDialog';
import { ScreenshotManager } from './components/features/ScreenshotManager';
import { useAgentLoop } from './hooks/useAgentLoop';
import { ToastProvider } from './surface-kit/feedback/Toast';
import SetupWizard from './components/features/SetupWizard';
import { useSetupWizard } from './hooks/useSetupWizard';
import { useSkills } from './hooks/useSkills';

import { useTabManager } from './hooks/useTabManager';
import { useWorkspaceState } from './hooks/useWorkspaceState';
import { useUIState } from './hooks/useUIState';
import { useMessageActions } from './hooks/useMessageActions';
import { useSendHandler } from './hooks/useSendHandler';
import { globalActions, inlineCommands } from './constants/commands';

function App() {
  // Core Domain Hooks
  const { 
    messages, isWorking, queueCount, send, stop, projectStatus, setCwd, nextSteps, 
    settings, updateSettings, fileTree, deleteMessage, editAndRerun, rerunFromUser, 
    regenerateFromAI, activityLog, allLogs, logPanelOpen, setLogPanelOpen, clearAllLogs, 
    isConnected, openClawStatus, configureOpenClaw, deployOpenClaw, confirmationRequest, 
    respondToConfirmation, selectedModel, setSelectedModel, conversations, activeConversation, 
    createConversation, switchConversation, deleteConversation, renameConversation 
  } = useChat();

  const { 
    surfaces, loadedSurfaces, componentSources, loadSurface, renameSurface, 
    deleteSurface, duplicateSurface 
  } = useSurface();

  const { secrets } = useSecrets();
  
  const { 
    status: agentLoopStatus, lastInvocation: agentLoopLastInvocation, 
    play: agentLoopPlay, pause: agentLoopPause, stop: agentLoopStop, 
    setInterval: agentLoopSetInterval 
  } = useAgentLoop();

  const { setTheme, resetToOriginal } = useTheme();
  const { userLabel, agentLabel } = useDisplayNames();
  const { isFirstRun, isLoading: setupLoading } = useSetupWizard();

  const skills = useSkills();

  // New Refactored Hooks
  const ui = useUIState();
  
  const tabManager = useTabManager(
    surfaces, 
    loadedSurfaces, 
    loadSurface, 
    conversations, 
    createConversation
  );
  
  const workspace = useWorkspaceState(
    tabManager.tabs, 
    tabManager.activeTabId, 
    tabManager.setTabs, 
    tabManager.setActiveTabId, 
    projectStatus?.cwd, 
    isConnected, 
    setCwd
  );

  const { messageActions } = useMessageActions({ 
    deleteMessage, 
    rerunFromUser, 
    editAndRerun, 
    regenerateFromAI 
  });

  const focusedSurfaceId = useMemo(() => {
    const activeTab = tabManager.tabs.find(t => t.id === tabManager.activeTabId);
    return activeTab?.type === 'surface' ? activeTab.surfaceId : undefined;
  }, [tabManager.tabs, tabManager.activeTabId]);

  const { handleSend } = useSendHandler({
    send,
    setShowTaskManager: ui.setShowTaskManager,
    setShowTerminal: ui.setShowTerminal,
    setLogPanelOpen, // From useChat
    setShowShortcutsHelp: ui.setShowShortcutsHelp,
    setShowSettings: ui.setShowSettings,
    setShowSecrets: ui.setShowSecrets,
    setShowDirPicker: ui.setShowDirPicker,
    setIsLocked: ui.setIsLocked,
    deployOpenClaw,
    handleSwitchWorkspace: workspace.handleSwitchWorkspace,
    createConversation,
    setActiveTabId: tabManager.setActiveTabId,
    setTheme,
    resetToOriginal,
    focusedSurfaceId
  });

  // Setup Wizard logic
  // Derived state for wizard visibility to avoid effect loops
  const shouldShowWizard = ui.showWizard || (isFirstRun && !setupLoading);

  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const isChat = tabManager.activeTabId === 'chat';

  // Keyboard shortcut handlers
  const saveActiveFile = () => {
    const activeTab = tabManager.tabs.find(t => t.id === tabManager.activeTabId);
    if (activeTab?.type === 'file') {
      tabManager.editorRefs.current[activeTab.id]?.save();
    }
  };

  const closeActiveTab = () => {
    if (tabManager.activeTabId !== 'chat') {
      tabManager.handleCloseTab(tabManager.activeTabId);
    }
  };

  const focusChat = () => {
    tabManager.setActiveTabId('chat');
    setTimeout(() => {
      chatInputRef.current?.focus();
    }, 50);
  };

  const switchToTabByIndex = (index: number) => {
    if (index === 8) {
      if (tabManager.tabs.length > 0) {
        tabManager.setActiveTabId(tabManager.tabs[tabManager.tabs.length - 1].id);
      }
    } else if (index >= 0 && index < tabManager.tabs.length) {
      tabManager.setActiveTabId(tabManager.tabs[index].id);
    }
  };

  const nextTab = () => {
    const currentIndex = tabManager.tabs.findIndex(t => t.id === tabManager.activeTabId);
    if (currentIndex < tabManager.tabs.length - 1) {
      tabManager.setActiveTabId(tabManager.tabs[currentIndex + 1].id);
    } else {
      tabManager.setActiveTabId(tabManager.tabs[0].id);
    }
  };

  const prevTab = () => {
    const currentIndex = tabManager.tabs.findIndex(t => t.id === tabManager.activeTabId);
    if (currentIndex > 0) {
      tabManager.setActiveTabId(tabManager.tabs[currentIndex - 1].id);
    } else {
      tabManager.setActiveTabId(tabManager.tabs[tabManager.tabs.length - 1].id);
    }
  };

  const { shortcuts } = useKeyboardShortcuts({
    openPalette: () => ui.setShowGlobalPalette(p => !p),
    openSettings: () => ui.setShowSettings(true),
    closeActiveTab,
    saveActiveFile,
    focusChat,
    switchToTabByIndex,
    nextTab,
    prevTab,
    showShortcutsHelp: () => ui.setShowShortcutsHelp(p => !p),
    openTaskManager: () => ui.setShowTaskManager(p => !p),
    toggleTerminal: () => ui.setShowTerminal(p => !p),
    toggleConsole: () => setLogPanelOpen(p => !p),
  });

  return (
    <div className="flex flex-col h-screen w-full bg-[#080808] text-zinc-100 font-sans overflow-hidden relative">
      {ui.isLocked && <LockScreen onUnlock={() => ui.setIsLocked(false)} />}

      <GuakeTerminal
        isVisible={ui.showTerminal}
        onClose={() => ui.setShowTerminal(false)}
      />
      
      {ui.showGlobalPalette && (
        <GlobalPalette 
          isOpen={true} 
          onClose={() => ui.setShowGlobalPalette(false)} 
          onSelect={(label) => {
            ui.setShowGlobalPalette(false);
            handleSend(label);
          }}
          actions={globalActions}
        />
      )}

      <SettingsDialog
        isOpen={ui.showSettings}
        onClose={() => ui.setShowSettings(false)}
        settings={settings}
        onSave={updateSettings}
        openClawStatus={openClawStatus}
        onConfigureOpenClaw={configureOpenClaw}
        onDeployOpenClaw={deployOpenClaw}
        secrets={secrets}
        onOpenSecrets={() => ui.setShowSecrets(true)}
        onRunSetupWizard={() => ui.setShowWizard(true)}
        skills={{
          installedSkills: skills.installedSkills,
          clawHubResults: skills.clawHubResults,
          clawHubAvailable: skills.clawHubAvailable,
          isLoading: skills.isLoading,
          isInstalling: skills.isInstalling,
          installProgress: skills.installProgress,
          error: skills.error,
          onFetchSkills: skills.fetchSkills,
          onSearchClawHub: skills.searchClawHub,
          onInstallFromClawHub: skills.installFromClawHub,
          onInstallFromNpm: skills.installFromNpm,
          onUninstallSkill: skills.uninstallSkill,
          onClearError: skills.clearError,
        }}
      />

      <DirectoryPicker
        isOpen={ui.showDirPicker}
        currentPath={projectStatus?.cwd}
        onSelect={(newPath) => workspace.handleSwitchWorkspace(newPath)}
        onClose={() => ui.setShowDirPicker(false)}
      />

      <TaskManagerPanel
        isOpen={ui.showTaskManager}
        onClose={() => ui.setShowTaskManager(false)}
      />

      <SecretsPanel
        isOpen={ui.showSecrets}
        onClose={() => ui.setShowSecrets(false)}
      />

      <KeyboardShortcutsHelp
        isOpen={ui.showShortcutsHelp}
        onClose={() => ui.setShowShortcutsHelp(false)}
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

      {/* Header */}
      <div className={`transition-all duration-700 ${ui.isLocked ? 'blur-[40px] grayscale' : ''}`}>
        <Header
          isAgentWorking={isWorking}
          queuedMessageCount={queueCount}
          onOpenPalette={() => ui.setShowGlobalPalette(true)}
          onSettingsClick={() => ui.setShowSettings(true)}
          onWorkspaceClick={() => ui.setShowDirPicker(true)}
          onOpenClawClick={() => ui.setShowSettings(true)}
          activeWorkspace={projectStatus?.cwd}
          isConnected={isConnected}
          workspacePort={ui.workspacePort}
          
          agentLoopStatus={agentLoopStatus}
          agentLoopLastInvocation={agentLoopLastInvocation}
          onAgentLoopPlay={agentLoopPlay}
          onAgentLoopPause={agentLoopPause}
          onAgentLoopStop={agentLoopStop}
          onAgentLoopSetInterval={agentLoopSetInterval}

          conversations={conversations}
          activeConversation={activeConversation}
          onSwitchConversation={switchConversation}
          onCreateConversation={createConversation}
          onDeleteConversation={deleteConversation}
          onRenameConversation={renameConversation}
        />
      </div>

      <div className={`flex flex-1 min-h-0 w-full relative transition-all duration-700 ${ui.isLocked ? 'blur-[40px] grayscale' : ''}`}>
        <Sidebar
          width={ui.sidebarWidth}
          projectStatus={projectStatus}
          fileTree={fileTree}
          surfaces={surfaces}
          onFileClick={tabManager.handleFileClick}
          onSurfaceClick={tabManager.handleSurfaceClick}
          onSurfaceRename={renameSurface}
          onSurfaceDelete={(surfaceId) => {
            deleteSurface(surfaceId);
            const tabId = `surface:${surfaceId}`;
            tabManager.handleCloseTab(tabId);
          }}
          onSurfaceDuplicate={duplicateSurface}
        />

        {/* Resizer Handle */}
        <div
          className={`w-[5px] cursor-col-resize transition-colors z-50 flex-shrink-0 flex items-center justify-center group
            ${ui.isResizingSidebar
              ? 'bg-indigo-500'
              : 'bg-zinc-700/60 hover:bg-indigo-500/50 active:bg-indigo-500'
            }`}
          onMouseDown={() => ui.setIsResizingSidebar(true)}
        >
          {/* Grip dots */}
          <div className="flex flex-col gap-[3px] opacity-40 group-hover:opacity-80 transition-opacity">
            <div className="w-[3px] h-[3px] rounded-full bg-zinc-400" />
            <div className="w-[3px] h-[3px] rounded-full bg-zinc-400" />
            <div className="w-[3px] h-[3px] rounded-full bg-zinc-400" />
            <div className="w-[3px] h-[3px] rounded-full bg-zinc-400" />
            <div className="w-[3px] h-[3px] rounded-full bg-zinc-400" />
          </div>
        </div>

        <main className="flex-1 flex flex-col relative min-h-0 bg-[#080808] min-w-0">
          <TabBar
            tabs={tabManager.visibleTabs}
            activeTabId={tabManager.activeTabId}
            onSelectTab={tabManager.setActiveTabId}
            onCloseTab={tabManager.handleCloseTab}
            onNewChat={tabManager.handleNewChat}
            onNewFile={tabManager.handleNewFile}
            onNewSurface={tabManager.handleNewSurface}
            conversations={conversations}
            activeConversation={activeConversation}
            onSwitchConversation={switchConversation}
            onRenameConversation={renameConversation}
            onDeleteConversation={deleteConversation}
          />

          <div className="flex-1 flex min-h-0 min-w-0 relative">
            <div className="flex-1 flex flex-col min-h-0 min-w-0">
              <div className={`flex-1 flex flex-col min-h-0 ${isChat ? '' : 'hidden'}`}>
                <MessageList
                  messages={messages}
                  isAgentWorking={isWorking}
                  messageActions={messageActions}
                  activityLog={activityLog}
                  userLabel={userLabel}
                  agentLabel={agentLabel}
                />
              </div>

            {tabManager.tabs.filter(t => t.type === 'file').map(tab => (
              <div
                key={tab.id}
                className={`flex-1 flex flex-col ${tabManager.activeTabId === tab.id ? '' : 'hidden'}`}
              >
                <FileEditor
                  ref={(handle) => {
                    if (handle) {
                      tabManager.editorRefs.current[tab.id] = handle;
                    } else {
                      delete tabManager.editorRefs.current[tab.id];
                    }
                  }}
                  filePath={tab.filePath!}
                  onDirtyChange={tabManager.handleDirtyChange}
                />
              </div>
            ))}

            {tabManager.tabs.filter(t => t.type === 'html-preview').map(tab => (
              <div
                key={tab.id}
                className={`flex-1 flex flex-col ${tabManager.activeTabId === tab.id ? '' : 'hidden'}`}
              >
                <HtmlPreview
                  filePath={tab.filePath!}
                  onSwitchToEditor={tabManager.handleSwitchToEditor}
                />
              </div>
            ))}

            {tabManager.tabs.filter(t => t.type === 'image').map(tab => (
              <div
                key={tab.id}
                className={`flex-1 flex flex-col w-full min-w-0 min-h-0 ${tabManager.activeTabId === tab.id ? '' : 'hidden'}`}
              >
                <ImageViewer filePath={tab.filePath!} />
              </div>
            ))}

            {tabManager.tabs.filter(t => t.type === 'pdf').map(tab => (
              <div
                key={tab.id}
                className={`flex-1 flex flex-col w-full min-w-0 min-h-0 ${tabManager.activeTabId === tab.id ? '' : 'hidden'}`}
              >
                <PdfViewer filePath={tab.filePath!} />
              </div>
            ))}

            {tabManager.tabs.filter(t => t.type === 'surface').map(tab => (
              <div
                key={tab.id}
                className={`flex-1 flex flex-col w-full min-w-0 min-h-0 ${tabManager.activeTabId === tab.id ? '' : 'hidden'}`}
              >
                <SurfaceRenderer
                  surfaceId={tab.surfaceId!}
                  data={loadedSurfaces[tab.surfaceId!] ?? null}
                  sources={componentSources}
                  onRefresh={() => loadSurface(tab.surfaceId!)}
                  onPinToggle={tabManager.handlePinSurface}
                  onDelete={() => {
                      tabManager.handleCloseTab(tab.id);
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
                activityLog={activityLog}
                queueCount={queueCount}
              />
            </div>

            {/* Task panel inline within conversation area */}
            <TaskSidebar
              isOpen={ui.showTaskSidebar}
              onToggle={() => ui.setShowTaskSidebar(prev => !prev)}
            />
          </div>
        </main>
      </div>

      <div className={`transition-all duration-700 ${ui.isLocked ? 'blur-[40px] grayscale' : ''}`}>
        <StatusBar
          isConnected={isConnected}
          isAgentWorking={isWorking}
          queuedMessageCount={queueCount}
          projectStatus={projectStatus}
          selectedModel={selectedModel ?? undefined}
          availableModels={settings?.modelRegistry || {}}
          onSelectModel={(model) => {
            setSelectedModel(model);
            // Persist the agentic model route to settings
            const newRouting = { ...(settings?.routing || {}), agentic: model };
            updateSettings({ ...settings, routing: newRouting });
          }}
          activeConversation={activeConversation}
          onSettingsClick={() => ui.setShowSettings(true)}
          onTerminalClick={() => ui.setShowTerminal(p => !p)}
          onConsoleClick={() => setLogPanelOpen(p => !p)}
        />
      </div>

      <LogPanel
        logs={allLogs}
        isOpen={logPanelOpen}
        onClose={() => setLogPanelOpen(false)}
        onClear={clearAllLogs}
      />
      <ToastProvider />
      
      {shouldShowWizard && (
        <SetupWizard 
          onComplete={() => ui.setShowWizard(false)}
          onSkip={() => ui.setShowWizard(false)}
          config={{
            provider: settings?.ai?.provider || 'openai',
            model: settings?.ai?.model || 'gpt-4o',
            apiKey: '', 
            workspace: projectStatus?.cwd || '',
            openClawEnabled: !!openClawStatus?.available,
            openClawMode: (openClawStatus?.mode as 'external' | 'integrated') || 'external',
            openClawUrl: openClawStatus?.url || '',
            openClawAuthToken: openClawStatus?.authToken || '',
            openClawPath: openClawStatus?.path || '',
          }}
        />
      )}
    </div>
  );
}

export default App;
