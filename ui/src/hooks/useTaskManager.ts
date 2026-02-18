import { useState, useEffect, useCallback, useRef } from 'react';
import { wsService } from '../services/wsService';

export interface TaskRecord {
  id: string;
  description: string;
  query: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  error?: string;
  progress: number;
  metadata?: unknown;
  // Transients
  outputLog?: string[];
}

export interface ScheduleRecord {
  id: string;
  name: string;
  description: string;
  intervalMs: number;
  status: 'active' | 'paused';
  nextRunAt: string;
  lastRunAt?: string;
  runCount: number;
  maxRuns?: number;
}

export const useTaskManager = () => {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([]);
  
  // Ref for efficient updates without re-rendering listeners
  const tasksRef = useRef<TaskRecord[]>([]);
  const schedulesRef = useRef<ScheduleRecord[]>([]);

  // Sync refs with state
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { schedulesRef.current = schedules; }, [schedules]);

  useEffect(() => {
    // Initial fetch
    wsService.sendMessage('get-tasks');
    wsService.sendMessage('get-schedules');

    const unsubs = [
      // --- Task Events ---
      wsService.on('task-list', (payload: unknown) => {
        setTasks(payload as TaskRecord[]);
      }),
      
      wsService.on('task-spawned', (task: unknown) => {
        setTasks(prev => [task as TaskRecord, ...prev]);
      }),
      
      wsService.on('task-started', (payload: unknown) => {
        const { taskId } = payload as { taskId: string };
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'running', startedAt: new Date().toISOString() } : t));
      }),
      
      wsService.on('task-progress', (payload: unknown) => {
        const { taskId, progress } = payload as { taskId: string; progress: number };
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, progress } : t));
      }),
      
      wsService.on('task-completed', (payload: unknown) => {
        const { taskId, result } = payload as { taskId: string; result: string };
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'completed', progress: 100, result, completedAt: new Date().toISOString() } : t));
      }),
      
      wsService.on('task-failed', (payload: unknown) => {
        const { taskId, error } = payload as { taskId: string; error: string };
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'failed', error, completedAt: new Date().toISOString() } : t));
      }),
      
      wsService.on('task-cancelled', (payload: unknown) => {
        const { taskId } = payload as { taskId: string };
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'cancelled', completedAt: new Date().toISOString() } : t));
      }),

      // --- Output Streaming ---
      wsService.on('task-output', (payload: unknown) => {
        const { taskId, line } = payload as { taskId: string; line: string };
        setTasks(prev => prev.map(t => {
          if (t.id === taskId) {
            const newLog = [...(t.outputLog || []), line];
            // Keep last 1000 lines in UI memory
            if (newLog.length > 1000) newLog.shift();
            return { ...t, outputLog: newLog };
          }
          return t;
        }));
      }),
      
      wsService.on('task-output-history', (payload: unknown) => {
        const { taskId, logs } = payload as { taskId: string; logs: string[] };
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, outputLog: logs } : t));
      }),

      // --- Schedule Events ---
      wsService.on('schedule-list', (list: unknown) => {
        setSchedules(list as ScheduleRecord[]);
      }),
      
      wsService.on('schedule-created', (schedule: unknown) => {
        setSchedules(prev => [...prev, schedule as ScheduleRecord]);
      }),
      
      wsService.on('schedule-paused', (payload: unknown) => {
        const { scheduleId } = payload as { scheduleId: string };
        setSchedules(prev => prev.map(s => s.id === scheduleId ? { ...s, status: 'paused' } : s));
      }),
      
      wsService.on('schedule-resumed', (payload: unknown) => {
        const { scheduleId } = payload as { scheduleId: string };
        setSchedules(prev => prev.map(s => s.id === scheduleId ? { ...s, status: 'active' } : s));
      }),
      
      wsService.on('schedule-deleted', (payload: unknown) => {
        const { scheduleId } = payload as { scheduleId: string };
        setSchedules(prev => prev.filter(s => s.id !== scheduleId));
      }),
      
      wsService.on('schedule-fired', (payload: unknown) => {
        const { scheduleId, runCount } = payload as { scheduleId: string; runCount: number };
        setSchedules(prev => prev.map(s => s.id === scheduleId ? { ...s, runCount, lastRunAt: new Date().toISOString() } : s));
      })
    ];

    return () => unsubs.forEach(u => u());
  }, []);

  // Actions
  const cancelTask = useCallback((taskId: string) => {
    wsService.sendMessage('cancel-task', { task_id: taskId });
  }, []);

  const fetchOutput = useCallback((taskId: string) => {
    wsService.sendMessage('get-task-output', { task_id: taskId });
  }, []);

  const pauseSchedule = useCallback((scheduleId: string) => {
    wsService.sendMessage('pause-schedule', { schedule_id: scheduleId });
  }, []);

  const resumeSchedule = useCallback((scheduleId: string) => {
    wsService.sendMessage('resume-schedule', { schedule_id: scheduleId });
  }, []);

  const deleteSchedule = useCallback((scheduleId: string) => {
    wsService.sendMessage('delete-schedule', { schedule_id: scheduleId });
  }, []);

  const triggerSchedule = useCallback((scheduleId: string) => {
    wsService.sendMessage('trigger-schedule', { schedule_id: scheduleId });
  }, []);

  return {
    tasks,
    schedules,
    cancelTask,
    fetchOutput,
    pauseSchedule,
    resumeSchedule,
    deleteSchedule,
    triggerSchedule
  };
};
