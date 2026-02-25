import React from 'react';
import { createPortal } from 'react-dom';
import { X, Layers, GitBranch, Lock, Activity, Link } from 'lucide-react';
import type { StructuredDevFeature } from './ProjectStatus';

interface FeatureDetailsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  feature: StructuredDevFeature | null;
}

const PHASE_COLORS: Record<string, string> = {
  'Discovery': 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  'Design Review': 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  'Interface': 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  'Implementation': 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  'Locked': 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  'Completed': 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
};

export const FeatureDetailsDialog: React.FC<FeatureDetailsDialogProps> = ({ isOpen, onClose, feature }) => {
  if (!isOpen || !feature) return null;

  const phaseColor = PHASE_COLORS[feature.phase] || 'text-zinc-400 bg-zinc-800/30 border-zinc-700/30';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div 
        className="w-full max-w-lg bg-[#09090b] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/30">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
              <Layers className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-100">Feature Details</h3>
              <p className="text-xs text-zinc-500 font-mono">{feature.id}</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1 text-zinc-500 hover:text-zinc-300 rounded-md hover:bg-zinc-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          
          {/* Title & Phase */}
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-zinc-100 leading-snug">{feature.name}</h2>
            <div className="flex flex-wrap gap-2">
              <div className={`px-2.5 py-1 rounded-md text-xs font-medium border flex items-center gap-1.5 ${phaseColor}`}>
                <Activity size={12} />
                {feature.phase}
              </div>
              <div className="px-2.5 py-1 rounded-md text-xs font-medium border border-zinc-800 bg-zinc-900/50 text-zinc-400 flex items-center gap-1.5">
                <GitBranch size={12} />
                {feature.status}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Priority */}
            <div className="p-3 rounded-lg bg-zinc-900/30 border border-zinc-800/50 space-y-1">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Priority</span>
              <p className={`text-sm font-semibold ${
                feature.priority === 'High' ? 'text-red-400' : 
                feature.priority === 'Medium' ? 'text-amber-400' : 'text-zinc-400'
              }`}>
                {feature.priority}
              </p>
            </div>

            {/* Lock Level */}
            <div className="p-3 rounded-lg bg-zinc-900/30 border border-zinc-800/50 space-y-1">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Lock Level</span>
              <div className="flex items-center gap-1.5 text-zinc-300">
                <Lock size={12} className="text-zinc-500" />
                <span className="text-sm font-medium">{feature.lockLevel}</span>
              </div>
            </div>
          </div>

          {/* Dependencies */}
          <div className="space-y-2">
             <div className="flex items-center gap-2 text-zinc-500">
                <Link size={12} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Dependencies</span>
             </div>
             {feature.dependencies && feature.dependencies !== 'None' ? (
               <div className="flex flex-wrap gap-2">
                 {feature.dependencies.split(',').map((dep, i) => (
                   <span key={i} className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-400 font-mono">
                     {dep.trim()}
                   </span>
                 ))}
               </div>
             ) : (
               <p className="text-xs text-zinc-600 italic">No dependencies listed</p>
             )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-zinc-900/30 border-t border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-white text-black hover:bg-zinc-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
