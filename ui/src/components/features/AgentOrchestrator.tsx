import React from 'react';
import { ArrowRightLeft } from 'lucide-react';

interface AgentOrchestratorProps {
  from: string;
  to: string;
  task: string;
}

const AgentOrchestrator: React.FC<AgentOrchestratorProps> = ({ from, to, task }) => (
  <div className="flex items-center gap-4 py-4 px-6 rounded-2xl bg-indigo-600/5 border border-indigo-500/10 my-4 animate-in slide-in-from-left-4">
    <div className="flex -space-x-3">
      <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-indigo-400 font-bold text-[10px]">{from[0]}</div>
      <div className="w-8 h-8 rounded-lg bg-indigo-600 border border-indigo-500 flex items-center justify-center text-white shadow-lg">
        <ArrowRightLeft size={14} />
      </div>
      <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-emerald-400 font-bold text-[10px]">{to[0]}</div>
    </div>
    <div className="flex-1">
      <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest leading-none mb-1">Handing Off Control</p>
      <p className="text-[11px] text-zinc-400">Persona <span className="text-zinc-200 font-bold">{from}</span> delegating <span className="text-zinc-200 font-bold">{task}</span> to <span className="text-zinc-200 font-bold">{to}</span></p>
    </div>
  </div>
);

export default AgentOrchestrator;
