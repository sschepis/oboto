import { useState, useRef, useEffect } from 'react';
import type { AgentLoopStatus, AgentLoopInvocation } from '../../hooks/useAgentLoop';
import { Play, Pause, Square, Clock, Activity } from 'lucide-react';

interface AgentLoopControlsProps {
  status: AgentLoopStatus;
  lastInvocation: AgentLoopInvocation | null;
  onPlay: (intervalMs?: number) => void;
  onPause: () => void;
  onStop: () => void;
  onSetInterval: (intervalMs: number) => void;
  className?: string;
}

const INTERVAL_PRESETS = [
  { label: '30s', ms: 30000 },
  { label: '1m', ms: 60000 },
  { label: '2m', ms: 120000 },
  { label: '5m', ms: 300000 },
  { label: '10m', ms: 600000 },
];

export function AgentLoopControls({
  status,
  lastInvocation,
  onPlay,
  onPause,
  onStop,
  onSetInterval,
  className = '',
}: AgentLoopControlsProps) {
  const [showIntervalPicker, setShowIntervalPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const { state, intervalMs, invocationCount } = status;

  // Close picker on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setShowIntervalPicker(false);
      }
    };
    if (showIntervalPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showIntervalPicker]);

  const formatInterval = (ms: number) => {
    if (ms < 60000) return `${ms / 1000}s`;
    return `${ms / 60000}m`;
  };

  const isPlaying = state === 'playing';
  const isPaused = state === 'paused';
  const isStopped = state === 'stopped';

  // Dynamic styles based on state
  const containerBorder = isPlaying 
    ? 'border-emerald-500/20 bg-emerald-500/5' 
    : isPaused 
      ? 'border-amber-500/20 bg-amber-500/5' 
      : 'border-zinc-800/40 bg-zinc-900/50';

  const statusColor = isPlaying ? 'text-emerald-400' : isPaused ? 'text-amber-400' : 'text-zinc-500';

  return (
    <div className={`flex items-center gap-2 px-2 py-1 rounded-lg border text-xs transition-colors duration-300 ${containerBorder} ${className}`}>
      
      {/* State Indicator */}
      <div className={`flex items-center gap-1.5 min-w-[70px] font-semibold ${statusColor}`} title={`Agent Loop: ${state}`}>
        {isPlaying ? (
          <Activity size={12} className="animate-pulse" />
        ) : isPaused ? (
          <Pause size={12} />
        ) : (
          <Square size={12} />
        )}
        <span className="uppercase tracking-wider text-[10px]">
          {state}
        </span>
      </div>

      {/* Divider */}
      <div className="w-px h-3 bg-zinc-700/30 mx-0.5" />

      {/* Controls */}
      <div className="flex items-center gap-1">
        {(isStopped || isPaused) && (
          <button
            onClick={() => onPlay(isStopped ? intervalMs : undefined)}
            className="
              flex items-center gap-1.5 px-2 py-0.5 rounded
              bg-emerald-500/10 text-emerald-400 border border-emerald-500/20
              hover:bg-emerald-500/20 transition-all cursor-pointer font-medium
            "
            title={isPaused ? 'Resume agent loop' : `Start agent loop (every ${formatInterval(intervalMs)})`}
          >
            <Play size={10} fill="currentColor" />
            <span>{isPaused ? 'Resume' : 'Play'}</span>
          </button>
        )}

        {isPlaying && (
          <button
            onClick={onPause}
            className="
              flex items-center gap-1.5 px-2 py-0.5 rounded
              bg-amber-500/10 text-amber-400 border border-amber-500/20
              hover:bg-amber-500/20 transition-all cursor-pointer font-medium
            "
            title="Pause agent loop"
          >
            <Pause size={10} fill="currentColor" />
            <span>Pause</span>
          </button>
        )}

        {(isPlaying || isPaused) && (
          <button
            onClick={onStop}
            className="
              flex items-center gap-1.5 px-2 py-0.5 rounded
              bg-red-500/10 text-red-400 border border-red-500/20
              hover:bg-red-500/20 transition-all cursor-pointer font-medium
            "
            title="Stop agent loop"
          >
            <Square size={10} fill="currentColor" />
            <span>Stop</span>
          </button>
        )}
      </div>

      {/* Interval Picker */}
      <div className="relative" ref={pickerRef}>
        <button
          onClick={() => setShowIntervalPicker(!showIntervalPicker)}
          className="
            flex items-center gap-1 px-1.5 py-0.5 rounded
            text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50
            transition-all cursor-pointer
          "
          title="Set invocation interval"
        >
          <Clock size={10} />
          <span className="font-mono text-[10px]">{formatInterval(intervalMs)}</span>
        </button>

        {showIntervalPicker && (
          <div className="
            absolute top-full left-1/2 -translate-x-1/2 mt-1 w-32
            bg-[#111111] border border-zinc-800 rounded-lg shadow-xl z-50 overflow-hidden
            animate-in fade-in zoom-in-95 duration-100
          ">
            {INTERVAL_PRESETS.map(preset => (
              <button
                key={preset.ms}
                onClick={() => {
                  onSetInterval(preset.ms);
                  setShowIntervalPicker(false);
                }}
                className={`
                  w-full text-left px-3 py-1.5 text-[10px] flex items-center justify-between
                  hover:bg-zinc-800/50 transition-colors
                  ${preset.ms === intervalMs ? 'text-emerald-400 bg-emerald-500/5' : 'text-zinc-400'}
                `}
              >
                <span>Every {preset.label}</span>
                {preset.ms === intervalMs && <span className="text-[9px]">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Invocation Counter */}
      {invocationCount > 0 && (
        <>
          <div className="w-px h-3 bg-zinc-700/30 mx-0.5" />
          <div 
            className="text-[9px] font-mono text-zinc-500"
            title={lastInvocation ? `Last run: ${lastInvocation.timestamp}` : undefined}
          >
            #{invocationCount}
          </div>
        </>
      )}
    </div>
  );
}
