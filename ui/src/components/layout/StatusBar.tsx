import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Wifi,
  WifiOff,
  GitBranch,
  Box,
  FileText,
  Loader2,
  Cpu,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Check,
  Zap,
} from 'lucide-react';
import type { ProjectStatusData } from '../features/ProjectStatus';
import CloudSyncIndicator from '../features/CloudSyncIndicator';
import CloudPresenceBar from '../features/CloudPresenceBar';

interface StatusBarProps {
  isConnected: boolean;
  isAgentWorking: boolean;
  queuedMessageCount: number;
  projectStatus?: ProjectStatusData | null;
  selectedModel?: string;
  availableModels?: Record<string, { provider: string }>;
  onSelectModel?: (model: string) => void;
  activeConversation?: string;
  onSettingsClick?: () => void;
  onTerminalClick?: () => void;
  onConsoleClick?: () => void;
  onTasksClick?: () => void;
  runningTaskCount?: number;
}

/** VS Code-style status bar pinned to the bottom of the window. */
const StatusBar: React.FC<StatusBarProps> = ({
  isConnected,
  isAgentWorking,
  queuedMessageCount,
  projectStatus,
  selectedModel,
  availableModels = {},
  onSelectModel,
  activeConversation,
  onSettingsClick,
  onTerminalClick,
  onConsoleClick,
  onTasksClick,
  runningTaskCount = 0,
}) => {
  const gitBranch = projectStatus?.gitBranch;
  const projectType = projectStatus?.projectType;
  const fileCount = projectStatus?.fileCount;

  const [showModelSelector, setShowModelSelector] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  // Close selector on outside click
  useEffect(() => {
    if (!showModelSelector) return;
    const handleClick = (e: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setShowModelSelector(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showModelSelector]);

  // Close selector on Escape
  useEffect(() => {
    if (!showModelSelector) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowModelSelector(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [showModelSelector]);

  const groupedModels = useMemo(() => {
    const groups: Record<string, string[]> = {};
    Object.entries(availableModels).forEach(([id, info]) => {
      const provider = info.provider || 'unknown';
      if (!groups[provider]) groups[provider] = [];
      groups[provider].push(id);
    });
    return groups;
  }, [availableModels]);

  const currentProvider = useMemo(() => {
    if (!selectedModel || !availableModels[selectedModel]) return null;
    return availableModels[selectedModel].provider;
  }, [selectedModel, availableModels]);

  const displayLabel = useMemo(() => {
    if (!selectedModel) return null;
    return currentProvider ? `${currentProvider}/${selectedModel}` : selectedModel;
  }, [selectedModel, currentProvider]);

  const handleSelectModel = (modelId: string) => {
    onSelectModel?.(modelId);
    setShowModelSelector(false);
  };

  return (
    <footer
      className={`
        h-6 flex items-center justify-between px-2.5 text-[10px] select-none shrink-0 z-40
        border-t transition-colors duration-300
        ${isConnected
          ? 'bg-[var(--color-surface-overlay)] border-[var(--color-border)] text-[var(--color-text-muted)]'
          : 'bg-red-900/40 border-red-800/50 text-red-200/90'}
      `}
    >
      {/* Left side */}
      <div className="flex items-center gap-3 min-w-0">
        {/* Connection status */}
        <button
          onClick={onSettingsClick}
          className="flex items-center gap-1 hover:bg-white/10 px-1 py-0.5 rounded transition-colors cursor-pointer"
          title={isConnected ? 'Connected to server' : 'Disconnected from server'}
        >
          {isConnected ? <Wifi size={11} /> : <WifiOff size={11} className="animate-pulse" />}
          <span className="hidden sm:inline">{isConnected ? 'Connected' : 'Disconnected'}</span>
        </button>

        {/* Git branch */}
        {gitBranch && (
          <div
            className="flex items-center gap-1 hover:bg-white/10 px-1 py-0.5 rounded transition-colors cursor-default"
            title={`Git branch: ${gitBranch}`}
          >
            <GitBranch size={11} />
            <span className="truncate max-w-[120px]">{gitBranch}</span>
          </div>
        )}

        {/* Agent status */}
        {isAgentWorking ? (
          <div className="flex items-center gap-1 animate-pulse" title="Agent is working">
            <Loader2 size={11} className="animate-spin" />
            <span>Working{queuedMessageCount > 0 ? ` (${queuedMessageCount} queued)` : ''}</span>
          </div>
        ) : queuedMessageCount > 0 ? (
          <div className="flex items-center gap-1" title={`${queuedMessageCount} messages queued`}>
            <AlertCircle size={11} />
            <span>{queuedMessageCount} queued</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 opacity-80" title="Agent idle">
            <CheckCircle2 size={11} />
            <span>Ready</span>
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3 min-w-0">
        {/* Cloud presence + sync indicator */}
        <CloudPresenceBar />
        <CloudSyncIndicator />

        {/* Active conversation */}
        {activeConversation && (
          <div
            className="flex items-center gap-1 opacity-80 cursor-default truncate max-w-[120px]"
            title={`Conversation: ${activeConversation}`}
          >
            <span className="truncate">{activeConversation}</span>
          </div>
        )}

        {/* Project type */}
        {projectType && projectType !== 'Unknown' && (
          <div
            className="flex items-center gap-1 hover:bg-white/10 px-1 py-0.5 rounded transition-colors cursor-default"
            title={`Project type: ${projectType}`}
          >
            <Box size={11} />
            <span>{projectType}</span>
          </div>
        )}

        {/* File count */}
        {fileCount != null && fileCount > 0 && (
          <div
            className="flex items-center gap-1 opacity-80 cursor-default"
            title={`${fileCount.toLocaleString()} files in workspace`}
          >
            <FileText size={11} />
            <span className="tabular-nums">{fileCount.toLocaleString()}</span>
          </div>
        )}

        {/* Selected model with custom dropdown */}
        {displayLabel && (
          <div className="relative" ref={selectorRef}>
            {Object.keys(groupedModels).length > 0 && onSelectModel ? (
              <>
                <button
                  onClick={() => setShowModelSelector(prev => !prev)}
                  className="flex items-center gap-1 hover:bg-white/10 px-1 py-0.5 rounded transition-colors cursor-pointer"
                  title={`Model: ${displayLabel}`}
                >
                  <Cpu size={11} />
                  <span className="truncate max-w-[200px]">{displayLabel}</span>
                  <ChevronDown size={10} className="opacity-50" />
                </button>

                {showModelSelector && (
                  <div className="absolute bottom-full right-0 mb-1 w-72 max-h-80 overflow-y-auto bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-2xl shadow-black/60 z-[60] py-1">
                    {Object.entries(groupedModels).map(([provider, models]) => (
                      <div key={provider}>
                        <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-500 bg-zinc-800/40 sticky top-0">
                          {provider}
                        </div>
                        {models.map(m => {
                          const isActive = m === selectedModel;
                          return (
                            <button
                              key={m}
                              onClick={() => handleSelectModel(m)}
                              className={`
                                w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors
                                ${isActive
                                  ? 'bg-indigo-500/15 text-indigo-300'
                                  : 'text-zinc-300 hover:bg-white/5 hover:text-white'}
                              `}
                            >
                              <span className="flex-1 truncate">{provider}/{m}</span>
                              {isActive && <Check size={12} className="text-indigo-400 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <button
                onClick={onSettingsClick}
                className="flex items-center gap-1 hover:bg-white/10 px-1 py-0.5 rounded transition-colors cursor-pointer"
                title={`Model: ${displayLabel}`}
              >
                <Cpu size={11} />
                <span className="truncate max-w-[140px]">{displayLabel}</span>
              </button>
            )}
          </div>
        )}

        {/* Tasks toggle */}
        {onTasksClick && (
          <button
            onClick={onTasksClick}
            className="flex items-center gap-1 hover:bg-white/10 px-1 py-0.5 rounded transition-colors cursor-pointer"
            title="Toggle Tasks Panel (⌘T)"
          >
            <Zap size={11} />
            Tasks
            {runningTaskCount > 0 && (
              <span className="px-1 py-0.5 text-[8px] font-bold rounded-full bg-amber-500/20 text-amber-400 tabular-nums animate-pulse">
                {runningTaskCount}
              </span>
            )}
          </button>
        )}

        {/* Terminal toggle */}
        {onTerminalClick && (
          <button
            onClick={onTerminalClick}
            className="hover:bg-white/10 px-1 py-0.5 rounded transition-colors cursor-pointer"
            title="Toggle Terminal (⌘`)"
          >
            Terminal
          </button>
        )}

        {/* Console toggle */}
        {onConsoleClick && (
          <button
            onClick={onConsoleClick}
            className="hover:bg-white/10 px-1 py-0.5 rounded transition-colors cursor-pointer"
            title="Toggle Console (⌘J)"
          >
            Console
          </button>
        )}
      </div>
    </footer>
  );
};

export default StatusBar;
