import React, { useState, useRef, useEffect } from 'react';
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
  Palette,
  Check,
  Cpu,
} from 'lucide-react';
import type { ProjectStatusData } from '../features/ProjectStatus';
import type { PersonaInfo } from '../../hooks/usePersona';
import type { AgenticProviderInfo } from '../../hooks/useChat';
import CloudSyncIndicator from '../features/CloudSyncIndicator';
import CloudPresenceBar from '../features/CloudPresenceBar';
import PersonaSelector from '../features/PersonaSelector';

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
  currentTheme?: string;
  availableThemes?: string[];
  onThemeChange?: (theme: string) => void;
  // Persona props
  personas?: PersonaInfo[];
  activePersonaId?: string | null;
  onSwitchPersona?: (personaId: string) => void;
  onCreatePersona?: (name: string, prompt: string) => void;
  // Agentic provider props
  agenticProviders?: AgenticProviderInfo[];
  activeAgenticProvider?: string | null;
  onSwitchAgenticProvider?: (providerId: string) => void;
  /** Whether the user is allowed to switch agentic providers (workspace setting) */
  allowAgentProviderSelection?: boolean;
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
  currentTheme = 'default',
  availableThemes = [],
  onThemeChange,
  personas = [],
  activePersonaId = null,
  onSwitchPersona,
  onCreatePersona,
  agenticProviders = [],
  activeAgenticProvider = null,
  onSwitchAgenticProvider,
  allowAgentProviderSelection = false,
}) => {
  const gitBranch = projectStatus?.gitBranch;
  const projectType = projectStatus?.projectType;
  const fileCount = projectStatus?.fileCount;

  const [showThemePicker, setShowThemePicker] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const pickerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Agentic provider picker state
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [providerFocusedIndex, setProviderFocusedIndex] = useState(-1);
  const providerPickerRef = useRef<HTMLDivElement>(null);
  const providerButtonRef = useRef<HTMLButtonElement>(null);

  // Helper to compute initial focused index
  const getInitialFocusedIndex = () => {
    if (availableThemes.length === 0) return -1;
    const idx = availableThemes.indexOf(currentTheme);
    return idx >= 0 ? idx : 0;
  };

  // Toggle picker with focused index initialization
  const toggleThemePicker = () => {
    setShowThemePicker(prev => {
      const next = !prev;
      setFocusedIndex(next ? getInitialFocusedIndex() : -1);
      return next;
    });
  };

  // Close picker helper (resets focused index)
  const closeThemePicker = () => {
    setShowThemePicker(false);
    setFocusedIndex(-1);
  };

  // Close picker when clicking outside
  useEffect(() => {
    if (!showThemePicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        closeThemePicker();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showThemePicker]);

  // Close on Escape
  useEffect(() => {
    if (!showThemePicker) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeThemePicker();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [showThemePicker]);

  // Focus the option at focusedIndex when it changes
  useEffect(() => {
    if (focusedIndex >= 0 && pickerRef.current) {
      const options = pickerRef.current.querySelectorAll<HTMLElement>('[role="option"]');
      options[focusedIndex]?.focus();
    }
  }, [focusedIndex]);

  const handleThemeSelect = (theme: string) => {
    onThemeChange?.(theme);
    setShowThemePicker(false);
  };

  /** Capitalize first letter of theme name */
  const formatThemeName = (name: string) =>
    name.charAt(0).toUpperCase() + name.slice(1);

  // --- Agentic provider picker helpers ---
  const activeProvider = agenticProviders.find(p => p.id === activeAgenticProvider);
  const activeProviderName = activeProvider?.name ?? 'No Provider';

  const getInitialProviderFocusedIndex = () => {
    if (agenticProviders.length === 0) return -1;
    const idx = agenticProviders.findIndex(p => p.id === activeAgenticProvider);
    return idx >= 0 ? idx : 0;
  };

  const toggleProviderPicker = () => {
    setShowProviderPicker(prev => {
      const next = !prev;
      setProviderFocusedIndex(next ? getInitialProviderFocusedIndex() : -1);
      return next;
    });
  };

  const closeProviderPicker = () => {
    setShowProviderPicker(false);
    setProviderFocusedIndex(-1);
  };

  // Close provider picker on outside click
  useEffect(() => {
    if (!showProviderPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        providerPickerRef.current && !providerPickerRef.current.contains(e.target as Node) &&
        providerButtonRef.current && !providerButtonRef.current.contains(e.target as Node)
      ) {
        closeProviderPicker();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showProviderPicker]);

  // Close provider picker on Escape
  useEffect(() => {
    if (!showProviderPicker) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeProviderPicker();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [showProviderPicker]);

  // Focus the provider option at providerFocusedIndex when it changes
  useEffect(() => {
    if (providerFocusedIndex >= 0 && providerPickerRef.current) {
      const options = providerPickerRef.current.querySelectorAll<HTMLElement>('[role="option"]');
      options[providerFocusedIndex]?.focus();
    }
  }, [providerFocusedIndex]);

  const handleProviderSelect = (providerId: string) => {
    onSwitchAgenticProvider?.(providerId);
    closeProviderPicker();
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

        {/* Agentic provider switcher */}
        {allowAgentProviderSelection && onSwitchAgenticProvider && agenticProviders.length > 0 && (
          <div className="relative">
            <button
              ref={providerButtonRef}
              onClick={toggleProviderPicker}
              className="flex items-center gap-1 hover:bg-white/10 px-1 py-0.5 rounded transition-colors cursor-pointer"
              title={`Agent: ${activeProviderName} — Click to switch`}
              aria-haspopup="listbox"
              aria-expanded={showProviderPicker}
            >
              <Cpu size={11} />
              <span className="hidden sm:inline truncate max-w-[100px]">{activeProviderName}</span>
            </button>

            {/* Provider picker popup */}
            {showProviderPicker && (
              <div
                ref={providerPickerRef}
                role="listbox"
                aria-label="Agentic provider selector"
                tabIndex={-1}
                onKeyDown={(e: React.KeyboardEvent) => {
                  const len = agenticProviders.length;
                  if (len === 0) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setProviderFocusedIndex(prev => (prev + 1) % len);
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setProviderFocusedIndex(prev => (prev - 1 + len) % len);
                  } else if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (providerFocusedIndex >= 0 && providerFocusedIndex < len) {
                      handleProviderSelect(agenticProviders[providerFocusedIndex].id);
                    }
                  }
                }}
                className="absolute bottom-full right-0 mb-1 w-56 max-h-72 overflow-y-auto rounded-lg border shadow-xl z-50"
                style={{
                  backgroundColor: 'var(--color-surface-raised)',
                  borderColor: 'var(--color-border)',
                }}
              >
                <div
                  className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-b"
                  style={{
                    color: 'var(--color-text-muted)',
                    borderColor: 'var(--color-border)',
                  }}
                >
                  Switch Agent Provider
                </div>
                <div className="py-1">
                  {agenticProviders.map((provider, index) => {
                    const isActive = provider.id === activeAgenticProvider;
                    return (
                      <button
                        key={provider.id}
                        role="option"
                        aria-selected={isActive}
                        tabIndex={index === providerFocusedIndex ? 0 : -1}
                        onClick={() => handleProviderSelect(provider.id)}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left transition-colors cursor-pointer ${
                          isActive ? 'bg-indigo-500/10' : 'hover:bg-white/10'
                        }`}
                        style={{ color: 'var(--color-text)' }}
                      >
                        <Cpu size={11} className={isActive ? 'text-indigo-400' : 'opacity-50'} />
                        <div className="flex-1 min-w-0">
                          <span className="block truncate">{provider.name}</span>
                          {provider.description && (
                            <span className="block text-[9px] truncate" style={{ color: 'var(--color-text-muted)' }}>
                              {provider.description}
                            </span>
                          )}
                        </div>
                        {isActive && (
                          <Check size={12} style={{ color: 'var(--color-primary)' }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Theme chooser */}
        {onThemeChange && (
          <div className="relative">
            <button
              ref={buttonRef}
              onClick={toggleThemePicker}
              className="flex items-center gap-1 hover:bg-white/10 px-1 py-0.5 rounded transition-colors cursor-pointer"
              title={`Theme: ${formatThemeName(currentTheme)} — Click to change`}
              aria-haspopup="listbox"
              aria-expanded={showThemePicker}
            >
              <Palette size={11} />
              <span className="hidden sm:inline">{formatThemeName(currentTheme)}</span>
            </button>

            {/* Theme picker popup */}
            {showThemePicker && availableThemes.length > 0 && (
              <div
                ref={pickerRef}
                role="listbox"
                aria-label="Theme selector"
                tabIndex={-1}
                onKeyDown={(e: React.KeyboardEvent) => {
                  const len = availableThemes.length;
                  if (len === 0) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setFocusedIndex(prev => (prev + 1) % len);
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setFocusedIndex(prev => (prev - 1 + len) % len);
                  } else if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (focusedIndex >= 0 && focusedIndex < len) {
                      handleThemeSelect(availableThemes[focusedIndex]);
                    }
                  }
                }}
                className="absolute bottom-full right-0 mb-1 w-48 max-h-72 overflow-y-auto rounded-lg border shadow-xl z-50"
                style={{
                  backgroundColor: 'var(--color-surface-raised)',
                  borderColor: 'var(--color-border)',
                }}
              >
                <div
                  className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-b"
                  style={{
                    color: 'var(--color-text-muted)',
                    borderColor: 'var(--color-border)',
                  }}
                >
                  Choose Theme
                </div>
                <div className="py-1">
                  {availableThemes.map((theme, index) => (
                    <button
                      key={theme}
                      role="option"
                      aria-selected={theme === currentTheme}
                      tabIndex={index === focusedIndex ? 0 : -1}
                      onClick={() => handleThemeSelect(theme)}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] text-left transition-colors hover:bg-white/10 cursor-pointer"
                      style={{ color: 'var(--color-text)' }}
                    >
                      <span>{formatThemeName(theme)}</span>
                      {theme === currentTheme && (
                        <Check size={12} style={{ color: 'var(--color-primary)' }} />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Persona selector */}
        {onSwitchPersona && onCreatePersona && (
          <PersonaSelector
            personas={personas}
            activePersonaId={activePersonaId}
            onSwitch={onSwitchPersona}
            onCreate={onCreatePersona}
          />
        )}

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
            {runningTaskCount > 0 ? (
              <Loader2 size={11} className="animate-spin text-amber-400" />
            ) : (
              <Zap size={11} />
            )}
            Tasks
            {runningTaskCount > 0 && (
              <span className="px-1 py-0.5 text-[8px] font-bold rounded-full bg-amber-500/20 text-amber-400 tabular-nums">
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
