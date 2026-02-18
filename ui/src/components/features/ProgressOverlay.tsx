import React from 'react';
import { Loader2, Sparkles } from 'lucide-react';

interface ProgressOverlayProps {
  isWorking: boolean;
  currentTask?: string;
}

const ProgressOverlay: React.FC<ProgressOverlayProps> = ({ isWorking, currentTask }) => {
  if (!isWorking) return null;

  return (
    <div className="absolute top-16 left-0 right-0 z-10 animate-slide-in-down pointer-events-none">
      <div className="bg-indigo-600/5 backdrop-blur-xl border-b border-indigo-500/10 px-10 py-4 flex items-center justify-between shadow-2xl shadow-indigo-500/5 pointer-events-auto">
        {/* Shimmer top line */}
        <div className="absolute top-0 left-0 right-0 h-px">
          <div className="h-full bg-gradient-to-r from-transparent via-indigo-500/30 to-transparent shimmer" />
        </div>
        
        <div className="flex items-center gap-5">
          <div className="relative">
            <Loader2 size={22} className="animate-spin text-indigo-400/40" />
            <Sparkles size={10} className="absolute inset-0 m-auto text-indigo-300 animate-glow-pulse" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400/70 leading-none mb-1.5">Active Synthesis</p>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-200 font-semibold">{currentTask || 'Initializing...'}</span>
              <span className="flex gap-0.5">
                <div className="w-0.5 h-0.5 rounded-full bg-indigo-500 animate-bounce" />
                <div className="w-0.5 h-0.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.2s]" />
                <div className="w-0.5 h-0.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.4s]" />
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-8">
          <div className="w-40 bg-zinc-900/50 h-1.5 rounded-full overflow-hidden border border-zinc-800/30">
            <div className="bg-gradient-to-r from-indigo-500 to-indigo-400 h-full w-2/3 animate-glow-pulse rounded-full relative">
              <div className="absolute inset-0 shimmer" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProgressOverlay;
