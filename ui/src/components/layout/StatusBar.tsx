import React from 'react';
import {
  Wifi,
  WifiOff,
  GitBranch,
  Box,
  FileText,
  Loader2,
  AlertCircle,
  CheckCircle2,
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
