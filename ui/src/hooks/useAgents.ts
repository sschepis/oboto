/**
 * useAgents — React hook for managing promoted conversation agents.
 *
 * Provides state and actions for listing, promoting, messaging,
 * pausing, resuming, terminating, history management, and
 * global promotion of conversation agents.
 *
 * @module ui/src/hooks/useAgents
 */

import { useState, useEffect, useCallback } from 'react';
import { wsService } from '../services/wsService';

/** History message from an agent's conversation. */
export interface AgentHistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

/** Summary info for a promoted agent. */
export interface AgentInfo {
  id: string;
  name: string;
  status: 'created' | 'running' | 'paused' | 'idle' | 'terminated';
  parentConversation: string;
  messageCount: number;
  createdAt: string;
  lastActivity: string | null;
  persona?: string;
  visibility: 'workspace' | 'global';
}

/** Promotion result from the server. */
export interface PromotionResult {
  agentId: string;
  agentName: string;
  status: string;
  parentConversation: string;
}

/** Agent report from the server. */
export interface AgentReport {
  agentId: string;
  report: string;
  timestamp: string;
}

export function useAgents() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [lastPromotion, setLastPromotion] = useState<PromotionResult | null>(null);
  const [lastReport, setLastReport] = useState<AgentReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [agentHistories, setAgentHistories] = useState<Record<string, AgentHistoryMessage[]>>({});

  // Subscribe to WS events
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(
      wsService.on('agent-list', (payload: unknown) => {
        setAgents(payload as AgentInfo[]);
        setLoading(false);
      })
    );

    unsubs.push(
      wsService.on('conversation-promoted', (payload: unknown) => {
        setLastPromotion(payload as PromotionResult);
        // Refresh the agent list
        wsService.listAgents();
      })
    );

    unsubs.push(
      wsService.on('agent-status', (payload: unknown) => {
        const status = payload as { agentId: string; status: string };
        setAgents(prev =>
          prev.map(a =>
            a.id === status.agentId ? { ...a, status: status.status as AgentInfo['status'] } : a
          )
        );
      })
    );

    unsubs.push(
      wsService.on('agent-report', (payload: unknown) => {
        const report = payload as AgentReport;
        setLastReport(report);
        // Append the agent's response to the cached history
        setAgentHistories(prev => {
          const existing = prev[report.agentId] || [];
          return {
            ...prev,
            [report.agentId]: [
              ...existing,
              { role: 'assistant' as const, content: report.report, timestamp: report.timestamp },
            ],
          };
        });
      })
    );

    unsubs.push(
      wsService.on('agent-terminated', (payload: unknown) => {
        const { agentId } = payload as { agentId: string };
        setAgents(prev =>
          prev.map(a =>
            a.id === agentId ? { ...a, status: 'terminated' as const } : a
          )
        );
      })
    );

    // Agent history response
    unsubs.push(
      wsService.on('agent-history', (payload: unknown) => {
        const { agentId, history } = payload as { agentId: string; history: AgentHistoryMessage[] };
        setAgentHistories(prev => ({
          ...prev,
          [agentId]: history || [],
        }));
      })
    );

    // Agent history cleared
    unsubs.push(
      wsService.on('agent-history-cleared', (payload: unknown) => {
        const { agentId } = payload as { agentId: string; success: boolean };
        setAgentHistories(prev => ({
          ...prev,
          [agentId]: [],
        }));
      })
    );

    // Agent promoted to global
    unsubs.push(
      wsService.on('agent-promoted-global', (payload: unknown) => {
        const { agentId } = payload as { agentId: string; visibility: string };
        setAgents(prev =>
          prev.map(a =>
            a.id === agentId ? { ...a, visibility: 'global' as const } : a
          )
        );
      })
    );

    // Fetch initial list when connected
    unsubs.push(
      wsService.on('connected', () => {
        wsService.listAgents();
      })
    );

    // Request agent list on mount
    wsService.listAgents();

    return () => {
      unsubs.forEach(fn => fn());
    };
  }, []);

  const promoteConversation = useCallback(
    (opts: {
      conversationName: string;
      agentName?: string;
      mode?: 'fork' | 'in-place';
      instruction?: string;
      persona?: string;
    }) => {
      wsService.promoteConversation(opts);
    },
    []
  );

  const sendMessage = useCallback((agentId: string, message: string) => {
    // Append user message to history immediately for optimistic UI
    setAgentHistories(prev => {
      const existing = prev[agentId] || [];
      return {
        ...prev,
        [agentId]: [
          ...existing,
          { role: 'user' as const, content: message, timestamp: new Date().toISOString() },
        ],
      };
    });
    wsService.sendAgentMessage(agentId, message);
  }, []);

  const terminateAgent = useCallback((agentId: string) => {
    wsService.terminateAgent(agentId);
  }, []);

  const pauseAgent = useCallback((agentId: string) => {
    wsService.pauseAgent(agentId);
  }, []);

  const resumeAgent = useCallback((agentId: string) => {
    wsService.resumeAgent(agentId);
  }, []);

  const refreshAgents = useCallback(() => {
    setLoading(true);
    wsService.listAgents();
  }, []);

  const getAgentHistory = useCallback((agentId: string) => {
    wsService.getAgentHistory(agentId);
  }, []);

  const clearAgentHistory = useCallback((agentId: string) => {
    wsService.clearAgentHistory(agentId);
  }, []);

  const promoteToGlobal = useCallback((agentId: string) => {
    wsService.promoteAgentToGlobal(agentId);
  }, []);

  return {
    agents,
    lastPromotion,
    lastReport,
    loading,
    agentHistories,
    promoteConversation,
    sendMessage,
    terminateAgent,
    pauseAgent,
    resumeAgent,
    refreshAgents,
    getAgentHistory,
    clearAgentHistory,
    promoteToGlobal,
  };
}
