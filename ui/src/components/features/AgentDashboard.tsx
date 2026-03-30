import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bot, Send, Trash2, Pause, Play, Square, Globe, Clock, MessageSquare, User, Cpu } from 'lucide-react';
import type { AgentInfo, AgentHistoryMessage } from '../../hooks/useAgents';

interface AgentDashboardProps {
  agentId: string;
  agent: AgentInfo | null;
  history: AgentHistoryMessage[];
  onSendMessage: (agentId: string, message: string) => void;
  onPause: (agentId: string) => void;
  onResume: (agentId: string) => void;
  onTerminate: (agentId: string) => void;
  onClearHistory: (agentId: string) => void;
  onPromoteToGlobal: (agentId: string) => void;
  onGetHistory: (agentId: string) => void;
}

const statusColors: Record<string, string> = {
  running: 'text-green-400',
  idle: 'text-zinc-400',
  paused: 'text-amber-400',
  terminated: 'text-red-400',
  created: 'text-blue-400',
};

const statusDot: Record<string, string> = {
  running: 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]',
  idle: 'bg-zinc-500',
  paused: 'bg-amber-400',
  terminated: 'bg-red-400',
  created: 'bg-blue-400',
};

function formatDate(iso: string | null): string {
  if (!iso) return 'Unknown';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const AgentDashboard: React.FC<AgentDashboardProps> = ({
  agentId,
  agent,
  history,
  onSendMessage,
  onPause,
  onResume,
  onTerminate,
  onClearHistory,
  onPromoteToGlobal,
  onGetHistory,
}) => {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch history on mount
  useEffect(() => {
    onGetHistory(agentId);
  }, [agentId, onGetHistory]);

  // Auto-scroll to bottom when history changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || !agent || agent.status === 'terminated') return;
    onSendMessage(agentId, trimmed);
    setInput('');
    // Refocus input
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [input, agentId, agent, onSendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  if (!agent) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-600">
        <div className="flex flex-col items-center gap-2">
          <Bot size={32} className="text-zinc-700" />
          <span className="text-sm">Agent not found</span>
          <span className="text-xs text-zinc-700">ID: {agentId}</span>
        </div>
      </div>
    );
  }

  const isTerminated = agent.status === 'terminated';
  const isPaused = agent.status === 'paused';
  const isRunning = agent.status === 'running';

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#080808]">
      {/* ── Header Section ── */}
      <div className="border-b border-zinc-800/40 px-6 py-4 bg-[#0a0a0a]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <Bot size={20} className="text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-zinc-200">{agent.name}</h2>
                <span className={`w-2 h-2 rounded-full ${statusDot[agent.status] || statusDot.idle}`} />
                <span className={`text-[10px] font-medium uppercase tracking-wider ${statusColors[agent.status] || 'text-zinc-400'}`}>
                  {agent.status}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-[10px] text-zinc-600">
                <span className="flex items-center gap-1">
                  <Clock size={9} />
                  Created: {formatDate(agent.createdAt)}
                </span>
                <span className="flex items-center gap-1">
                  <MessageSquare size={9} />
                  {agent.messageCount} messages
                </span>
                <span className="flex items-center gap-1">
                  Parent: {agent.parentConversation}
                </span>
              </div>
            </div>
          </div>

          {/* Visibility badge + promote button */}
          <div className="flex items-center gap-2">
            <span className={`
              text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-md
              ${agent.visibility === 'global'
                ? 'text-indigo-400 bg-indigo-500/10 border border-indigo-500/20'
                : 'text-zinc-500 bg-zinc-800/50 border border-zinc-700/30'
              }
            `}>
              {agent.visibility === 'global' ? '🌐 Global' : '📁 Workspace'}
            </span>
            {agent.visibility === 'workspace' && !isTerminated && (
              <button
                onClick={() => onPromoteToGlobal(agentId)}
                className="
                  text-[10px] text-indigo-400 hover:text-indigo-300
                  px-2 py-1 rounded-md bg-indigo-500/5 hover:bg-indigo-500/10
                  border border-indigo-500/10 hover:border-indigo-500/20
                  transition-all duration-200
                  flex items-center gap-1
                "
              >
                <Globe size={10} />
                Promote to Global
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Persona Section ── */}
      {agent.persona && (
        <div className="border-b border-zinc-800/40 px-6 py-3 bg-[#0a0a0a]/50">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">
            System Prompt / Persona
          </div>
          <div className="text-[11px] text-zinc-400 leading-relaxed bg-zinc-900/30 rounded-lg p-3 border border-zinc-800/30 max-h-24 overflow-y-auto custom-scrollbar">
            {agent.persona}
          </div>
        </div>
      )}

      {/* ── Conversation Section ── */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 custom-scrollbar">
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-2">
              <MessageSquare size={24} className="text-zinc-700" />
              <span className="text-[11px]">No conversation yet</span>
              <span className="text-[10px] text-zinc-700">Send a message to start chatting with this agent</span>
            </div>
          ) : (
            history.map((msg, idx) => (
              <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                {msg.role !== 'user' && (
                  <div className="w-6 h-6 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Cpu size={12} className="text-cyan-400" />
                  </div>
                )}
                <div className={`
                  max-w-[80%] rounded-lg px-3 py-2 text-[12px] leading-relaxed
                  ${msg.role === 'user'
                    ? 'bg-indigo-500/10 border border-indigo-500/20 text-zinc-200'
                    : 'bg-zinc-900/50 border border-zinc-800/30 text-zinc-300'
                  }
                `}>
                  <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                  {msg.timestamp && (
                    <div className="text-[9px] text-zinc-600 mt-1">
                      {formatDate(msg.timestamp)}
                    </div>
                  )}
                </div>
                {msg.role === 'user' && (
                  <div className="w-6 h-6 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0 mt-0.5">
                    <User size={12} className="text-indigo-400" />
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* ── Input & Action Buttons ── */}
        <div className="border-t border-zinc-800/40 px-6 py-3 bg-[#0a0a0a]">
          {!isTerminated ? (
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isPaused ? 'Agent is paused…' : 'Send a message to this agent…'}
                disabled={isPaused}
                rows={1}
                className="
                  flex-1 bg-zinc-900/50 border border-zinc-800/40 rounded-lg
                  px-3 py-2 text-[12px] text-zinc-200 placeholder-zinc-600
                  focus:outline-none focus:border-cyan-500/30 focus:ring-1 focus:ring-cyan-500/10
                  resize-none transition-all duration-200
                  disabled:opacity-40 disabled:cursor-not-allowed
                "
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isPaused}
                className="
                  px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20
                  text-cyan-400 hover:bg-cyan-500/20 hover:text-cyan-300
                  disabled:opacity-30 disabled:cursor-not-allowed
                  transition-all duration-200
                "
              >
                <Send size={14} />
              </button>
            </div>
          ) : (
            <div className="text-center text-[11px] text-zinc-600 py-2">
              This agent has been terminated.
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => onClearHistory(agentId)}
              className="
                text-[10px] text-zinc-500 hover:text-zinc-300
                px-2 py-1 rounded-md hover:bg-zinc-800/30
                transition-all duration-200 flex items-center gap-1
              "
            >
              <Trash2 size={10} />
              Clear History
            </button>

            {!isTerminated && (
              <>
                {isPaused ? (
                  <button
                    onClick={() => onResume(agentId)}
                    className="
                      text-[10px] text-green-500 hover:text-green-400
                      px-2 py-1 rounded-md hover:bg-green-500/5
                      transition-all duration-200 flex items-center gap-1
                    "
                  >
                    <Play size={10} />
                    Resume
                  </button>
                ) : isRunning ? (
                  <button
                    onClick={() => onPause(agentId)}
                    className="
                      text-[10px] text-amber-500 hover:text-amber-400
                      px-2 py-1 rounded-md hover:bg-amber-500/5
                      transition-all duration-200 flex items-center gap-1
                    "
                  >
                    <Pause size={10} />
                    Pause
                  </button>
                ) : null}

                <button
                  onClick={() => {
                    if (window.confirm(`Terminate agent "${agent.name}"? This cannot be undone.`)) {
                      onTerminate(agentId);
                    }
                  }}
                  className="
                    text-[10px] text-red-500 hover:text-red-400
                    px-2 py-1 rounded-md hover:bg-red-500/5
                    transition-all duration-200 flex items-center gap-1
                  "
                >
                  <Square size={10} />
                  Terminate
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentDashboard;
