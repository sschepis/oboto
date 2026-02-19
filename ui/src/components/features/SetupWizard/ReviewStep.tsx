import type { WizardConfig } from '../../../hooks/useSetupWizard';
import { Button } from '../../../surface-kit/primitives/Button';
import { Check, X } from 'lucide-react';

interface ReviewStepProps {
  config: WizardConfig;
  onFinish: () => void;
  onBack: () => void;
}

export default function ReviewStep({ config, onFinish, onBack }: ReviewStepProps) {
  const items = [
    { label: 'AI Provider', value: config.provider, status: true },
    { label: 'Model', value: config.model, status: true },
    { label: 'Authentication', value: config.apiKey ? 'Configured' : (config.provider === 'lmstudio' ? 'Skipped (LMStudio)' : 'Missing'), status: !!config.apiKey || config.provider === 'lmstudio' },
    { label: 'Workspace', value: config.workspace, status: !!config.workspace },
    { label: 'OpenClaw', value: config.openClawEnabled ? (config.openClawMode === 'external' ? 'External' : 'Local Install') : 'Disabled', status: true },
  ];

  return (
    <div className="flex flex-col h-full animate-fade-in-up">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white mb-2">Review & Finish</h2>
        <p className="text-zinc-400 text-sm">
          You're all set! Review your configuration below.
        </p>
      </div>

      <div className="space-y-6 mb-auto">
        <div className="bg-zinc-900/20 rounded-xl border border-zinc-800/30 overflow-hidden">
            {items.map((item, i) => (
                <div key={item.label} className={`flex items-center justify-between p-4 ${i !== items.length - 1 ? 'border-b border-zinc-800/30' : ''}`}>
                    <span className="text-sm text-zinc-400">{item.label}</span>
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-zinc-200 truncate max-w-[200px] text-right">
                            {item.value}
                        </span>
                        {item.status ? (
                            <Check size={16} className="text-emerald-500" />
                        ) : (
                            <X size={16} className="text-red-500" />
                        )}
                    </div>
                </div>
            ))}
        </div>

        <p className="text-xs text-zinc-500 text-center">
            You can change any of these settings later from the Settings panel.
        </p>
      </div>

      <div className="flex justify-between mt-8 pt-4 border-t border-zinc-800">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button onClick={onFinish} className="bg-emerald-600 hover:bg-emerald-500 text-white">
            Finish Setup ✨
        </Button>
      </div>
    </div>
  );
}
