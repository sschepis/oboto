import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Terminal, X, Trash2, ChevronDown, Filter, Radio, Wrench, Brain, Zap, Loader2, AlertTriangle, AlertCircle } from 'lucide-react';
import type { ActivityLogEntry } from '../../hooks/useChat';

interface LogPanelProps {
  logs: ActivityLogEntry[];
  isOpen: boolean;
  onClose: () => void;
  onClear: () => void;
}

/** Map log levels to icons and colors — mirrors the ThinkingIndicator config */
const levelConfig: Record<string, { icon: React.ReactNode; color: string; bg: string; label: string }> = {
  ai:        { icon: <Radio size={10} />,   color: 'text-indigo-400',  bg: 'bg-indigo-500/10', label: 'AI' },
  tools:     { icon: <Wrench size={10} />,  color: 'text-amber-400',   bg: 'bg-amber-500/10',  label: 'TOOLS' },
  working:   { icon: <Zap size={10} />,     color: 'text-emerald-400', bg: 'bg-emerald-500/10',label: 'EXEC' },
  reasoning: { icon: <Brain size={10} />,   color: 'text-violet-400',  bg: 'bg-violet-500/10', label: 'REASON' },
  progress:  { icon: <Loader2 size={10} className="animate-spin" />, color: 'text-cyan-400', bg: 'bg-cyan-500/10', label: 'PROGRESS' },
  status:    { icon: <Radio size={10} />,   color: 'text-sky-400',     bg: 'bg-sky-500/10',    label: 'STATUS' },
  system:    { icon: <Radio size={10} />,   color: 'text-zinc-500',    bg: 'bg-zinc-500/10',   label: 'SYS' },
  user:      { icon: <Radio size={10} />,   color: 'text-blue-400',    bg: 'bg-blue-500/10',   label: 'USER' },
  error:     { icon: <AlertCircle size={10} />, color: 'text-red-400', bg: 'bg-red-500/10',    label: 'ERROR' },
  warning:   { icon: <AlertTriangle size={10} />, color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: 'WARN' },
  recovery:  { icon: <Radio size={10} />,   color: 'text-orange-400',  bg: 'bg-orange-500/10', label: 'RECOVERY' },
  routing:   { icon: <Radio size={10} />,   color: 'text-teal-400',    bg: 'bg-teal-500/10',   label: 'ROUTE' },
  quality:   { icon: <Radio size={10} />,   color: 'text-yellow-400',  bg: 'bg-yellow-500/10', label: 'QUALITY' },
};

const getLevel = (level: string) => levelConfig[level] || { icon: <Radio size={10} />, color: 'text-zinc-500', bg: 'bg-zinc-500/10', label: level.toUpperCase() };

const ALL_LEVELS = ['all', ...Object.keys(levelConfig)] as const;

const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 280;
const MAX_HEIGHT_RATIO = 0.65; // 65% of viewport

const LogPanel: React.FC<LogPanelProps> = ({ logs, isOpen, onClose, onClear }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  // Filtered logs
  const filteredLogs = filterLevel === 'all' ? logs : logs.filter(l => l.level === filterLevel);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredLogs, autoScroll]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(atBottom);
  }, []);

  // Resize drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartY.current = e.clientY;
    dragStartHeight.current = panelHeight;

    const handleDragMove = (me: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = dragStartY.current - me.clientY;
      const maxH = window.innerHeight * MAX_HEIGHT_RATIO;
      const newHeight = Math.max(MIN_HEIGHT, Math.min(maxH, dragStartHeight.current + delta));
      setPanelHeight(newHeight);
    };

    const handleDragEnd = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
    };

    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  }, [panelHeight]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className="fixed bottom-0 left-0 right-0 z-50 flex flex-col border-t border-zinc-700/50 shadow-2xl shadow-black/50 animate-slide-in-up"
      style={{ height: panelHeight }}
    >
      {/* Resize handle */}
      <div
        className="h-1.5 cursor-row-resize bg-zinc-800/80 hover:bg-indigo-500/30 transition-colors group flex items-center justify-center shrink-0"
        onMouseDown={handleDragStart}
      >
        <div className="w-10 h-0.5 rounded-full bg-zinc-600 group-hover:bg-indigo-400 transition-colors" />
      </div>

      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/95 border-b border-zinc-800/50 shrink-0">
        <div className="flex items-center gap-2">
          <Terminal size={13} className="text-zinc-500" />
          <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-400">Console</span>
          <span className="text-[10px] text-zinc-600 tabular-nums">({filteredLogs.length})</span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Level filter */}
          <div className="flex items-center gap-1">
            <Filter size={10} className="text-zinc-600" />
            <select
              value={filterLevel}
              onChange={(e) => setFilterLevel(e.target.value)}
              className="bg-zinc-800/60 text-zinc-400 text-[10px] font-mono border border-zinc-700/30 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 cursor-pointer"
            >
              {ALL_LEVELS.map(lvl => (
                <option key={lvl} value={lvl}>{lvl === 'all' ? 'All Levels' : lvl.toUpperCase()}</option>
              ))}
            </select>
          </div>

          {/* Scroll to bottom */}
          <button
            onClick={() => {
              setAutoScroll(true);
              scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
            }}
            className={`p-1 rounded transition-colors ${autoScroll ? 'text-indigo-400 bg-indigo-500/10' : 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/60'}`}
            title="Scroll to bottom"
          >
            <ChevronDown size={12} />
          </button>

          {/* Clear */}
          <button
            onClick={onClear}
            className="p-1 rounded text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/60 transition-colors"
            title="Clear logs"
          >
            <Trash2 size={12} />
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/60 transition-colors"
            title="Close panel"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Log feed */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-[#0c0c0c] font-mono text-[11px] leading-relaxed custom-scrollbar"
      >
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-700 text-xs select-none">
            No logs yet
          </div>
        ) : (
          <div className="py-1">
            {filteredLogs.map((entry) => {
              const cfg = getLevel(entry.level);
              return (
                <div
                  key={entry.id}
                  className={`flex items-start gap-2 px-3 py-[3px] hover:bg-white/[0.02] transition-colors group`}
                >
                  <span className="text-zinc-600/50 shrink-0 w-[62px] text-right tabular-nums select-none">{entry.timestamp}</span>
                  <span className={`shrink-0 mt-0.5 ${cfg.color} opacity-70 group-hover:opacity-100 transition-opacity`}>{cfg.icon}</span>
                  <span className={`shrink-0 font-bold uppercase tracking-wider text-[8px] mt-[2px] w-[52px] ${cfg.color} opacity-70`}>{cfg.label}</span>
                  <span className="text-zinc-400 break-all whitespace-pre-wrap">{entry.message}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default LogPanel;
