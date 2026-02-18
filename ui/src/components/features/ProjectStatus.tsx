import React, { useState } from 'react';
import { FileText, GitBranch, Box, CheckCircle2, Clock, Layers, Shield, ChevronRight } from 'lucide-react';
import { FeatureDetailsDialog } from './FeatureDetailsDialog';

// Structured dev feature from SYSTEM_MAP.md
export interface StructuredDevFeature {
  id: string;
  name: string;
  status: string;
  phase: string;
  lockLevel: string;
  priority: string;
  dependencies: string;
}

export interface StructuredDevInvariant {
  id: string;
  name: string;
  description: string;
}

export interface StructuredDevSnapshot {
  timestamp: string;
  description: string;
}

export interface StructuredDevData {
  hasManifest: boolean;
  lastUpdated: string | null;
  features: StructuredDevFeature[];
  invariants: StructuredDevInvariant[];
  snapshots: StructuredDevSnapshot[];
  totalFeatures: number;
  completedFeatures: number;
  remainingFeatures: number;
  phaseBreakdown: Record<string, number>;
}

export interface ProjectStatusData {
  cwd: string;
  projectType?: string;
  fileCount?: number;
  gitBranch?: string;
  lastModified?: string;
  structuredDev?: StructuredDevData | null;
}

interface ProjectStatusProps {
  data: ProjectStatusData;
}

const PHASE_COLORS: Record<string, string> = {
  'Discovery': 'text-blue-400 bg-blue-500/8 border-blue-500/15',
  'Design Review': 'text-amber-400 bg-amber-500/8 border-amber-500/15',
  'Interface': 'text-purple-400 bg-purple-500/8 border-purple-500/15',
  'Implementation': 'text-cyan-400 bg-cyan-500/8 border-cyan-500/15',
  'Locked': 'text-emerald-400 bg-emerald-500/8 border-emerald-500/15',
  'Completed': 'text-emerald-400 bg-emerald-500/8 border-emerald-500/15',
};

const PRIORITY_COLORS: Record<string, string> = {
  'High': 'text-red-400',
  'Medium': 'text-amber-400',
  'Low': 'text-zinc-500',
};

const ProjectStatus: React.FC<ProjectStatusProps> = ({ data }) => {
  const { projectType = 'Unknown', fileCount = 0, gitBranch, structuredDev } = data;

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Basic Project Info */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-3 rounded-xl bg-zinc-900/20 border border-zinc-800/20 space-y-1.5 transition-all duration-200 hover:border-zinc-700/30 hover:bg-zinc-900/30 group">
          <div className="flex items-center gap-2 text-zinc-500">
            <Box size={11} className="transition-colors duration-200 group-hover:text-indigo-400" />
            <span className="text-[9px] font-bold uppercase tracking-wider">Type</span>
          </div>
          <p className="text-xs font-bold text-zinc-300">{projectType}</p>
        </div>
        <div className="p-3 rounded-xl bg-zinc-900/20 border border-zinc-800/20 space-y-1.5 transition-all duration-200 hover:border-zinc-700/30 hover:bg-zinc-900/30 group">
           <div className="flex items-center gap-2 text-zinc-500">
            <FileText size={11} className="transition-colors duration-200 group-hover:text-indigo-400" />
            <span className="text-[9px] font-bold uppercase tracking-wider">Files</span>
          </div>
          <p className="text-xs font-bold text-zinc-300 tabular-nums">{fileCount.toLocaleString()}</p>
        </div>
      </div>
      
      {gitBranch && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10 text-emerald-500 transition-all duration-200 hover:border-emerald-500/20">
          <GitBranch size={11} />
          <span className="text-[10px] font-bold uppercase tracking-wider">{gitBranch}</span>
        </div>
      )}

      {/* Structured Development Project Status */}
      {structuredDev?.hasManifest && (
        <StructuredDevPanel data={structuredDev} />
      )}
    </div>
  );
};

const StructuredDevPanel: React.FC<{ data: StructuredDevData }> = ({ data }) => {
  const { totalFeatures, completedFeatures, remainingFeatures, features, phaseBreakdown, invariants, snapshots } = data;
  const [selectedFeature, setSelectedFeature] = useState<StructuredDevFeature | null>(null);

  const progressPercent = totalFeatures > 0 ? Math.round((completedFeatures / totalFeatures) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* Section Header */}
      <div className="flex items-center gap-2">
        <Layers size={13} className="text-indigo-400" />
        <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.15em]">Structured Dev</h3>
      </div>

      {/* Task Summary Card */}
      <div className="p-4 rounded-xl bg-zinc-900/20 border border-zinc-800/20 space-y-3 transition-all duration-200 hover:border-zinc-700/30">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Progress</span>
          <span className="text-[10px] font-bold text-zinc-400 tabular-nums">
            {totalFeatures > 0 ? `${progressPercent}%` : 'N/A'}
          </span>
        </div>

        {/* Progress bar */}
        {totalFeatures > 0 ? (
          <div className="w-full h-1.5 rounded-full bg-zinc-800/50 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-1000 ease-out relative"
              style={{ width: `${progressPercent}%` }}
            >
              {/* Subtle shine on progress */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent shimmer" />
            </div>
          </div>
        ) : (
          <div className="w-full h-1.5 rounded-full bg-zinc-800/30"></div>
        )}

        <div className="grid grid-cols-3 gap-2 pt-1">
          <div className="text-center">
            <p className="text-lg font-black text-zinc-200 tabular-nums">{totalFeatures}</p>
            <p className="text-[8px] font-bold text-zinc-600 uppercase tracking-wider">Total</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-black text-emerald-400 tabular-nums">{completedFeatures}</p>
            <p className="text-[8px] font-bold text-zinc-600 uppercase tracking-wider">Done</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-black text-amber-400 tabular-nums">{remainingFeatures}</p>
            <p className="text-[8px] font-bold text-zinc-600 uppercase tracking-wider">Left</p>
          </div>
        </div>
        
        {totalFeatures === 0 && (
          <p className="text-[10px] text-zinc-500 text-center italic pt-1">
            No features found in SYSTEM_MAP.md
          </p>
        )}
      </div>

      {/* Phase Breakdown */}
      {Object.keys(phaseBreakdown).length > 0 && (
        <div className="p-3 rounded-xl bg-zinc-900/20 border border-zinc-800/20 space-y-2 transition-all duration-200 hover:border-zinc-700/30">
          <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Phase Breakdown</span>
          <div className="space-y-1.5">
            {Object.entries(phaseBreakdown).map(([phase, count]) => (
              <div key={phase} className="flex items-center justify-between group/phase">
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border transition-all duration-200 ${PHASE_COLORS[phase] || 'text-zinc-400 bg-zinc-800/30 border-zinc-700/30'}`}>
                  {phase}
                </span>
                <span className="text-[10px] font-bold text-zinc-400 tabular-nums">{count as number}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feature List */}
      {features.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider px-1">Features</span>
          {features.map((feature, idx) => (
            <FeatureCard
              key={feature.id}
              feature={feature}
              index={idx}
              onClick={() => setSelectedFeature(feature)}
            />
          ))}
        </div>
      )}

      <FeatureDetailsDialog
        isOpen={!!selectedFeature}
        onClose={() => setSelectedFeature(null)}
        feature={selectedFeature}
      />

      {/* Invariants */}
      {invariants.length > 0 && (
        <div className="p-3 rounded-xl bg-zinc-900/20 border border-zinc-800/20 space-y-2 transition-all duration-200 hover:border-zinc-700/30">
          <div className="flex items-center gap-1.5">
            <Shield size={10} className="text-zinc-500" />
            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Invariants ({invariants.length})</span>
          </div>
          <div className="space-y-1">
            {invariants.map((inv) => (
              <div key={inv.id} className="flex items-start gap-1.5 text-[10px] text-zinc-500">
                <span className="text-zinc-600 font-mono shrink-0">{inv.id}</span>
                <span className="text-zinc-400">{inv.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {snapshots.length > 0 && (
        <div className="p-3 rounded-xl bg-zinc-900/20 border border-zinc-800/20 space-y-2 transition-all duration-200 hover:border-zinc-700/30">
          <div className="flex items-center gap-1.5">
            <Clock size={10} className="text-zinc-500" />
            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Recent Activity</span>
          </div>
          <div className="space-y-1.5">
            {snapshots.slice().reverse().map((snap, idx) => (
              <div key={idx} className="text-[9px] text-zinc-500 leading-relaxed">
                <span className="text-zinc-600 font-mono tabular-nums">{new Date(snap.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>{' '}
                <span className="text-zinc-400">{snap.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const FeatureCard: React.FC<{ feature: StructuredDevFeature; index: number; onClick: () => void }> = ({ feature, index, onClick }) => {
  const isComplete = feature.status === 'Completed' || feature.phase === 'Locked';
  const phaseColor = PHASE_COLORS[feature.phase] || 'text-zinc-400 bg-zinc-800/30 border-zinc-700/30';
  const priorityColor = PRIORITY_COLORS[feature.priority] || 'text-zinc-500';

  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left p-2.5 rounded-lg border transition-all duration-200 animate-fade-in group/card
        ${isComplete
          ? 'bg-emerald-500/5 border-emerald-500/10 hover:border-emerald-500/20'
          : 'bg-zinc-900/20 border-zinc-800/20 hover:border-zinc-700/30 hover:bg-zinc-900/30'}
      `}
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      <div className="flex items-start gap-2">
        <div className="pt-0.5 shrink-0">
          {isComplete ? (
            <CheckCircle2 size={12} className="text-emerald-400" />
          ) : (
            <ChevronRight size={12} className="text-zinc-600" />
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-mono text-zinc-600 group-hover/card:text-indigo-400 transition-colors">{feature.id}</span>
            <span className={`text-[8px] font-bold ${priorityColor}`}>●</span>
          </div>
          <p className={`text-[11px] font-semibold leading-tight ${isComplete ? 'text-emerald-300/60 line-through' : 'text-zinc-300 group-hover/card:text-white transition-colors'}`}>
            {feature.name}
          </p>
          <span className={`inline-block text-[8px] font-bold px-1.5 py-0.5 rounded border ${phaseColor}`}>
            {feature.phase}
          </span>
        </div>
      </div>
    </button>
  );
};

export default ProjectStatus;
