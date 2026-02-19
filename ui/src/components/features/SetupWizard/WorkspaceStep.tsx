import { useState } from 'react';
import type { WizardConfig } from '../../../hooks/useSetupWizard';
import { Button } from '../../../surface-kit/primitives/Button';
import { Input } from '../../../surface-kit/primitives/Input';
import DirectoryPicker from '../DirectoryPicker';
import { Folder } from 'lucide-react';

interface WorkspaceStepProps {
  config: WizardConfig;
  onChange: (updates: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function WorkspaceStep({ config, onChange, onNext, onBack }: WorkspaceStepProps) {
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div className="flex flex-col h-full animate-fade-in-up">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white mb-2">Choose Your Workspace</h2>
        <p className="text-zinc-400 text-sm">
          This is where RoboDev will create and manage your project files.
        </p>
      </div>

      <div className="space-y-6 mb-auto">
        <div className="space-y-2">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Workspace Path</label>
          <div className="flex gap-2">
            <Input 
              value={config.workspace} 
              onChange={(e) => onChange({ workspace: e.target.value })}
              placeholder="/Users/username/Development/my-project"
              className="font-mono text-xs"
            />
            <Button variant="outline" size="icon" onClick={() => setShowPicker(true)} title="Browse...">
              <Folder size={14} />
            </Button>
          </div>
          <p className="text-xs text-zinc-500">
            We'll create a <code>.ai-man</code> directory here to store project configuration.
          </p>
        </div>
      </div>

      <div className="flex justify-between mt-8 pt-4 border-t border-zinc-800">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button onClick={onNext} disabled={!config.workspace}>Next →</Button>
      </div>

      <DirectoryPicker
        isOpen={showPicker}
        currentPath={config.workspace || '/'}
        onSelect={(path) => onChange({ workspace: path })}
        onClose={() => setShowPicker(false)}
      />
    </div>
  );
}
