import React, { useState, useEffect } from 'react';
import {
  Server, Loader2, CheckCircle2, XCircle, AlertCircle,
  Trash2, RefreshCw, Play, Pause, Calendar, Clock,
  Terminal, X, ChevronRight, Copy, Zap
} from 'lucide-react';
import { useTaskManager, type TaskRecord, type ScheduleRecord } from '../../hooks/useTaskManager';

interface TaskManagerPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const TaskManagerPanel: React.FC<TaskManagerPanelProps> = ({ isOpen, onClose }) => {
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

  if (!isOpen) return null;

  const runningCount = tasks.filter(t => t.status === 'running').length;
  const activeScheduleCount = schedules.filter(s => s.status === 'active').length;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md animate-fade-in" 
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-4xl h-[80vh] bg-[#0a0a0a] border border-zinc-800/60 rounded-2xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden animate-scale-in">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/40 bg-zinc-900/20">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/15">
              <Server className="text-indigo-400" size={16} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-100">Task Manager</h2>
              {runningCount > 0 && (
                <span className="text-[10px] text-amber-400 font-medium">
                  {runningCount} running
                </span>
              )}
            </div>
          </div>
          
          {/* Tab Switcher */}
          <div className="flex bg-zinc-900/60 rounded-xl p-1 border border-zinc-800/40">
            <button 
              onClick={() => setActiveTab('tasks')}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 flex items-center gap-2 ${
                activeTab === 'tasks' 
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20' 
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              <Zap size={12} />
              Tasks
              {runningCount > 0 && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-amber-500/20 text-amber-400 tabular-nums">
                  {runningCount}
                </span>
              )}
            </button>
            <button 
              onClick={() => setActiveTab('schedules')}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 flex items-center gap-2 ${
                activeTab === 'schedules' 
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20' 
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              <Calendar size={12} />
              Schedules
              {activeScheduleCount > 0 && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-emerald-500/20 text-emerald-400 tabular-nums">
                  {activeScheduleCount}
                </span>
              )}
            </button>
          </div>

          <button 
            onClick={onClose} 
            className="p-2 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 rounded-lg transition-all duration-150 active:scale-90"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
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
    </div>
  );
};

// --- Tasks Tab Components ---

const TasksList: React.FC<{ 
  tasks: TaskRecord[], 
  onCancel: (id: string) => void,
  expandedId: string | null,
  setExpandedId: (id: string | null) => void
}> = ({ tasks, onCancel, expandedId, setExpandedId }) => {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-4 mt-16 animate-fade-in">
        <div className="relative">
          <div className="absolute inset-0 bg-indigo-500/5 blur-2xl rounded-full" />
          <Server size={48} strokeWidth={1} className="opacity-30 relative" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-zinc-400">No tasks found</p>
          <p className="text-xs text-zinc-600">Active and recent tasks will appear here</p>
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
    <div className="space-y-3">
      {sortedTasks.map((task, idx) => (
        <TaskItem 
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

const TaskItem: React.FC<{ 
  task: TaskRecord, 
  onCancel: (id: string) => void,
  isExpanded: boolean,
  onToggle: () => void,
  index: number
}> = ({ task, onCancel, isExpanded, onToggle, index }) => {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'running': return { 
        color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', 
        icon: <Loader2 size={12} className="animate-spin" /> 
      };
      case 'completed': return { 
        color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', 
        icon: <CheckCircle2 size={12} /> 
      };
      case 'failed': return { 
        color: 'text-red-400 bg-red-500/10 border-red-500/20', 
        icon: <XCircle size={12} /> 
      };
      case 'cancelled': return { 
        color: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20', 
        icon: <AlertCircle size={12} /> 
      };
      default: return { 
        color: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20', 
        icon: <Clock size={12} /> 
      };
    }
  };

  const statusConfig = getStatusConfig(task.status);

  return (
    <div 
      className={`border rounded-xl transition-all duration-200 animate-fade-in-up ${
        isExpanded 
          ? 'bg-zinc-900/40 border-zinc-700/50 shadow-lg shadow-black/20' 
          : 'bg-[#0e0e0e] border-zinc-800/40 hover:border-zinc-700/40 hover:bg-zinc-900/20'
      }`}
      style={{ animationDelay: `${index * 0.03}s` }}
    >
      <div className="p-4 flex items-center gap-4 cursor-pointer select-none" onClick={onToggle}>
        <button className="text-zinc-600 hover:text-zinc-300 transition-all duration-200">
          <ChevronRight size={14} className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
        </button>
        
        <div className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1.5 w-24 justify-center shrink-0 ${statusConfig.color}`}>
          {statusConfig.icon}
          <span>{task.status}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="font-semibold text-sm text-zinc-200 truncate">{task.description}</h3>
            <span className="text-[9px] font-mono text-zinc-600 bg-zinc-900/60 px-1.5 py-0.5 rounded border border-zinc-800/40 shrink-0">
              {task.id}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-zinc-600 tabular-nums">
            <span>Created {new Date(task.createdAt).toLocaleTimeString()}</span>
            {task.completedAt && (
              <>
                <span className="text-zinc-800">·</span>
                <span>Finished {new Date(task.completedAt).toLocaleTimeString()}</span>
              </>
            )}
          </div>
        </div>

        {task.status === 'running' && (
          <div className="w-24 shrink-0">
            <div className="w-full h-1.5 bg-zinc-800/50 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-500 ease-out relative rounded-full" 
                style={{ width: `${task.progress}%` }}
              >
                <div className="absolute inset-0 shimmer" />
              </div>
            </div>
            <span className="text-[9px] text-zinc-600 tabular-nums mt-0.5 block text-right">{task.progress}%</span>
          </div>
        )}

        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {task.status === 'running' && (
            <button 
              onClick={() => onCancel(task.id)}
              className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all duration-150 active:scale-90"
              title="Cancel Task"
            >
              <XCircle size={14} />
            </button>
          )}
          {task.status === 'completed' && (
            <button 
              onClick={() => navigator.clipboard.writeText(task.result || '')}
              className="p-1.5 text-zinc-500 hover:text-emerald-400 hover:bg-emerald-400/10 rounded-lg transition-all duration-150 active:scale-90"
              title="Copy Result"
            >
              <Copy size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Expanded content with smooth transition */}
      <div className={`overflow-hidden transition-all duration-200 ${isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="px-4 pb-4 pt-2 border-t border-zinc-800/30">
          <div className="mt-2">
            <div className="flex items-center gap-2 mb-2 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
              <Terminal size={10} /> Output Log
            </div>
            <div className="bg-black/40 rounded-lg border border-zinc-800/40 p-3 font-mono text-[11px] text-zinc-500 max-h-60 overflow-y-auto custom-scrollbar">
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
            <div className="mt-3 p-3 bg-red-500/5 border border-red-500/15 rounded-lg text-red-400 text-xs animate-fade-in">
              <strong className="block mb-1 text-red-300">Error Details:</strong>
              <pre className="whitespace-pre-wrap font-mono text-[11px]">{task.error}</pre>
            </div>
          )}
          
          {task.result && (
            <div className="mt-3 p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg text-emerald-400/80 text-xs animate-fade-in">
              <strong className="block mb-1 text-emerald-400">Result:</strong>
              <div className="whitespace-pre-wrap max-h-40 overflow-y-auto custom-scrollbar font-mono text-[11px]">
                {task.result}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Schedules Tab Components ---

const SchedulesList: React.FC<{ 
  schedules: ScheduleRecord[], 
  onPause: (id: string) => void,
  onResume: (id: string) => void,
  onDelete: (id: string) => void,
  onTrigger: (id: string) => void
}> = ({ schedules, onPause, onResume, onDelete, onTrigger }) => {
  if (schedules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-4 mt-16 animate-fade-in">
        <div className="relative">
          <div className="absolute inset-0 bg-indigo-500/5 blur-2xl rounded-full" />
          <Calendar size={48} strokeWidth={1} className="opacity-30 relative" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-zinc-400">No schedules configured</p>
          <p className="text-xs text-zinc-600">Use the AI to create one: "Check server status every 5 minutes"</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {schedules.map((schedule, idx) => (
        <ScheduleItem 
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

const ScheduleItem: React.FC<{ 
  schedule: ScheduleRecord, 
  onPause: (id: string) => void,
  onResume: (id: string) => void,
  onDelete: (id: string) => void,
  onTrigger: (id: string) => void,
  index: number
}> = ({ schedule, onPause, onResume, onDelete, onTrigger, index }) => {
  const isActive = schedule.status === 'active';

  return (
    <div 
      className="bg-[#0e0e0e] border border-zinc-800/40 rounded-xl p-4 flex items-center justify-between hover:border-zinc-700/40 hover:bg-zinc-900/20 transition-all duration-200 animate-fade-in-up group"
      style={{ animationDelay: `${index * 0.04}s` }}
    >
      <div className="flex items-center gap-4">
        <div className={`p-2.5 rounded-xl transition-all duration-200 ${
          isActive 
            ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/15' 
            : 'bg-zinc-800/40 text-zinc-500 border border-zinc-800/40'
        }`}>
          <RefreshCw size={16} className={isActive ? 'animate-[spin_3s_linear_infinite]' : ''} />
        </div>
        
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm text-zinc-200">{schedule.name}</h3>
            <span className={`px-1.5 py-0.5 text-[8px] uppercase font-black tracking-wider rounded border transition-all duration-200 ${
              isActive 
                ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10' 
                : 'text-amber-400 border-amber-500/20 bg-amber-500/10'
            }`}>
              {schedule.status}
            </span>
          </div>
          <p className="text-[11px] text-zinc-500">{schedule.description}</p>
          <div className="flex items-center gap-3 mt-1 text-[10px] font-mono text-zinc-600 tabular-nums">
            <span className="flex items-center gap-1">
              <Clock size={9} className="text-zinc-700" />
              {(schedule.intervalMs / 1000 / 60).toFixed(0)}m interval
            </span>
            <span className="text-zinc-800">·</span>
            <span>Runs: {schedule.runCount}{schedule.maxRuns ? `/${schedule.maxRuns}` : ''}</span>
            <span className="text-zinc-800">·</span>
            <span>Next: {new Date(schedule.nextRunAt).toLocaleTimeString()}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity duration-200">
        <button 
          onClick={() => onTrigger(schedule.id)}
          className="p-2 text-zinc-500 hover:text-indigo-400 hover:bg-indigo-400/10 rounded-lg transition-all duration-150 active:scale-90"
          title="Run Now"
        >
          <Play size={14} />
        </button>
        
        {isActive ? (
          <button 
            onClick={() => onPause(schedule.id)}
            className="p-2 text-zinc-500 hover:text-amber-400 hover:bg-amber-400/10 rounded-lg transition-all duration-150 active:scale-90"
            title="Pause Schedule"
          >
            <Pause size={14} />
          </button>
        ) : (
          <button 
            onClick={() => onResume(schedule.id)}
            className="p-2 text-zinc-500 hover:text-emerald-400 hover:bg-emerald-400/10 rounded-lg transition-all duration-150 active:scale-90"
            title="Resume Schedule"
          >
            <Play size={14} />
          </button>
        )}
        
        <button 
          onClick={() => onDelete(schedule.id)}
          className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all duration-150 active:scale-90"
          title="Delete Schedule"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
};

export default TaskManagerPanel;
