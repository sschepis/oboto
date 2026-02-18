import React, { useState } from 'react';
import { Server, CheckCircle2, Loader2, Binary, ChevronDown, ChevronRight } from 'lucide-react';

interface Task {
  name: string;
  subtext?: string;
  progress: number;
  status: 'running' | 'completed';
  logs?: string[];
}

interface BackgroundSubstrateProps {
  tasks: Task[];
}

const TaskLogs: React.FC<{ logs: string[]; taskName: string }> = ({ logs, taskName }) => {
  const [collapsed, setCollapsed] = useState(() => {
    const name = taskName.toLowerCase();
    return name.includes('write_file') || name.includes('read_file');
  });

  if (!logs || logs.length === 0) return null;

  return (
    <div className="bg-black/30 rounded-lg border border-zinc-800/30 overflow-hidden mt-2">
      <div 
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-800/20 transition-colors opacity-60 hover:opacity-100"
        onClick={() => setCollapsed(!collapsed)}
      >
        <Binary size={9} className="text-zinc-500" />
        <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-wider flex-1">Telemetry</span>
        {collapsed ? <ChevronRight size={10} className="text-zinc-600"/> : <ChevronDown size={10} className="text-zinc-600"/>}
      </div>
      
      {!collapsed && (
        <div className="p-3 pt-0 space-y-0.5 border-t border-zinc-800/10">
            {logs.map((log, lIdx) => (
              <p key={lIdx} className="text-[9px] font-mono text-zinc-500 leading-tight">
                <span className="text-zinc-700 mr-2 tabular-nums">
                  [{new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})}]
                </span>
                {log}
              </p>
            ))}
        </div>
      )}
    </div>
  );
};

const BackgroundSubstrate: React.FC<BackgroundSubstrateProps> = ({ tasks }) => {
  return (
    <div className="w-full bg-[#0a0a0a] border border-zinc-800/40 rounded-2xl overflow-hidden shadow-2xl shadow-black/30 my-4 animate-fade-in-up">
      <div className="px-5 py-3.5 bg-zinc-900/20 border-b border-zinc-800/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/15">
            <Server size={14} />
          </div>
          <span className="text-[10px] font-bold text-zinc-200 uppercase tracking-[0.15em]">Background Jobs</span>
        </div>
        <span className="text-[9px] font-mono text-zinc-600 tabular-nums">{tasks.length} active</span>
      </div>
      <div className="p-5 space-y-5">
        {tasks.map((task, idx) => (
          <div key={idx} className="space-y-2.5 animate-fade-in" style={{ animationDelay: `${idx * 0.05}s` }}>
            <div className="flex justify-between items-end">
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-zinc-300 flex items-center gap-2">
                  {task.status === 'completed' 
                    ? <CheckCircle2 size={12} className="text-emerald-500" /> 
                    : <Loader2 size={12} className="animate-spin text-amber-500" />
                  }
                  {task.name}
                </p>
                {task.subtext && <p className="text-[10px] text-zinc-600 font-mono ml-5">{task.subtext}</p>}
              </div>
              <span className="text-[10px] font-mono text-indigo-400 font-bold tabular-nums">{task.progress}%</span>
            </div>
            <div className="h-1.5 w-full bg-zinc-900/50 rounded-full overflow-hidden border border-zinc-800/30">
              <div 
                className={`h-full rounded-full transition-all duration-700 ease-out relative ${
                  task.status === 'completed' 
                    ? 'bg-emerald-500' 
                    : 'bg-gradient-to-r from-indigo-500 to-indigo-400'
                }`}
                style={{ width: `${task.progress}%` }}
              >
                {task.status !== 'completed' && (
                  <div className="absolute inset-0 shimmer" />
                )}
              </div>
            </div>
            <TaskLogs logs={task.logs || []} taskName={task.name} />
          </div>
        ))}
      </div>
    </div>
  );
};

export default BackgroundSubstrate;
