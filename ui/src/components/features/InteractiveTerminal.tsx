import React from 'react';
import { Terminal as TerminalIcon } from 'lucide-react';

interface InteractiveTerminalProps {
  initialOutput: string[];
  promptLabel?: string;
}

const InteractiveTerminal: React.FC<InteractiveTerminalProps> = ({ initialOutput, promptLabel = "root@nexus-substrate:~#" }) => (
  <div className="w-full bg-[#050505] border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl my-4 font-mono text-[12px]">
    <div className="px-4 py-2 bg-zinc-900/80 border-b border-zinc-800 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <TerminalIcon size={12} className="text-zinc-500" />
        <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Substrate CLI</span>
      </div>
      <div className="text-[9px] text-emerald-500/50">{promptLabel}</div>
    </div>
    <div className="p-4 space-y-1 text-emerald-500/80 max-h-[300px] overflow-y-auto custom-scrollbar">
      {initialOutput?.map((line, i) => (
        <div key={i} className="flex gap-3">
          <span className="text-zinc-700 select-none">$</span>
          <span className={line.startsWith('err') ? 'text-rose-500' : ''}>{line}</span>
        </div>
      ))}
      <div className="flex gap-3 items-center">
        <span className="text-zinc-700 select-none">$</span>
        <div className="w-2 h-4 bg-emerald-500/50 animate-pulse"></div>
      </div>
    </div>
  </div>
);

export default InteractiveTerminal;
