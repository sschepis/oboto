import React from 'react';
import { AlertTriangle, Cpu, Zap, Brain, FileText, Code } from 'lucide-react';

interface ModelCapabilities {
  id: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsToolCalling: boolean;
  supportsStreaming: boolean;
  supportsReasoningEffort: boolean;
  costTier: 'cheap' | 'medium' | 'expensive';
  reasoningCapability: 'low' | 'medium' | 'high';
}

interface ModelRoutingSettingsProps {
  routing: Record<string, string>;
  modelRegistry: Record<string, ModelCapabilities>;
  onChange: (routing: Record<string, string>) => void;
}

type RoleDefinition = {
  label: string;
  icon: React.ReactNode;
  desc: string;
  required?: string[];
};

const ROLES: Record<string, RoleDefinition> = {
  agentic: { label: 'Agentic (Tool Calling)', icon: <Zap size={14} />, desc: 'Main loop. Must support tools.', required: ['supportsToolCalling'] },
  reasoning_high: { label: 'High Reasoning', icon: <Brain size={14} />, desc: 'Complex analysis & architecture.' },
  reasoning_medium: { label: 'Medium Reasoning', icon: <Brain size={14} className="opacity-70" />, desc: 'Standard coding tasks.' },
  reasoning_low: { label: 'Low Reasoning', icon: <Brain size={14} className="opacity-50" />, desc: 'Simple queries & formatting.' },
  summarizer: { label: 'Summarizer', icon: <FileText size={14} />, desc: 'Context compression.' },
  code_completion: { label: 'Code Completion', icon: <Code size={14} />, desc: 'Inline ghost text.' },
};

const ContextBar: React.FC<{ model: ModelCapabilities }> = ({ model }) => {
  // Log scale visualization for context window
  // 128k = ~50%, 1M = ~80%, 2M = 100%
  const width = Math.min(100, Math.max(10, Math.log10(model.contextWindow) * 15));
  
  return (
    <div className="flex flex-col gap-1 w-24">
      <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
        <div 
          className={`h-full rounded-full ${model.contextWindow > 200000 ? 'bg-blue-500' : 'bg-emerald-500'}`} 
          style={{ width: `${width}%` }} 
        />
      </div>
      <span className="text-[9px] text-zinc-500 font-mono">
        {(model.contextWindow / 1000).toFixed(0)}k ctx
      </span>
    </div>
  );
};

export const ModelRoutingSettings: React.FC<ModelRoutingSettingsProps> = ({ routing, modelRegistry, onChange }) => {
  const models = Object.values(modelRegistry);

  const handleChange = (role: string, modelId: string) => {
    onChange({ ...routing, [role]: modelId });
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="bg-zinc-900/20 rounded-xl border border-zinc-800/40 overflow-hidden">
        <div className="p-4 border-b border-zinc-800/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu size={14} className="text-violet-500" />
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">
              Model Routing Table
            </span>
          </div>
          <span className="text-[10px] text-zinc-600">
            Map task types to specific models
          </span>
        </div>

        <div className="divide-y divide-zinc-800/30">
          {Object.entries(ROLES).map(([role, meta]) => {
            const currentModelId = routing[role] || '';
            const currentModel = modelRegistry[currentModelId];
            
            // Validation
            const missingTools = meta.required?.includes('supportsToolCalling') && currentModel && !currentModel.supportsToolCalling;

            return (
              <div key={role} className="p-4 flex items-center gap-4 hover:bg-zinc-900/20 transition-colors">
                <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800/50 text-zinc-400">
                  {meta.icon}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-semibold text-zinc-200">{meta.label}</h4>
                    {missingTools && (
                      <span className="flex items-center gap-1 text-[9px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                        <AlertTriangle size={8} /> Needs Tools
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-500">{meta.desc}</p>
                </div>

                {currentModel && <ContextBar model={currentModel} />}

                <select
                  value={currentModelId}
                  onChange={(e) => handleChange(role, e.target.value)}
                  className="
                    bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-300 
                    focus:border-indigo-500/50 outline-none w-48 font-mono
                  "
                >
                  <option value="" disabled>Select Model...</option>
                  {models.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>
      
      <div className="p-3 rounded-lg bg-indigo-500/5 border border-indigo-500/10 text-[10px] text-indigo-300/70 leading-relaxed">
        <strong>Pro Tip:</strong> Use smaller, cheaper models (like <code>gpt-4o-mini</code> or <code>gemini-2.0-flash</code>) for simple reasoning and summarization tasks to save tokens and reduce latency. Save the heavy lifters for High Reasoning.
      </div>
    </div>
  );
};
