import React from 'react';
import { Activity } from 'lucide-react';

interface NeuralVisualizationProps {
  data?: number[];
}

const NeuralVisualization: React.FC<NeuralVisualizationProps> = ({ data = [] }) => {
  // If no data provided, use a default flat line or placeholder
  const points = data.length > 0 ? data : Array.from({ length: 8 }, () => 60);

  return (
    <div className="w-full bg-[#0d0d0d] border border-zinc-800 rounded-3xl p-8 shadow-2xl overflow-hidden relative group my-4">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Activity size={18} />
          </div>
          <span className="text-xs font-black text-zinc-200 uppercase tracking-[0.2em]">Neural Resonance Matrix</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/5 border border-emerald-500/10">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-[9px] font-mono text-emerald-500 uppercase font-bold tracking-tighter">Live Sync</span>
        </div>
      </div>
      <svg viewBox="0 0 400 120" className="w-full h-32 overflow-visible">
        <defs>
          <linearGradient id="waveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.2" />
            <stop offset="50%" stopColor="#818cf8" stopOpacity="1" />
            <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        <path
          d={`M 0 60 ${points.map((_, i) => `Q ${(i * 50) + 25} ${points[i]}, ${(i + 1) * 50} 60`).join(' ')}`}
          fill="none"
          stroke="url(#waveGrad)"
          strokeWidth="3"
          className="transition-all duration-[2000ms] ease-in-out"
        />
        {points.map((_, i) => (
          <circle key={i} cx={(i + 1) * 50} cy="60" r="2" fill="#818cf8" className="animate-pulse" />
        ))}
      </svg>
    </div>
  );
};

export default NeuralVisualization;
