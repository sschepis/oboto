import React, { useState, useEffect } from 'react';
import {
  Server, Loader2, CheckCircle2, XCircle, AlertCircle,
  Trash2, RefreshCw, Play, Pause, Calendar, Clock,
  Terminal, ChevronRight, Copy, Zap, X
} from 'lucide-react';
import { useTaskManager, type TaskRecord, type ScheduleRecord } from '../../hooks/useTaskManager';

interface TaskSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

const TaskSidebar: React.FC<TaskSidebarProps> = ({ isOpen, onToggle }) => {
  const {
    tasks, schedules, cancelTask, fetchOutput,
    pauseSchedule, resumeSchedule, deleteSchedule, triggerSchedule
  } = useTaskManager();

  const [activeTab, setActiveTab] = useState<'tasks' | 'schedules'>('tasks');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (expandedTaskId) {
      fetchOutput(expandedTaskId);
    }
  }, [expandedTaskId, fetchOutput]);

  const runningCount = tasks.filter(t => t.status === 'running').length;
  const queuedCount = tasks.filter(t => t.status === 'queued').length;
  const activeScheduleCount = schedules.filter(s => s.status === 'active').length;
  const totalActive = runningCount + queuedCount + activeScheduleCount;

  if (!isOpen) return null;

  return (
    <div
      className="
        w-[340px] min-w-[280px] max-w-[400px]
        bg-[#0a0a0a] border-l border-zinc-800/60
        flex flex-col
        h-full
        shrink-0
      "
    >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/40 bg-zinc-900/20 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/15">
              <Server className="text-indigo-400" size={14} />
            </div>
            <div>
              <h2 className="text-xs font-bold text-zinc-100">Running Tasks</h2>
              <div className="flex items-center gap-2 mt-0.5">
                {runningCount > 0 && (
                  <span className="text-[9px] text-amber-400 font-medium flex items-center gap-1">
                    <Loader2 size={8} className="animate-spin" />
                    {runningCount} running
                  </span>
                )}
                {queuedCount > 0 && (
                  <span className="text-[9px] text-zinc-500 font-medium">
                    {queuedCount} queued
                  </span>
                )}
                {activeScheduleCount > 0 && (
                  <span className="text-[9px] text-emerald-400 font-medium flex items-center gap-1">
                    <RefreshCw size={8} />
                    {activeScheduleCount} scheduled
                  </span>
                )}
                {totalActive === 0 && (
                  <span className="text-[9px] text-zinc-600 font-medium">No active tasks</span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={onToggle}
            className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 rounded-lg transition-all duration-150 active:scale-90"
          >
            <X size={14} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-zinc-900/40 border-b border-zinc-800/30 px-3 py-2 gap-1 shrink-0">
          <button
            onClick={() => setActiveTab('tasks')}
            className={`flex-1 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all duration-200 flex items-center justify-center gap-1.5 ${
              activeTab === 'tasks'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <Zap size={10} />
            Tasks
            {runningCount > 0 && (
              <span className="px-1.5 py-0.5 text-[8px] font-bold rounded-full bg-amber-500/20 text-amber-400 tabular-nums">
                {runningCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('schedules')}
            className={`flex-1 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all duration-200 flex items-center justify-center gap-1.5 ${
              activeTab === 'schedules'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <Calendar size={10} />
            Schedules
            {activeScheduleCount > 0 && (
              <span className="px-1.5 py-0.5 text-[8px] font-bold rounded-full bg-emerald-500/20 text-emerald-400 tabular-nums">
                {activeScheduleCount}
              </span>
            )}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
          {activeTab === 'tasks' ? (
            <TasksList
              tasks={tasks}
              onCancel={cancelTask}
              expandedId={expandedTaskId}
              setExpandedId={setExpandedTaskId}
            />
          ) : (
            <SchedulesList
              schedules={schedules}
              onPause={pauseSchedule}
              onResume={resumeSchedule}
              onDelete={deleteSchedule}
              onTrigger={triggerSchedule}
            />
          )}
        </div>
    </div>
  );
};


// ─── Tasks Tab ──────────────────────────────────────────────────────────

const TasksList: React.FC<{
  tasks: TaskRecord[];
  onCancel: (id: string) => void;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
}> = ({ tasks, onCancel, expandedId, setExpandedId }) => {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-zinc-500 gap-3 mt-12 animate-fade-in">
        <div className="relative">
          <div className="absolute inset-0 bg-indigo-500/5 blur-2xl rounded-full" />
          <Server size={36} strokeWidth={1} className="opacity-30 relative" />
        </div>
        <div className="text-center space-y-0.5">
          <p className="text-xs font-medium text-zinc-400">No tasks found</p>
          <p className="text-[10px] text-zinc-600">Active and recent tasks appear here</p>
        </div>
      </div>
    );
  }

  const sortedTasks = [...tasks].sort((a, b) => {
    if (a.status === 'running' && b.status !== 'running') return -1;
    if (a.status !== 'running' && b.status === 'running') return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="space-y-2">
      {sortedTasks.map((task, idx) => (
        <SidebarTaskItem
          key={task.id}
          task={task}
          onCancel={onCancel}
          isExpanded={expandedId === task.id}
          onToggle={() => setExpandedId(expandedId === task.id ? null : task.id)}
          index={idx}
        />
      ))}
    </div>
  );
};

const SidebarTaskItem: React.FC<{
  task: TaskRecord;
  onCancel: (id: string) => void;
  isExpanded: boolean;
  onToggle: () => void;
  index: number;
}> = ({ task, onCancel, isExpanded, onToggle, index }) => {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'running': return {
        color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
        icon: <Loader2 size={10} className="animate-spin" />
      };
      case 'completed': return {
        color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
        icon: <CheckCircle2 size={10} />
      };
      case 'failed': return {
        color: 'text-red-400 bg-red-500/10 border-red-500/20',
        icon: <XCircle size={10} />
      };
      case 'cancelled': return {
        color: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20',
        icon: <AlertCircle size={10} />
      };
      default: return {
        color: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20',
        icon: <Clock size={10} />
      };
    }
  };

  const statusConfig = getStatusConfig(task.status);

  return (
    <div
      className={`border rounded-lg transition-all duration-200 animate-fade-in-up ${
        isExpanded
          ? 'bg-zinc-900/40 border-zinc-700/50 shadow-lg shadow-black/20'
          : 'bg-[#0e0e0e] border-zinc-800/40 hover:border-zinc-700/40 hover:bg-zinc-900/20'
      }`}
      style={{ animationDelay: `${index * 0.03}s` }}
    >
      <div className="p-3 flex items-start gap-2.5 cursor-pointer select-none" onClick={onToggle}>
        <button className="text-zinc-600 hover:text-zinc-300 transition-all duration-200 mt-0.5 shrink-0">
          <ChevronRight size={12} className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider border flex items-center gap-1 shrink-0 ${statusConfig.color}`}>
              {statusConfig.icon}
              <span>{task.status}</span>
            </span>
            <span className="text-[8px] font-mono text-zinc-700 bg-zinc-900/60 px-1 py-0.5 rounded border border-zinc-800/40 shrink-0 truncate max-w-[80px]">
              {task.id}
            </span>
          </div>
          <h3 className="font-medium text-[11px] text-zinc-200 truncate leading-tight">{task.description}</h3>
          <div className="flex items-center gap-2 text-[9px] text-zinc-600 tabular-nums mt-0.5">
            <span>{new Date(task.createdAt).toLocaleTimeString()}</span>
            {task.completedAt && (
              <>
                <span className="text-zinc-800">→</span>
                <span>{new Date(task.completedAt).toLocaleTimeString()}</span>
              </>
            )}
          </div>

          {task.status === 'running' && (
            <div className="mt-1.5">
              <div className="w-full h-1 bg-zinc-800/50 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-500 ease-out relative rounded-full"
                  style={{ width: `${task.progress}%` }}
                >
                  <div className="absolute inset-0 shimmer" />
                </div>
              </div>
              <span className="text-[8px] text-zinc-600 tabular-nums mt-0.5 block text-right">{task.progress}%</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
          {task.status === 'running' && (
            <button
              onClick={() => onCancel(task.id)}
              className="p-1 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-all duration-150 active:scale-90"
              title="Cancel Task"
            >
              <XCircle size={12} />
            </button>
          )}
          {task.status === 'completed' && (
            <button
              onClick={() => navigator.clipboard.writeText(task.result || '')}
              className="p-1 text-zinc-500 hover:text-emerald-400 hover:bg-emerald-400/10 rounded transition-all duration-150 active:scale-90"
              title="Copy Result"
            >
              <Copy size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Expanded content */}
      <div className={`overflow-hidden transition-all duration-200 ${isExpanded ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="px-3 pb-3 pt-1 border-t border-zinc-800/30">
          <div className="mt-1.5">
            <div className="flex items-center gap-1.5 mb-1.5 text-[9px] font-bold text-zinc-500 uppercase tracking-wider">
              <Terminal size={9} /> Output Log
            </div>
            <div className="bg-black/40 rounded-lg border border-zinc-800/40 p-2 font-mono text-[10px] text-zinc-500 max-h-48 overflow-y-auto custom-scrollbar">
              {task.outputLog && task.outputLog.length > 0 ? (
                task.outputLog.map((line, idx) => (
                  <div key={idx} className="whitespace-pre-wrap py-0.5 border-b border-zinc-900/30 last:border-0 hover:text-zinc-300 transition-colors duration-100">
                    {line}
                  </div>
                ))
              ) : (
                <span className="italic text-zinc-700">No output logs available.</span>
              )}
            </div>
          </div>

          {task.error && (
            <div className="mt-2 p-2 bg-red-500/5 border border-red-500/15 rounded-lg text-red-400 text-[10px] animate-fade-in">
              <strong className="block mb-0.5 text-red-300">Error:</strong>
              <pre className="whitespace-pre-wrap font-mono text-[10px]">{task.error}</pre>
            </div>
          )}

          {task.result && (
            <div className="mt-2 p-2 bg-emerald-500/5 border border-emerald-500/10 rounded-lg text-emerald-400/80 text-[10px] animate-fade-in">
              <strong className="block mb-0.5 text-emerald-400">Result:</strong>
              <div className="whitespace-pre-wrap max-h-32 overflow-y-auto custom-scrollbar font-mono text-[10px]">
                {task.result}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


// ─── Schedules Tab ──────────────────────────────────────────────────────

const SchedulesList: React.FC<{
  schedules: ScheduleRecord[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onTrigger: (id: string) => void;
}> = ({ schedules, onPause, onResume, onDelete, onTrigger }) => {
  if (schedules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-zinc-500 gap-3 mt-12 animate-fade-in">
        <div className="relative">
          <div className="absolute inset-0 bg-indigo-500/5 blur-2xl rounded-full" />
          <Calendar size={36} strokeWidth={1} className="opacity-30 relative" />
        </div>
        <div className="text-center space-y-0.5">
          <p className="text-xs font-medium text-zinc-400">No schedules configured</p>
          <p className="text-[10px] text-zinc-600">Use AI: "Check server status every 5 min"</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {schedules.map((schedule, idx) => (
        <SidebarScheduleItem
          key={schedule.id}
          schedule={schedule}
          onPause={onPause}
          onResume={onResume}
          onDelete={onDelete}
          onTrigger={onTrigger}
          index={idx}
        />
      ))}
    </div>
  );
};

const SidebarScheduleItem: React.FC<{
  schedule: ScheduleRecord;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onTrigger: (id: string) => void;
  index: number;
}> = ({ schedule, onPause, onResume, onDelete, onTrigger, index }) => {
  const isActive = schedule.status === 'active';

  return (
    <div
      className="bg-[#0e0e0e] border border-zinc-800/40 rounded-lg p-3 hover:border-zinc-700/40 hover:bg-zinc-900/20 transition-all duration-200 animate-fade-in-up group"
      style={{ animationDelay: `${index * 0.04}s` }}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg transition-all duration-200 shrink-0 ${
          isActive
            ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/15'
            : 'bg-zinc-800/40 text-zinc-500 border border-zinc-800/40'
        }`}>
          <RefreshCw size={14} className={isActive ? 'animate-[spin_3s_linear_infinite]' : ''} />
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-[11px] text-zinc-200 truncate">{schedule.name}</h3>
            <span className={`px-1 py-0.5 text-[7px] uppercase font-black tracking-wider rounded border shrink-0 ${
              isActive
                ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10'
                : 'text-amber-400 border-amber-500/20 bg-amber-500/10'
            }`}>
              {schedule.status}
            </span>
          </div>
          <p className="text-[10px] text-zinc-500 truncate">{schedule.description}</p>
          <div className="flex items-center gap-2 text-[9px] font-mono text-zinc-600 tabular-nums">
            <span className="flex items-center gap-0.5">
              <Clock size={8} className="text-zinc-700" />
              {(schedule.intervalMs / 1000 / 60).toFixed(0)}m
            </span>
            <span className="text-zinc-800">·</span>
            <span>Runs: {schedule.runCount}{schedule.maxRuns ? `/${schedule.maxRuns}` : ''}</span>
            <span className="text-zinc-800">·</span>
            <span>Next: {new Date(schedule.nextRunAt).toLocaleTimeString()}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-0.5 mt-2 pt-2 border-t border-zinc-800/30 opacity-60 group-hover:opacity-100 transition-opacity duration-200">
        <button
          onClick={() => onTrigger(schedule.id)}
          className="p-1.5 text-zinc-500 hover:text-indigo-400 hover:bg-indigo-400/10 rounded transition-all duration-150 active:scale-90"
          title="Run Now"
        >
          <Play size={12} />
        </button>

        {isActive ? (
          <button
            onClick={() => onPause(schedule.id)}
            className="p-1.5 text-zinc-500 hover:text-amber-400 hover:bg-amber-400/10 rounded transition-all duration-150 active:scale-90"
            title="Pause Schedule"
          >
            <Pause size={12} />
          </button>
        ) : (
          <button
            onClick={() => onResume(schedule.id)}
            className="p-1.5 text-zinc-500 hover:text-emerald-400 hover:bg-emerald-400/10 rounded transition-all duration-150 active:scale-90"
            title="Resume Schedule"
          >
            <Play size={12} />
          </button>
        )}

        <button
          onClick={() => onDelete(schedule.id)}
          className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-all duration-150 active:scale-90"
          title="Delete Schedule"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
};

export default TaskSidebar;
