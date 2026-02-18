import React, { useState } from 'react';
import { ChevronRight, Brain } from 'lucide-react';

interface ThinkingStreamProps {
  thoughts: string;
}

const ThinkingStream: React.FC<ThinkingStreamProps> = ({ thoughts }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <div className="w-full mb-4 animate-fade-in">
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-zinc-900/20 border border-zinc-800/30 hover:bg-zinc-800/30 hover:border-zinc-700/30 transition-all duration-200 group w-full text-left"
      >
        <ChevronRight 
          size={12} 
          className={`text-indigo-500/70 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} 
        />
        <Brain size={12} className="text-indigo-500/50" />
        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em] group-hover:text-indigo-400/70 transition-colors duration-200">
          Thinking Process
        </span>
        <div className="flex gap-1 ml-auto">
          <div className="w-1 h-1 rounded-full bg-indigo-500/50 animate-[pulse_1.5s_ease-in-out_infinite]" />
          <div className="w-1 h-1 rounded-full bg-indigo-500/50 animate-[pulse_1.5s_ease-in-out_infinite_0.2s]" />
          <div className="w-1 h-1 rounded-full bg-indigo-500/50 animate-[pulse_1.5s_ease-in-out_infinite_0.4s]" />
        </div>
      </button>
      
      <div className={`overflow-hidden transition-all duration-300 ease-out ${isExpanded ? 'max-h-[500px] opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
        <div className="p-5 rounded-xl bg-[#0a0a0a] border border-zinc-800/30 text-[12px] text-zinc-400 leading-relaxed italic border-l-2 border-l-indigo-500/30">
          {thoughts}
        </div>
      </div>
    </div>
  );
};

export default ThinkingStream;
