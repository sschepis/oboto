import type { WizardConfig } from '../../../hooks/useSetupWizard';
import { Button } from '../../../surface-kit/primitives/Button';
import { Card, CardHeader, CardTitle } from '../../../surface-kit/layout/Card';
import { Select, SelectItem } from '../../../surface-kit/primitives/Select';
import { Input } from '../../../surface-kit/primitives/Input';

interface ProviderStepProps {
  config: WizardConfig;
  onChange: (updates: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack: () => void;
}

const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', description: 'Industry standard models like GPT-4o' },
  { id: 'gemini', name: 'Google Gemini', description: 'Fast, large context models' },
  { id: 'anthropic', name: 'Anthropic', description: 'Claude models, great for coding' },
  { id: 'lmstudio', name: 'LMStudio', description: 'Connect to local LM Studio (v1 API)' },
];

const MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  anthropic: ['claude-3-5-sonnet-20240620', 'claude-3-haiku-20240307', 'claude-3-opus-20240229'],
  lmstudio: [],
};

export default function ProviderStep({ config, onChange, onNext, onBack }: ProviderStepProps) {
  const handleProviderSelect = (providerId: string) => {
    const defaultModel = MODELS[providerId]?.[0] || '';
    onChange({ provider: providerId, model: defaultModel });
  };

  return (
    <div className="flex flex-col h-full animate-fade-in-up">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white mb-2">Choose Your AI Provider</h2>
        <p className="text-zinc-400 text-sm">Select the AI service you would like to use.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        {PROVIDERS.map((p) => (
          <Card 
            key={p.id}
            className={`cursor-pointer transition-all hover:border-zinc-600 ${config.provider === p.id ? 'bg-indigo-500/10 border-indigo-500/50 ring-1 ring-indigo-500/50' : ''}`}
            onClick={() => handleProviderSelect(p.id)}
          >
            <CardHeader>
              <CardTitle className="flex justify-between items-center">
                {p.name}
                {config.provider === p.id && <span className="text-indigo-400">●</span>}
              </CardTitle>
              <p className="text-xs text-zinc-500 mt-1">{p.description}</p>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="space-y-4 mb-auto">
        {config.provider !== 'lmstudio' ? (
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Model</label>
            <Select
              value={config.model}
              onValueChange={(val) => onChange({ model: val })}
              placeholder="Select a model"
            >
              {MODELS[config.provider]?.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </Select>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Endpoint URL</label>
            <Input
              value={config.endpoint}
              onChange={(e) => onChange({ endpoint: e.target.value })}
              placeholder="http://localhost:1234/v1/chat/completions"
            />
            <p className="text-xs text-zinc-500">
              Use OpenAI-compatible endpoint for tool support (e.g. /v1/chat/completions).
            </p>
          </div>
        )}
      </div>

      <div className="flex justify-between mt-8 pt-4 border-t border-zinc-800">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button onClick={onNext} disabled={config.provider === 'lmstudio' && !config.endpoint}>Next →</Button>
      </div>
    </div>
  );
}
