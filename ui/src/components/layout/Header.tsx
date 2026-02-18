import React, { useState, useEffect, useCallback } from 'react';
import { Command, FolderOpen, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { wsService } from '../../services/wsService';

interface OpenClawStatus {
  available: boolean;
  connected: boolean;
  mode: string | null;
  url: string | null;
}

interface HeaderProps {
  isAgentWorking: boolean;
  queuedMessageCount: number;
  onOpenPalette: () => void;
  onWorkspaceClick?: () => void;
  onOpenClawClick?: () => void;
  title?: string;
  statusText?: string;
  showAudioVisualizer?: boolean;
  activeWorkspace?: string;
  isConnected?: boolean;
}

/** Small OpenClaw connection badge shown in the header. */
const OpenClawBadge: React.FC<{ onClick?: () => void }> = ({ onClick }) => {
  const [status, setStatus] = useState<OpenClawStatus | null>(null);

  const poll = useCallback(() => {
    wsService.getOpenClawStatus();
  }, []);

  useEffect(() => {
    const unsub = wsService.on('openclaw-status', (payload: unknown) => {
      setStatus(payload as OpenClawStatus);
    });

    poll();
    const interval = setInterval(poll, 15_000);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, [poll]);

  if (!status || !status.available) return null;

  const connected = status.connected;
  const tooltip = connected
    ? `OpenClaw connected (${status.mode ?? 'unknown'} · ${status.url ?? '?'})`
    : `OpenClaw disconnected (${status.mode ?? 'not configured'})`;

  return (
    <button
      onClick={onClick}
      title={tooltip}
      className={`
        inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider cursor-pointer select-none
        transition-all duration-200 hover:scale-105 active:scale-95
        ${connected
          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/15'
          : 'bg-zinc-800/40 text-zinc-500 border border-zinc-700/30 hover:bg-zinc-800/60'}
      `}
    >
      <span className="text-[10px] leading-none" aria-hidden>🦞</span>
      <span>OC</span>
      <span className={`w-1.5 h-1.5 rounded-full transition-colors ${connected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' : 'bg-zinc-600'}`} />
    </button>
  );
};

const Header: React.FC<HeaderProps> = ({
  isAgentWorking,
  queuedMessageCount,
  onOpenPalette,
  onWorkspaceClick,
  onOpenClawClick,
  title = "RoboDev",
  activeWorkspace,
  isConnected = true
}) => {
  // Shortened workspace path for display
  const shortWorkspace = activeWorkspace
    ? activeWorkspace.replace(/^\/Users\/[^/]+/, '~')
    : null;

  return (
    <header
      className={`
        h-11 border-b flex items-center justify-between px-4 select-none shrink-0
        transition-all duration-500 relative overflow-hidden
        ${isAgentWorking
          ? 'bg-[#0c0c0c]/95 border-indigo-500/20'
          : 'bg-[#0c0c0c]/95 border-zinc-800/60'}
      `}
      style={{ 
        WebkitAppRegion: 'drag',
        backdropFilter: 'blur(12px) saturate(180%)',
      } as React.CSSProperties}
    >
      {/* Ambient working glow */}
      {isAgentWorking && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-x-0 bottom-0 h-[1px] bg-gradient-to-r from-transparent via-indigo-500/60 to-transparent animate-shimmer" />
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/[0.03] via-transparent to-purple-500/[0.03]" />
        </div>
      )}

      {/* Left: App identity + workspace */}
      <div className="flex items-center gap-2.5 min-w-0 relative z-10" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className={`
          w-7 h-7 rounded-lg flex items-center justify-center overflow-hidden shrink-0
          transition-all duration-300 shadow-lg
          ${isConnected
            ? isAgentWorking
              ? 'bg-gradient-to-br from-indigo-600 to-violet-600 shadow-indigo-500/20 animate-glow-pulse'
              : 'bg-gradient-to-br from-indigo-600 to-indigo-700 shadow-indigo-500/10'
            : 'bg-zinc-800 shadow-none'}
        `}>
          <img src="/robot.svg" alt="" className={`w-5 h-5 transition-all duration-300 ${!isConnected ? 'grayscale opacity-40' : ''}`} />
        </div>
        <span className="text-[11px] font-bold text-zinc-200 tracking-tight shrink-0">{title}</span>

        {shortWorkspace && (
          <>
            <span className="text-zinc-700/60 text-[10px]">›</span>
            <button
              onClick={onWorkspaceClick}
              className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500 truncate max-w-[280px] hover:text-indigo-400 transition-all duration-200 px-1.5 py-0.5 rounded-md hover:bg-indigo-500/5 cursor-pointer"
              title={`${activeWorkspace} — click to change`}
            >
              <FolderOpen size={10} className="shrink-0 text-zinc-600" />
              <span className="truncate">{shortWorkspace}</span>
            </button>
          </>
        )}
      </div>

      {/* Center: Status */}
      <div className="flex items-center gap-2 absolute left-1/2 -translate-x-1/2 z-10">
        {isAgentWorking && (
          <div className="flex items-center gap-2 text-amber-400 animate-fade-in px-3 py-1 rounded-full bg-amber-500/5 border border-amber-500/10">
            <Loader2 size={11} className="animate-spin" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Working</span>
          </div>
        )}
        {!isAgentWorking && queuedMessageCount > 0 && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500/70 animate-fade-in px-2.5 py-0.5 rounded-full bg-amber-500/5 border border-amber-500/10">
            {queuedMessageCount} queued
          </span>
        )}
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-2 relative z-10" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <OpenClawBadge onClick={onOpenClawClick} />

        {/* Connection indicator */}
        <div className={`
          flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider
          transition-all duration-300
          ${isConnected
            ? 'text-emerald-500/60 hover:text-emerald-400'
            : 'text-red-400 bg-red-500/5 border border-red-500/10'}
        `}>
          {isConnected ? <Wifi size={10} /> : <WifiOff size={10} className="animate-pulse" />}
        </div>

        <button
          onClick={onOpenPalette}
          className="
            flex items-center gap-1.5 text-zinc-500 hover:text-zinc-200 p-1.5 rounded-lg
            transition-all duration-200 hover:bg-zinc-800/50 active:scale-95
          "
          title="Command Palette (⌘⇧P)"
        >
          <Command size={13} />
          <kbd className="hidden md:inline text-[9px] font-mono text-zinc-600 bg-zinc-800/60 px-1.5 py-0.5 rounded border border-zinc-700/30">⌘⇧P</kbd>
        </button>
      </div>
    </header>
  );
};

export default Header;
