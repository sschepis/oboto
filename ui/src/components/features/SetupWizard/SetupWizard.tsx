import { useState } from 'react';
import { useSetupWizard } from '../../../hooks/useSetupWizard';
import type { WizardConfig } from '../../../hooks/useSetupWizard';
import WelcomeStep from './WelcomeStep';
import ProviderStep from './ProviderStep';
import CloudStep from './CloudStep';
import ApiKeyStep from './ApiKeyStep';
import WorkspaceStep from './WorkspaceStep';
import OpenClawStep from './OpenClawStep';
import ReviewStep from './ReviewStep';

interface SetupWizardProps {
  onComplete: () => void;
  onSkip: () => void;
  initialStep?: number;
  config?: Partial<WizardConfig>;
}

export default function SetupWizard({ onComplete, onSkip, initialStep = 0, config: initialConfig }: SetupWizardProps) {
  const [step, setStep] = useState(initialStep);
  const [config, setConfig] = useState<WizardConfig>({
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: '',
    endpoint: '',
    workspace: '',
    openClawEnabled: false,
    openClawMode: 'external',
    openClawUrl: 'ws://127.0.0.1:18789',
    openClawAuthToken: '',
    openClawPath: '',
    ...initialConfig
  });

  const { completeSetup, validateApiKey } = useSetupWizard();

  const totalSteps = 7;

  const nextStep = () => setStep(prev => Math.min(prev + 1, totalSteps - 1));
  const prevStep = () => setStep(prev => Math.max(prev - 1, 0));

  const updateConfig = (updates: Partial<WizardConfig>) => {
    setConfig((prev: WizardConfig) => ({ ...prev, ...updates }));
  };

  const handleFinish = () => {
    completeSetup({ 
        provider: config.provider, 
        openclawEnabled: config.openClawEnabled 
    });
    onComplete();
  };

  const renderStep = () => {
    switch (step) {
      case 0: return <WelcomeStep onNext={nextStep} onSkip={onSkip} />;
      case 1: return <ProviderStep config={config} onChange={updateConfig} onNext={nextStep} onBack={prevStep} />;
      case 2: return <CloudStep config={config} onChange={updateConfig} onNext={nextStep} onBack={prevStep} />;
      case 3: return <ApiKeyStep config={config} onChange={updateConfig} onNext={nextStep} onBack={prevStep} validateApiKey={validateApiKey} />;
      case 4: return <WorkspaceStep config={config} onChange={updateConfig} onNext={nextStep} onBack={prevStep} />;
      case 5: return <OpenClawStep config={config} onChange={updateConfig} onNext={nextStep} onBack={prevStep} />;
      case 6: return <ReviewStep config={config} onFinish={handleFinish} onBack={prevStep} />;
      default: return null;
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-2xl bg-[#09090b] border border-zinc-800 rounded-xl shadow-2xl"
        style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* Header / Progress */}
        {step > 0 && (
            <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/30" style={{ flexShrink: 0 }}>
            <div className="flex items-center gap-2">
                <div className="flex gap-1">
                {Array.from({ length: totalSteps - 1 }).map((_, i) => (
                    <div
                    key={i}
                    className={`h-1.5 w-6 rounded-full transition-colors ${i < step ? 'bg-indigo-500' : i === step ? 'bg-indigo-500/50' : 'bg-zinc-800'}`}
                    />
                ))}
                </div>
            </div>
            <div className="text-xs text-zinc-500 font-mono uppercase tracking-wider">
                Step {step} of {totalSteps - 1}
            </div>
            </div>
        )}

        {/* Content — scrollable area */}
        <div className="p-6 md:p-8" style={{ flexGrow: 1, height: 0, overflowY: 'auto' }}>
          {renderStep()}
        </div>
      </div>
    </div>
  );
}
