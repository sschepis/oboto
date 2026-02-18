import React from 'react';
import { Server, Zap, Cpu, Key, Globe, Box, ShieldCheck, ShieldAlert, ExternalLink } from 'lucide-react';
import type { SecretItem } from '../../../hooks/useSecrets';

export type AIProviderType = 'openai' | 'gemini' | 'anthropic' | 'local';

export interface AIProviderConfig {
  provider: AIProviderType;
  endpoint?: string;
  model: string;
}

/** Maps provider type → secret name used for its API key */
const PROVIDER_SECRET_MAP: Record<AIProviderType, string | null> = {
  openai: 'OPENAI_API_KEY',
  gemini: 'GOOGLE_API_KEY',
  anthropic: null, // Uses Google Cloud ADC
  local: null, // no key needed
};

interface AIProviderSettingsProps {
  config: AIProviderConfig;
  onChange: (config: AIProviderConfig) => void;
  /** Current secrets list from the vault (used to show key status) */
  secrets?: SecretItem[];
  /** Callback to open the Secrets Vault panel */
  onOpenSecrets?: () => void;
}

const colorStyles = {
  emerald: {
    active: 'bg-zinc-900/60 border-emerald-500/40 shadow-lg shadow-emerald-500/5',
    icon: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/15',
    dot: 'text-emerald-500'
  },
  blue: {
    active: 'bg-zinc-900/60 border-blue-500/40 shadow-lg shadow-blue-500/5',
    icon: 'bg-blue-500/15 text-blue-400 border border-blue-500/15',
    dot: 'text-blue-500'
  },
  violet: {
    active: 'bg-zinc-900/60 border-violet-500/40 shadow-lg shadow-violet-500/5',
    icon: 'bg-violet-500/15 text-violet-400 border border-violet-500/15',
    dot: 'text-violet-500'
  },
  amber: {
    active: 'bg-zinc-900/60 border-amber-500/40 shadow-lg shadow-amber-500/5',
    icon: 'bg-amber-500/15 text-amber-400 border border-amber-500/15',
    dot: 'text-amber-500'
  }
};

type ColorKey = keyof typeof colorStyles;

const ProviderCard: React.FC<{
  label: string;
  description: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  colorClass: ColorKey;
}> = ({ label, description, icon, active, onClick, colorClass }) => {
  const styles = colorStyles[colorClass];
  
  return (
    <button
      onClick={onClick}
      className={`relative group flex flex-col items-start p-4 rounded-xl border transition-all duration-300 w-full text-left active:scale-[0.98] ${
        active 
          ? styles.active
          : 'bg-zinc-950/20 border-zinc-800/40 hover:bg-zinc-900/30 hover:border-zinc-700/40'
      }`}
    >
      <div className={`p-2 rounded-lg mb-3 transition-all duration-200 ${
        active ? styles.icon : 'bg-zinc-900/60 text-zinc-500 group-hover:text-zinc-400 border border-zinc-800/30'
      }`}>
        {icon}
      </div>
      <div className="space-y-1">
        <h3 className={`font-semibold text-sm transition-colors duration-200 ${
          active ? 'text-zinc-100' : 'text-zinc-400 group-hover:text-zinc-200'
        }`}>
          {label}
        </h3>
        <p className="text-[10px] text-zinc-500 leading-tight">
          {description}
        </p>
      </div>
      {active && (
        <div className={`absolute top-3 right-3 ${styles.dot} animate-scale-in`}>
          <div className="w-2 h-2 rounded-full bg-current shadow-[0_0_6px_currentColor]" />
        </div>
      )}
    </button>
  );
};

export const AIProviderSettings: React.FC<AIProviderSettingsProps> = ({ config, onChange, secrets, onOpenSecrets }) => {
  const updateConfig = (updates: Partial<AIProviderConfig>) => {
    onChange({ ...config, ...updates });
  };

  // Determine API key status from secrets vault
  const secretName = PROVIDER_SECRET_MAP[config.provider];
  const secretEntry = secretName && secrets
    ? secrets.find(s => s.name === secretName)
    : null;
  const isKeyConfigured = secretEntry?.isConfigured ?? false;
  const keySource = secretEntry?.source ?? 'none';

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <ProviderCard
          label="OpenAI"
          description="GPT-4o / o1 models."
          icon={<Zap size={18} />}
          active={config.provider === 'openai'}
          onClick={() => updateConfig({ provider: 'openai', model: 'gpt-4o' })}
          colorClass="emerald"
        />
        <ProviderCard
          label="Gemini"
          description="Google's multimodal models."
          icon={<Cpu size={18} />}
          active={config.provider === 'gemini'}
          onClick={() => updateConfig({ provider: 'gemini', model: 'gemini-1.5-pro' })}
          colorClass="blue"
        />
        <ProviderCard
          label="Anthropic"
          description="Claude 3 via Vertex AI."
          icon={<Box size={18} />}
          active={config.provider === 'anthropic'}
          onClick={() => updateConfig({ provider: 'anthropic', model: 'claude-3-5-sonnet-v2@20241022' })}
          colorClass="violet"
        />
        <ProviderCard
          label="Local / Custom"
          description="Ollama / LMStudio."
          icon={<Server size={18} />}
          active={config.provider === 'local'}
          onClick={() => updateConfig({ provider: 'local', model: 'llama-3-8b' })}
          colorClass="amber"
        />
      </div>

      <div className="bg-zinc-900/20 rounded-xl border border-zinc-800/40 overflow-hidden animate-fade-in" key={config.provider}>
        <div className="p-4 border-b border-zinc-800/30 flex items-center gap-2">
          {config.provider === 'openai' && <Zap size={14} className="text-emerald-500" />}
          {config.provider === 'gemini' && <Cpu size={14} className="text-blue-500" />}
          {config.provider === 'anthropic' && <Box size={14} className="text-violet-500" />}
          {config.provider === 'local' && <Server size={14} className="text-amber-500" />}
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">
            {config.provider === 'local' ? 'Endpoint Configuration' : 'Provider Configuration'}
          </span>
        </div>
        
        <div className="p-4 space-y-4">
          {/* Model Selection */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-400 flex items-center gap-2">
              <Box size={11} /> Model Identifier
            </label>
            <input 
              type="text" 
              value={config.model}
              onChange={(e) => updateConfig({ model: e.target.value })}
              className="w-full bg-zinc-950/40 border border-zinc-800/50 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500/40 focus:shadow-[0_0_0_1px_rgba(99,102,241,0.15)] outline-none transition-all duration-200 font-mono"
              placeholder={config.provider === 'openai' ? 'gpt-4o' : config.provider === 'gemini' ? 'gemini-1.5-pro' : config.provider === 'anthropic' ? 'claude-3-5-sonnet-v2@20241022' : 'llama-3-8b'}
            />
          </div>

          {/* Provider Specific Fields */}
          {config.provider === 'local' ? (
            <div className="space-y-2 animate-fade-in">
              <label className="text-xs font-medium text-zinc-400 flex items-center gap-2">
                <Globe size={11} /> Endpoint URL
              </label>
              <input 
                type="text" 
                value={config.endpoint || ''}
                onChange={(e) => updateConfig({ endpoint: e.target.value })}
                className="w-full bg-zinc-950/40 border border-zinc-800/50 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500/40 focus:shadow-[0_0_0_1px_rgba(99,102,241,0.15)] outline-none transition-all duration-200 font-mono"
                placeholder="http://localhost:11434/v1"
              />
              <p className="text-[10px] text-zinc-600 leading-relaxed">
                Compatible with OpenAI-style endpoints (Ollama, LMStudio, vLLM).
              </p>
            </div>
          ) : config.provider === 'anthropic' ? (
            <div className="space-y-2 animate-fade-in">
               <div className="p-3 rounded-lg bg-violet-500/10 border border-violet-500/20">
                  <div className="flex items-center gap-2 mb-1">
                    <ShieldCheck size={14} className="text-violet-400" />
                    <span className="text-xs font-bold text-violet-300">Google Cloud Auth</span>
                  </div>
                  <p className="text-[10px] text-violet-200/70 leading-relaxed">
                    Anthropic models are accessed via Vertex AI. Authentication is handled automatically using Google Application Default Credentials (ADC).
                  </p>
                  <p className="text-[10px] text-zinc-500 mt-2 font-mono">
                    Ensure <code>gcloud auth application-default login</code> is run on the host.
                  </p>
               </div>
            </div>
          ) : (
            <div className="space-y-2 animate-fade-in">
              <label className="text-xs font-medium text-zinc-400 flex items-center gap-2">
                <Key size={11} /> API Key
              </label>
              {/* Vault status badge + link to Secrets panel */}
              <div className="flex items-center justify-between p-3 rounded-lg border border-zinc-800/50 bg-zinc-950/40">
                <div className="flex items-center gap-2.5">
                  {isKeyConfigured ? (
                    <>
                      <ShieldCheck size={14} className="text-emerald-400" />
                      <span className="text-xs text-emerald-400 font-medium">
                        Configured
                      </span>
                      <span className="text-[10px] text-zinc-600 bg-zinc-900/60 px-1.5 py-0.5 rounded border border-zinc-800/30">
                        {keySource === 'vault' ? 'Secrets Vault' : '.env file'}
                      </span>
                    </>
                  ) : (
                    <>
                      <ShieldAlert size={14} className="text-amber-400 animate-pulse" />
                      <span className="text-xs text-amber-400 font-medium">
                        Not configured
                      </span>
                      <span className="text-[10px] text-zinc-600">
                        {secretName}
                      </span>
                    </>
                  )}
                </div>
                <button
                  onClick={onOpenSecrets}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 transition-all duration-150 active:scale-95"
                >
                  {isKeyConfigured ? 'Manage' : 'Set Key'} <ExternalLink size={10} />
                </button>
              </div>
              <p className="text-[10px] text-zinc-600 leading-relaxed">
                API keys are stored securely in the encrypted Secrets Vault — never in settings.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
