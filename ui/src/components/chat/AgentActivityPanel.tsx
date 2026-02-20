import React, { useState } from 'react';
import { Loader2, ChevronUp, ChevronDown, Wrench, Brain, Zap, Radio } from 'lucide-react';
import type { ActivityLogEntry } from '../../hooks/useChat';

/** Map log levels to icons and colors */
const levelConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  ai:        { icon: <Radio size={10} />,   color: 'text-indigo-400',  label: 'AI' },
  tools:     { icon: <Wrench size={10} />,  color: 'text-amber-400',   label: 'TOOLS' },
  working:   { icon: <Zap size={10} />,     color: 'text-emerald-400', label: 'EXEC' },
  reasoning: { icon: <Brain size={10} />,   color: 'text-violet-400',  label: 'REASON' },
  progress:  { icon: <Loader2 size={10} className="animate-spin" />, color: 'text-cyan-400', label: 'PROGRESS' },
  status:    { icon: <Radio size={10} />,   color: 'text-sky-400',     label: 'STATUS' },
  system:    { icon: <Radio size={10} />,   color: 'text-zinc-500',    label: 'SYS' },
  user:      { icon: <Radio size={10} />,   color: 'text-blue-400',    label: 'USER' },
  error:     { icon: <Radio size={10} />,   color: 'text-red-400',     label: 'ERROR' },
  warning:   { icon: <Radio size={10} />,   color: 'text-yellow-400',  label: 'WARN' },
};

const getLevel = (level: string) =>
  levelConfig[level] || { icon: <Radio size={10} />, color: 'text-zinc-500', label: level.toUpperCase() };

interface AgentActivityPanelProps {
  isAgentWorking: boolean;
  activityLog?: ActivityLogEntry[];
  queueCount?: number;
}

const AgentActivityPanel: React.FC<AgentActivityPanelProps> = ({
  isAgentWorking,
  activityLog = [],
  queueCount = 0,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Don't render when not working
  if (!isAgentWorking) return null;

  const latestEntry = activityLog.length > 0 ? activityLog[activityLog.length - 1] : null;
  const latestLevel = latestEntry ? getLevel(latestEntry.level) : null;

  return (
    <div className="border-b border-zinc-800/30 overflow-hidden animate-fade-in">
      {/* Shimmer top line */}
      <div className="h-px w-full relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent shimmer" />
      </div>

      {/* Collapsed summary bar */}
      <button
        onClick={() => setIsExpanded(prev => !prev)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left group hover:bg-zinc-800/20 transition-colors duration-150"
      >
        {/* Spinner */}
        <div className="relative shrink-0">
          <Loader2 size={14} className="animate-spin text-indigo-400/70" />
        </div>

        {/* Latest status */}
        <div className="flex-1 flex items-center gap-2 min-w-0">
          {latestLevel && (
            <span className={`shrink-0 ${latestLevel.color}`}>
              {latestLevel.icon}
            </span>
          )}
          {latestLevel && (
            <span className={`shrink-0 font-bold uppercase tracking-wider text-[8px] ${latestLevel.color}`}>
              {latestLevel.label}
            </span>
          )}
          <span className="text-[11px] text-zinc-300 truncate font-medium">
            {latestEntry?.message || 'Working...'}
          </span>
        </div>

        {/* Queue badge */}
        {queueCount > 0 && (
          <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-[9px] font-bold tabular-nums">
            {queueCount} queued
          </span>
        )}

        {/* Log count + expand toggle */}
        {activityLog.length > 0 && (
          <span className="shrink-0 flex items-center gap-1 text-zinc-600 group-hover:text-zinc-400 transition-colors text-[10px]">
            <span className="tabular-nums font-medium">{activityLog.length}</span>
            {isExpanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </span>
        )}
      </button>

      {/* Expanded activity log */}
      <div
        className={`
          transition-all duration-300 ease-out overflow-hidden
          ${isExpanded ? 'max-h-52 opacity-100' : 'max-h-0 opacity-0'}
        `}
      >
        <div className="border-t border-zinc-800/20 bg-[#060606]/80 max-h-48 overflow-y-auto custom-scrollbar px-3 py-1.5 space-y-0">
          {activityLog.map((entry, idx) => {
            const cfg = getLevel(entry.level);
            return (
              <div
                key={entry.id}
                className="flex items-start gap-2 py-0.5 text-[10px] font-mono leading-tight animate-fade-in"
                style={{ animationDelay: `${Math.min(idx * 0.02, 0.2)}s` }}
              >
                <span className="text-zinc-600/50 shrink-0 w-[52px] text-right tabular-nums">
                  {entry.timestamp}
                </span>
                <span className={`shrink-0 mt-px ${cfg.color}`}>{cfg.icon}</span>
                <span className={`shrink-0 font-bold uppercase tracking-wider text-[7px] mt-0.5 w-[42px] ${cfg.color}`}>
                  {cfg.label}
                </span>
                <span className="text-zinc-400 break-all">{entry.message}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default AgentActivityPanel;
