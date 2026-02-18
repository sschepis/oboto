import { useState, useEffect, useCallback } from 'react';
import { wsService } from '../services/wsService';

export type AgentLoopState = 'stopped' | 'playing' | 'paused';

export interface AgentLoopStatus {
  state: AgentLoopState;
  intervalMs: number;
  invocationCount: number;
  lastInvocationAt?: string;
}

export interface AgentLoopInvocation {
  invocationNumber: number;
  timestamp: string;
  taskId?: string;
  briefingSnippet?: string;
}

export interface AgentLoopQuestion {
  questionId: string;
  question: string;
  taskId?: string;
  timestamp: string;
}

export const useAgentLoop = () => {
  const [status, setStatus] = useState<AgentLoopStatus>({
    state: 'stopped',
    intervalMs: 180000,
    invocationCount: 0
  });
  const [lastInvocation, setLastInvocation] = useState<AgentLoopInvocation | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<AgentLoopQuestion[]>([]);

  useEffect(() => {
    // Request initial state
    wsService.getAgentLoopState();

    const unsubs = [
      wsService.on('agent-loop-state', (payload: unknown) => {
        const data = payload as AgentLoopStatus & { pendingQuestions?: AgentLoopQuestion[] };
        setStatus({
          state: data.state,
          intervalMs: data.intervalMs,
          invocationCount: data.invocationCount,
          lastInvocationAt: data.lastInvocationAt
        });
        // Sync pending questions from server state
        if (data.pendingQuestions) {
          setPendingQuestions(data.pendingQuestions);
        }
      }),

      wsService.on('agent-loop-invocation', (payload: unknown) => {
        const data = payload as AgentLoopInvocation;
        setLastInvocation(data);
        // Also update invocation count locally for immediate feedback
        setStatus(prev => ({
          ...prev,
          invocationCount: data.invocationNumber,
          lastInvocationAt: data.timestamp
        }));
      }),

      wsService.on('agent-loop-question', (payload: unknown) => {
        const data = payload as AgentLoopQuestion;
        setPendingQuestions(prev => [...prev, data]);
      }),

      // Re-request state on reconnect
      wsService.on('connected', () => {
        wsService.getAgentLoopState();
      })
    ];

    return () => unsubs.forEach(u => u());
  }, []);

  const play = useCallback((intervalMs?: number) => {
    wsService.agentLoopPlay(intervalMs);
  }, []);

  const pause = useCallback(() => {
    wsService.agentLoopPause();
  }, []);

  const stop = useCallback(() => {
    wsService.agentLoopStop();
  }, []);

  const setInterval = useCallback((intervalMs: number) => {
    wsService.agentLoopSetInterval(intervalMs);
  }, []);

  const answerQuestion = useCallback((questionId: string, answer: string) => {
    wsService.agentLoopAnswer(questionId, answer);
    // Optimistically remove the question from local state
    setPendingQuestions(prev => prev.filter(q => q.questionId !== questionId));
  }, []);

  return {
    status,
    lastInvocation,
    pendingQuestions,
    play,
    pause,
    stop,
    setInterval,
    answerQuestion
  };
};
