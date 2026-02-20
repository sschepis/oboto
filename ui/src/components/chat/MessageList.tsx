import React, { useRef, useEffect } from 'react';
import MessageItem, { type MessageActions } from './MessageItem';
import type { Message } from '../../types';
import type { ActivityLogEntry } from '../../hooks/useChat';
import { MessageSquare, Loader2, Sparkles } from 'lucide-react';

interface MessageListProps {
  messages: Message[];
  isAgentWorking: boolean;
  messageActions?: MessageActions;
  activityLog?: ActivityLogEntry[];
  /** Label shown for user messages (defaults to "You") */
  userLabel?: string;
  /** Label shown for agent messages (defaults to "Nexus") */
  agentLabel?: string;
}

/** Minimal inline thinking indicator — detailed activity is in the AgentActivityPanel above the input */
const ThinkingIndicator: React.FC<{ activityLog?: ActivityLogEntry[] }> = ({ activityLog = [] }) => {
  const latestMessage = activityLog.length > 0 ? activityLog[activityLog.length - 1].message : 'Working...';

  return (
    <div className="max-w-7xl mx-auto w-full animate-fade-in-up">
      <div className="flex items-start gap-4 pl-2">
        {/* Avatar matching AI message style */}
        <div className="relative shrink-0 mt-1">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 animate-breathe">
            <Sparkles size={14} className="text-white" />
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-amber-400 rounded-full border-2 border-[#080808] animate-pulse" />
        </div>
        
        {/* Compact thinking status */}
        <div className="flex-1 min-w-0 max-w-2xl">
          <div className="flex items-center gap-3 bg-zinc-900/50 border border-zinc-800/40 rounded-xl px-4 py-2.5 shadow-lg overflow-hidden relative">
            {/* Shimmer effect */}
            <div className="absolute inset-0 shimmer pointer-events-none" />
            <Loader2 size={14} className="animate-spin text-indigo-400 shrink-0 relative z-10" />
            <span className="text-[13px] font-medium text-zinc-300 truncate relative z-10">
              {latestMessage}
            </span>
            <span className="flex gap-0.5 shrink-0 relative z-10">
              <div className="w-1 h-1 rounded-full bg-indigo-500 animate-bounce" />
              <div className="w-1 h-1 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.2s]" />
              <div className="w-1 h-1 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.4s]" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

const MessageList: React.FC<MessageListProps> = ({ messages, isAgentWorking, messageActions, activityLog, userLabel, agentLabel }) => {
  const scrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isAgentWorking, activityLog]);

  return (
    <section ref={scrollRef} className="flex-1 w-full min-w-0 overflow-y-auto p-6 md:p-10 space-y-10 pb-48">
      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full select-none pointer-events-none animate-fade-in">
          <div className="relative mb-6">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900/50 border border-zinc-800/30 flex items-center justify-center">
              <MessageSquare size={28} className="text-zinc-600" strokeWidth={1.5} />
            </div>
            <div className="absolute -inset-4 bg-indigo-500/5 rounded-3xl blur-xl" />
          </div>
          <p className="text-zinc-600 text-sm font-medium tracking-wide mb-1">No messages yet</p>
          <p className="text-zinc-700 text-xs">Type a message or use <kbd className="px-1.5 py-0.5 bg-zinc-800/50 rounded text-zinc-500 text-[10px] font-mono border border-zinc-700/30">⌘⇧P</kbd> to open the command palette</p>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto space-y-10 w-full">
          {messages.map((msg) => (
            <MessageItem key={msg.id} message={msg} actions={messageActions} userLabel={userLabel} agentLabel={agentLabel} />
          ))}
        </div>
      )}

      {/* Inline thinking indicator — appears after the last message */}
      {isAgentWorking && <ThinkingIndicator activityLog={activityLog} />}
    </section>
  );
};

export default MessageList;
