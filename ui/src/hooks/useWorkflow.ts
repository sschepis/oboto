import { useState, useEffect, useCallback, useRef } from 'react';
import { wsService } from '../services/wsService';

export interface WorkflowStep {
  bubbleName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface WorkflowInteraction {
  interactionId: string;
  workflowId: string;
  surfaceId: string;
  prompt: string;
  schema?: Record<string, unknown>;
  createdAt: number;
}

export interface Workflow {
  workflowId: string;
  surfaceId: string;
  flowName: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  steps: WorkflowStep[];
  currentStep: number;
  startedAt: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
}

export function useWorkflow() {
  const [workflows, setWorkflows] = useState<Record<string, Workflow>>({});
  const [pendingInteractions, setPendingInteractions] = useState<WorkflowInteraction[]>([]);
  const [loading, setLoading] = useState(false);
  const workflowsRef = useRef(workflows);
  useEffect(() => { workflowsRef.current = workflows; }, [workflows]);

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(wsService.on('workflow-started', (payload: unknown) => {
      const data = payload as { workflowId: string; surfaceId: string; flowName: string };
      setWorkflows(prev => ({
        ...prev,
        [data.workflowId]: {
          workflowId: data.workflowId,
          surfaceId: data.surfaceId,
          flowName: data.flowName || 'Workflow',
          status: 'running',
          steps: [],
          currentStep: 0,
          startedAt: Date.now(),
        },
      }));
    }));

    unsubs.push(wsService.on('workflow-step', (payload: unknown) => {
      const data = payload as { workflowId: string; step: WorkflowStep; stepIndex: number };
      setWorkflows(prev => {
        const wf = prev[data.workflowId];
        if (!wf) return prev;
        const steps = [...wf.steps];
        steps[data.stepIndex] = data.step;
        return {
          ...prev,
          [data.workflowId]: { ...wf, steps, currentStep: data.stepIndex },
        };
      });
    }));

    unsubs.push(wsService.on('workflow-interaction-needed', (payload: unknown) => {
      const data = payload as WorkflowInteraction;
      setPendingInteractions(prev => [...prev, data]);
      setWorkflows(prev => {
        const wf = prev[data.workflowId];
        if (!wf) return prev;
        return {
          ...prev,
          [data.workflowId]: { ...wf, status: 'paused' },
        };
      });
    }));

    unsubs.push(wsService.on('workflow-completed', (payload: unknown) => {
      const data = payload as { workflowId: string; result: unknown };
      setWorkflows(prev => {
        const wf = prev[data.workflowId];
        if (!wf) return prev;
        return {
          ...prev,
          [data.workflowId]: {
            ...wf,
            status: 'completed',
            result: data.result,
            completedAt: Date.now(),
          },
        };
      });
    }));

    unsubs.push(wsService.on('workflow-error', (payload: unknown) => {
      const data = payload as { workflowId: string; error: string };
      setWorkflows(prev => {
        const wf = prev[data.workflowId];
        if (!wf) return prev;
        return {
          ...prev,
          [data.workflowId]: {
            ...wf,
            status: 'failed',
            error: data.error,
            completedAt: Date.now(),
          },
        };
      });
    }));

    unsubs.push(wsService.on('workflow-cancelled', (payload: unknown) => {
      const data = payload as { workflowId: string };
      setWorkflows(prev => {
        const wf = prev[data.workflowId];
        if (!wf) return prev;
        return {
          ...prev,
          [data.workflowId]: { ...wf, status: 'cancelled', completedAt: Date.now() },
        };
      });
    }));

    unsubs.push(wsService.on('workflow-list', (payload: unknown) => {
      const list = payload as Workflow[];
      const map: Record<string, Workflow> = {};
      for (const wf of list) {
        map[wf.workflowId] = wf;
      }
      setWorkflows(map);
      setLoading(false);
    }));

    unsubs.push(wsService.on('workflow-status', (payload: unknown) => {
      const wf = payload as Workflow;
      setWorkflows(prev => ({ ...prev, [wf.workflowId]: wf }));
    }));

    unsubs.push(wsService.on('workflow-interaction-submitted', (_payload: unknown) => {
      // Interaction was accepted — remove from pending
      const data = _payload as { workflowId: string; interactionId: string };
      setPendingInteractions(prev =>
        prev.filter(i => i.interactionId !== data.interactionId)
      );
      setWorkflows(prev => {
        const wf = prev[data.workflowId];
        if (!wf) return prev;
        return {
          ...prev,
          [data.workflowId]: { ...wf, status: 'running' },
        };
      });
    }));

    return () => unsubs.forEach(fn => fn());
  }, []);

  const startWorkflow = useCallback((surfaceId: string, flowScript: string, flowName?: string) => {
    wsService.startWorkflow(surfaceId, flowScript, flowName);
  }, []);

  const submitInteraction = useCallback((workflowId: string, interactionId: string, data: Record<string, unknown>) => {
    wsService.submitWorkflowInteraction(workflowId, interactionId, data);
  }, []);

  const cancelWorkflow = useCallback((workflowId: string) => {
    wsService.cancelWorkflow(workflowId);
  }, []);

  const refreshWorkflows = useCallback(() => {
    setLoading(true);
    wsService.listWorkflows();
  }, []);

  const getWorkflowsForSurface = useCallback((surfaceId: string) => {
    return Object.values(workflowsRef.current).filter(wf => wf.surfaceId === surfaceId);
  }, []);

  const getInteractionsForSurface = useCallback((surfaceId: string) => {
    return pendingInteractions.filter(i => i.surfaceId === surfaceId);
  }, [pendingInteractions]);

  return {
    workflows,
    pendingInteractions,
    loading,
    startWorkflow,
    submitInteraction,
    cancelWorkflow,
    refreshWorkflows,
    getWorkflowsForSurface,
    getInteractionsForSurface,
  };
}
