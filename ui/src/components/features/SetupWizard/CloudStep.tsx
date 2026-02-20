import { Cloud, ExternalLink, Check } from 'lucide-react';
import type { WizardConfig } from '../../../hooks/useSetupWizard';

interface CloudStepProps {
  config: WizardConfig;
  onChange: (updates: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function CloudStep({ config, onChange, onNext, onBack }: CloudStepProps) {
  const isCloudProvider = config.provider === 'cloud';

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="inline-flex p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20 mb-4">
          <Cloud size={28} className="text-indigo-400" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Oboto Cloud</h2>
        <p className="text-sm text-zinc-400 max-w-md mx-auto">
          Connect to Oboto Cloud for workspace sync, team collaboration, cloud AI agents, and metered AI access without your own API keys.
        </p>
      </div>

      {/* Cloud as AI Provider option */}
      <div className="space-y-3">
        <button
          onClick={() => onChange({ provider: 'cloud' })}
          className={`w-full text-left p-4 rounded-xl border transition-all ${
            isCloudProvider
              ? 'bg-indigo-500/10 border-indigo-500/30 ring-1 ring-indigo-500/20'
              : 'bg-zinc-900/30 border-zinc-800/30 hover:border-zinc-700/50'
          }`}
        >
          <div className="flex items-start gap-3">
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 shrink-0 ${
              isCloudProvider ? 'border-indigo-500 bg-indigo-500' : 'border-zinc-600'
            }`}>
              {isCloudProvider && <Check size={12} className="text-white" />}
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-200">Use Oboto Cloud as AI Provider</p>
              <p className="text-xs text-zinc-500 mt-1">
                Route AI requests through Oboto Cloud. 50K free tokens/day — no API keys needed. 
                You can always add your own keys later for unlimited usage.
              </p>
            </div>
          </div>
        </button>

        <button
          onClick={() => {
            if (isCloudProvider) onChange({ provider: 'openai' });
          }}
          className={`w-full text-left p-4 rounded-xl border transition-all ${
            !isCloudProvider
              ? 'bg-zinc-800/20 border-zinc-700/30 ring-1 ring-zinc-600/20'
              : 'bg-zinc-900/30 border-zinc-800/30 hover:border-zinc-700/50'
          }`}
        >
          <div className="flex items-start gap-3">
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 shrink-0 ${
              !isCloudProvider ? 'border-zinc-500 bg-zinc-500' : 'border-zinc-600'
            }`}>
              {!isCloudProvider && <Check size={12} className="text-white" />}
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-200">Use my own API keys</p>
              <p className="text-xs text-zinc-500 mt-1">
                You selected <span className="text-zinc-300 font-medium">{config.provider}</span> as your provider.
                Cloud features (sync, agents, collaboration) are still available alongside your own keys.
              </p>
            </div>
          </div>
        </button>
      </div>

      {/* Info about cloud features */}
      <div className="bg-zinc-900/30 rounded-xl border border-zinc-800/30 p-4">
        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Cloud features include:</p>
        <div className="grid grid-cols-2 gap-2 text-xs text-zinc-500">
          <span>☁️ Workspace sync</span>
          <span>🤖 Cloud AI agents</span>
          <span>👥 Team collaboration</span>
          <span>💬 Conversation sync</span>
          <span>📁 Cloud file storage</span>
          <span>⚡ Metered AI proxy</span>
        </div>
        <p className="text-[10px] text-zinc-600 mt-3">
          Cloud connection is configured via <code className="bg-zinc-800 px-1 py-0.5 rounded">OBOTO_CLOUD_URL</code> and{' '}
          <code className="bg-zinc-800 px-1 py-0.5 rounded">OBOTO_CLOUD_KEY</code> in your .env file, or via Settings → Cloud after setup.
        </p>
      </div>

      <div className="text-center">
        <a
          href="https://oboto.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          Learn more about Oboto Cloud <ExternalLink size={11} />
        </a>
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <button
          onClick={onBack}
          className="px-4 py-2 text-xs text-zinc-400 hover:text-white transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={onNext}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-indigo-500/20"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
