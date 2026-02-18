import React from 'react';
import { ArrowRightLeft } from 'lucide-react';

interface CodeDiffProps {
  filename: string;
  oldCode: string;
  newCode: string;
}

const CodeDiff: React.FC<CodeDiffProps> = ({ filename, oldCode, newCode }) => (
  <div className="w-full bg-[#0a0a0a] border border-zinc-800/40 rounded-2xl overflow-hidden shadow-2xl shadow-black/30 my-4 animate-fade-in-up">
    <div className="bg-zinc-900/30 px-5 py-3 border-b border-zinc-800/30 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="p-1 rounded-md bg-emerald-500/10">
          <ArrowRightLeft size={12} className="text-emerald-500" />
        </div>
        <span className="text-[11px] font-bold text-zinc-200">{filename}</span>
      </div>
      <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">diff</span>
    </div>
    <div className="p-0 font-mono text-[12px] leading-relaxed overflow-x-auto">
      <div className="flex bg-rose-500/5 border-l-2 border-l-rose-500/40 px-4 py-2 text-rose-300/60 line-through">
        <span className="w-6 text-rose-500/30 select-none text-right mr-3 shrink-0">-</span>
        <span>{oldCode}</span>
      </div>
      <div className="flex bg-emerald-500/5 border-l-2 border-l-emerald-500/60 px-4 py-2 text-emerald-400/80">
        <span className="w-6 text-emerald-500/30 select-none text-right mr-3 shrink-0">+</span>
        <span>{newCode}</span>
      </div>
    </div>
  </div>
);

export default CodeDiff;
