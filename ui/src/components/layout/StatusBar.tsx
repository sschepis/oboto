import React, { useMemo } from 'react';
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
} from 'lucide-react';
import type { ProjectStatusData } from '../features/ProjectStatus';

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
}) => {
  const gitBranch = projectStatus?.gitBranch;
  const projectType = projectStatus?.projectType;
  const fileCount = projectStatus?.fileCount;

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

  return (
    <footer
      className={`
        h-6 flex items-center justify-between px-2.5 text-[10px] select-none shrink-0 z-40
        border-t transition-colors duration-300
        ${isConnected
          ? 'bg-[#007acc] border-[#007acc] text-white/90'
          : 'bg-red-700 border-red-700 text-white/90'}
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

        {/* Selected model */}
        {selectedModel && (
          <div className="relative group flex items-center">
            {Object.keys(groupedModels).length > 0 && onSelectModel ? (
              <>
                 <select
                  value={selectedModel}
                  onChange={(e) => onSelectModel(e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  title={`Model: ${currentProvider ? `${currentProvider}/${selectedModel}` : selectedModel}`}
                >
                  {Object.entries(groupedModels).map(([provider, models]) => (
                    <optgroup key={provider} label={provider.toUpperCase()}>
                      {models.map(m => (
                        <option key={m} value={m} className="text-black">{m}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <div
                  className="flex items-center gap-1 hover:bg-white/10 px-1 py-0.5 rounded transition-colors cursor-pointer"
                >
                  <Cpu size={11} />
                  <span className="truncate max-w-[200px]">
                    {currentProvider ? `${currentProvider}/${selectedModel}` : selectedModel}
                  </span>
                  <ChevronDown size={10} className="opacity-50" />
                </div>
              </>
            ) : (
              <button
                onClick={onSettingsClick}
                className="flex items-center gap-1 hover:bg-white/10 px-1 py-0.5 rounded transition-colors cursor-pointer"
                title={`Model: ${selectedModel}`}
              >
                <Cpu size={11} />
                <span className="truncate max-w-[140px]">{selectedModel}</span>
              </button>
            )}
          </div>
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
