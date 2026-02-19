import { useState } from 'react';
import type { WizardConfig } from '../../../hooks/useSetupWizard';
import { Button } from '../../../surface-kit/primitives/Button';
import { Input } from '../../../surface-kit/primitives/Input';

interface ApiKeyStepProps {
  config: WizardConfig;
  onChange: (updates: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack: () => void;
  validateApiKey: (provider: string, key: string, endpoint?: string) => Promise<{ valid: boolean; error?: string }>;
}

export default function ApiKeyStep({ config, onChange, onNext, onBack, validateApiKey }: ApiKeyStepProps) {
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string } | null>(null);
  const [showKey, setShowKey] = useState(false);

  const handleValidate = async () => {
    if (!config.apiKey && config.provider !== 'lmstudio') return;
    
    setValidating(true);
    setValidationResult(null);
    try {
      const result = await validateApiKey(config.provider, config.apiKey, config.endpoint);
      setValidationResult(result);
    } catch (err: any) {
      setValidationResult({ valid: false, error: err.message });
    } finally {
      setValidating(false);
    }
  };

  const getProviderLabel = () => {
    switch(config.provider) {
      case 'openai': return 'OpenAI API Key';
      case 'gemini': return 'Google Gemini API Key';
      case 'anthropic': return 'Anthropic API Key';
      case 'lmstudio': return 'Authentication (Optional)';
      default: return 'API Key';
    }
  };

  const isNextDisabled = () => {
      // For local, validation is optional if no key is provided (some local servers don't need auth)
      // But if an endpoint is provided, we should probably encourage testing?
      // Actually, let's allow proceeding if local.
      if (config.provider === 'lmstudio') return false;
      // For others, we generally want a valid key, but user might want to skip validation if network is tricky.
      // But let's enforce non-empty key at least.
      return !config.apiKey;
  };

  return (
    <div className="flex flex-col h-full animate-fade-in-up">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white mb-2">Configure Authentication</h2>
        <p className="text-zinc-400 text-sm">
          Your API key is encrypted with AES-256-GCM and stored locally in <code>.secrets.enc</code>. 
          It never leaves your machine except to talk to the AI provider.
        </p>
      </div>

      <div className="space-y-6 mb-auto">
        <div className="space-y-2">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
            {getProviderLabel()}
          </label>
          <div className="relative">
            <Input 
              type={showKey ? "text" : "password"}
              value={config.apiKey}
              onChange={(e) => {
                  onChange({ apiKey: e.target.value });
                  setValidationResult(null);
              }}
              placeholder={config.provider === 'lmstudio' ? "sk-..." : "sk-..."}
              className="pr-10 font-mono text-sm"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              {showKey ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleValidate}
            disabled={validating || (!config.apiKey && config.provider !== 'lmstudio')}
            className="w-full sm:w-auto"
          >
            {validating ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Testing Connection...
              </>
            ) : 'Test Connection ⚡'}
          </Button>

          {validationResult && (
            <div className={`mt-3 text-sm flex items-start gap-2 p-3 rounded-lg border ${validationResult.valid ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
              {validationResult.valid ? (
                <>
                  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Valid — Connection successful</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span>{validationResult.error || 'Connection failed'}</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between mt-8 pt-4 border-t border-zinc-800">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button onClick={onNext} disabled={isNextDisabled()}>Next →</Button>
      </div>
    </div>
  );
}
