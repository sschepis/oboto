import React, { useEffect, useRef } from 'react';
import { Bot } from 'lucide-react';
import type { AgentInfo } from '../../hooks/useAgents';

interface MentionPopupProps {
  agents: AgentInfo[];
  filter: string;
  selectedIndex: number;
  onSelect: (agent: AgentInfo) => void;
  visible: boolean;
}

const statusDot: Record<string, string> = {
  running: 'bg-green-400',
  idle: 'bg-zinc-500',
  paused: 'bg-amber-400',
  terminated: 'bg-red-400',
  created: 'bg-blue-400',
};

const MentionPopup: React.FC<MentionPopupProps> = ({
  agents,
  filter,
  selectedIndex,
  onSelect,
  visible,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  // Filter agents by name matching the filter string
  const filteredAgents = agents.filter(a => {
    if (a.status === 'terminated') return false;
    if (!filter) return true;
    return a.name.toLowerCase().includes(filter.toLowerCase());
  });

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.children[selectedIndex] as HTMLElement;
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!visible || filteredAgents.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="
        absolute bottom-full left-0 mb-1 w-64 max-h-48
        bg-[#0e0e0e] border border-zinc-700/50 rounded-lg
        shadow-xl shadow-black/30 overflow-y-auto custom-scrollbar z-50
      "
    >
      <div className="px-2 py-1.5 text-[9px] font-bold uppercase tracking-wider text-zinc-600 border-b border-zinc-800/30">
        Mention an agent
      </div>
      {filteredAgents.map((agent, idx) => (
        <button
          key={agent.id}
          onClick={() => onSelect(agent)}
          className={`
            w-full flex items-center gap-2 px-3 py-2 text-left
            transition-colors duration-100
            ${idx === selectedIndex
              ? 'bg-indigo-500/10 text-zinc-200'
              : 'text-zinc-400 hover:bg-zinc-800/30 hover:text-zinc-200'
            }
          `}
        >
          <Bot size={12} className="text-cyan-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-[11px] font-medium truncate block">{agent.name}</span>
          </div>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot[agent.status] || statusDot.idle}`} />
          <span className={`
            text-[8px] font-bold uppercase tracking-wider shrink-0
            ${agent.visibility === 'global' ? 'text-indigo-400' : 'text-zinc-600'}
          `}>
            {agent.visibility === 'global' ? 'G' : 'W'}
          </span>
        </button>
      ))}
    </div>
  );
};

export default MentionPopup;
export { MentionPopup };
export type { MentionPopupProps };
