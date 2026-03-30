import React from 'react';
import { Bot, Loader2 } from 'lucide-react';
import type { AgentInfo } from '../../hooks/useAgents';

interface AgentsSidebarPanelProps {
  agents: AgentInfo[];
  loading: boolean;
  onAgentClick: (agentId: string, agentName?: string) => void;
  onRefresh: () => void;
}

const statusDot: Record<string, string> = {
  running: 'bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.5)]',
  idle: 'bg-zinc-500',
  paused: 'bg-amber-400',
  terminated: 'bg-red-400',
  created: 'bg-blue-400',
};

const statusLabel: Record<string, string> = {
  running: 'running',
  idle: 'idle',
  paused: 'paused',
  terminated: 'terminated',
  created: 'created',
};

const AgentsSidebarPanel: React.FC<AgentsSidebarPanelProps> = ({
  agents,
  loading,
  onAgentClick,
}) => {
  if (loading && agents.length === 0) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 size={14} className="text-zinc-500 animate-spin" />
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center py-6 text-zinc-600 text-[11px] gap-1.5 px-2 text-center">
        <Bot size={18} className="text-zinc-700" />
        <span>No agents active</span>
        <span className="text-[9px] text-zinc-700">Promote a conversation to create an agent</span>
      </div>
    );
  }

  // Sort: non-terminated first, then by lastActivity
  const sortedAgents = [...agents].sort((a, b) => {
    if (a.status === 'terminated' && b.status !== 'terminated') return 1;
    if (a.status !== 'terminated' && b.status === 'terminated') return -1;
    const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
    const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
    return bTime - aTime;
  });

  return (
    <div className="flex flex-col gap-0.5">
      {sortedAgents.map(agent => (
        <button
          key={agent.id}
          onClick={() => onAgentClick(agent.id, agent.name)}
          className={`
            flex items-center gap-2 px-2 py-2 rounded-md
            hover:bg-indigo-500/5 transition-all duration-200
            group text-left w-full
            border border-transparent hover:border-indigo-500/10
            ${agent.status === 'terminated' ? 'opacity-40' : ''}
          `}
        >
          {/* Status dot */}
          <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot[agent.status] || statusDot.idle}`} />

          {/* Agent name & info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <Bot size={11} className="text-cyan-400 shrink-0" />
              <span className="text-[11px] text-zinc-300 truncate font-medium">
                {agent.name}
              </span>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[9px] text-zinc-600">
                {statusLabel[agent.status] || agent.status}
              </span>
              {agent.messageCount > 0 && (
                <span className="text-[9px] text-zinc-700">
                  · {agent.messageCount} msgs
                </span>
              )}
            </div>
          </div>

          {/* Visibility badge */}
          <span className={`
            text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded shrink-0
            ${agent.visibility === 'global'
              ? 'text-indigo-400 bg-indigo-500/10'
              : 'text-zinc-500 bg-zinc-800/50'
            }
          `}>
            {agent.visibility === 'global' ? 'G' : 'W'}
          </span>
        </button>
      ))}
    </div>
  );
};

export default AgentsSidebarPanel;
