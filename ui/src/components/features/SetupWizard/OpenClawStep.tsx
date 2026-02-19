import { useState, useEffect } from 'react';
import { useSetupWizard } from '../../../hooks/useSetupWizard';
import type { WizardConfig } from '../../../hooks/useSetupWizard';
import { Button } from '../../../surface-kit/primitives/Button';
import { Input } from '../../../surface-kit/primitives/Input';
import { Card, CardHeader, CardTitle } from '../../../surface-kit/layout/Card';
import { Switch } from '../../../surface-kit/primitives/Switch';
import { Check, AlertCircle, Folder } from 'lucide-react';
import DirectoryPicker from '../DirectoryPicker';

interface OpenClawStepProps {
  config: WizardConfig;
  onChange: (updates: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function OpenClawStep({ config, onChange, onNext, onBack }: OpenClawStepProps) {
  const { 
      checkPrereqs, prereqs, installOpenClaw, installProgress, installComplete 
  } = useSetupWizard();
  
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
      if (config.openClawEnabled && config.openClawMode === 'integrated' && !prereqs) {
          checkPrereqs();
      }
  }, [config.openClawEnabled, config.openClawMode, checkPrereqs, prereqs]);

  // If we have a default path from prereqs and no path set, set it
  useEffect(() => {
      if (prereqs?.defaultPath && !config.openClawPath) {
          onChange({ openClawPath: prereqs.defaultPath });
      }
  }, [prereqs, config.openClawPath, onChange]);

  // If install completes successfully, auto-update config url/token
  useEffect(() => {
      if (installComplete?.success && installComplete.gatewayUrl) {
          onChange({ 
              openClawUrl: installComplete.gatewayUrl,
              // Token is already saved to vault by backend, but we might want to store it in state if needed
              // The backend handles the auth token generation and saving
          });
      }
  }, [installComplete, onChange]);

  const handleInstall = () => {
      if (!config.openClawPath) return;
      installOpenClaw(config.openClawPath, 'source');
  };

  const renderInstallProgress = () => {
      if (!installProgress && !installComplete) return null;

      const steps = [
          { id: 'prereqs', label: 'Verify prerequisites' },
          { id: 'clone', label: 'Clone repository' },
          { id: 'install', label: 'Install dependencies' },
          { id: 'build', label: 'Build project' },
          { id: 'ui-build', label: 'Build UI' },
          { id: 'auth-token', label: 'Generate auth token' },
          { id: 'config', label: 'Save configuration' },
          { id: 'start', label: 'Start gateway' },
          { id: 'health-check', label: 'Verify connection' },
      ];

      // Determine current step index
      const currentStepIdx = steps.findIndex(s => s.id === installProgress?.step);
      
      return (
          <div className="mt-6 bg-zinc-950 rounded-lg border border-zinc-800 p-4 space-y-3">
              <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">Installation Progress</h4>
              
              {installComplete?.success ? (
                  <div className="flex items-center gap-2 text-emerald-400">
                      <Check size={16} />
                      <span className="text-sm font-medium">Installation Complete! Gateway is running.</span>
                  </div>
              ) : installComplete?.success === false ? (
                  <div className="space-y-2">
                      <div className="flex items-start gap-2 text-red-400">
                          <AlertCircle size={16} className="mt-0.5 shrink-0" />
                          <span className="text-sm font-medium">Installation Failed</span>
                      </div>
                      <div className="text-xs text-red-400/80 font-mono bg-red-950/30 p-2 rounded">
                          {installComplete.error}
                      </div>
                      <Button size="sm" variant="outline" onClick={handleInstall}>Retry</Button>
                  </div>
              ) : (
                  <div className="space-y-2">
                      <div className="flex justify-between text-xs text-zinc-400">
                          <span>{installProgress?.detail || 'Initializing...'}</span>
                          <span>{Math.round(((currentStepIdx + 1) / steps.length) * 100)}%</span>
                      </div>
                      <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                          <div 
                              className="h-full bg-indigo-500 transition-all duration-500"
                              style={{ width: `${((currentStepIdx + 1) / steps.length) * 100}%` }}
                          />
                      </div>
                  </div>
              )}
          </div>
      );
  };

  return (
    <div className="flex flex-col h-full animate-fade-in-up">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white mb-2">OpenClaw Integration</h2>
        <p className="text-zinc-400 text-sm">
          OpenClaw adds multi-channel messaging and sandboxed tool execution.
        </p>
      </div>

      <div className="space-y-6 mb-auto overflow-y-auto pr-2 custom-scrollbar">
        {/* Toggle */}
        <div className="flex items-center justify-between p-4 rounded-xl border border-zinc-800 bg-zinc-900/30">
            <div>
                <span className="text-sm font-medium text-zinc-200">Enable OpenClaw</span>
                <p className="text-xs text-zinc-500">Connect to external services like WhatsApp, Slack, etc.</p>
            </div>
            <Switch 
                checked={config.openClawEnabled} 
                onCheckedChange={(checked) => onChange({ openClawEnabled: checked })} 
            />
        </div>

        {config.openClawEnabled && (
            <div className="space-y-6 animate-fade-in">
                {/* Mode Selection */}
                <div className="grid grid-cols-2 gap-4">
                    <Card 
                        className={`cursor-pointer transition-all ${config.openClawMode === 'external' ? 'bg-indigo-500/10 border-indigo-500/50' : ''}`}
                        onClick={() => onChange({ openClawMode: 'external' })}
                    >
                        <CardHeader className="p-3">
                            <CardTitle className="text-sm">🌐 External Gateway</CardTitle>
                            <p className="text-[10px] text-zinc-500 mt-1">Connect to an existing gateway running elsewhere</p>
                        </CardHeader>
                    </Card>
                    <Card 
                        className={`cursor-pointer transition-all ${config.openClawMode === 'integrated' ? 'bg-indigo-500/10 border-indigo-500/50' : ''}`}
                        onClick={() => onChange({ openClawMode: 'integrated' })}
                    >
                        <CardHeader className="p-3">
                            <CardTitle className="text-sm">💻 Local Install</CardTitle>
                            <p className="text-[10px] text-zinc-500 mt-1">Auto-install and manage locally</p>
                        </CardHeader>
                    </Card>
                </div>

                {config.openClawMode === 'external' ? (
                    <div className="space-y-4 p-4 rounded-xl border border-zinc-800 bg-zinc-900/20">
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-zinc-400">Gateway URL</label>
                            <Input 
                                value={config.openClawUrl}
                                onChange={(e) => onChange({ openClawUrl: e.target.value })}
                                placeholder="ws://127.0.0.1:18789"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-zinc-400">Auth Token</label>
                            <Input 
                                type="password"
                                value={config.openClawAuthToken}
                                onChange={(e) => onChange({ openClawAuthToken: e.target.value })}
                                placeholder="••••••••••••"
                            />
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4 p-4 rounded-xl border border-zinc-800 bg-zinc-900/20">
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-zinc-400">Install Path</label>
                            <div className="flex gap-2">
                                <Input 
                                    value={config.openClawPath}
                                    onChange={(e) => onChange({ openClawPath: e.target.value })}
                                    placeholder="/Users/username/.openclaw-gateway"
                                    className="font-mono text-xs"
                                />
                                <Button variant="outline" size="icon" onClick={() => setShowPicker(true)}>
                                    <Folder size={14} />
                                </Button>
                            </div>
                        </div>

                        {/* Prerequisites Status */}
                        {prereqs && (
                            <div className="grid grid-cols-3 gap-2">
                                <div className="bg-zinc-950 p-2 rounded border border-zinc-800 flex items-center gap-2">
                                    {prereqs.prereqs.node.sufficient ? <Check size={12} className="text-emerald-500" /> : <AlertCircle size={12} className="text-red-500" />}
                                    <span className="text-[10px] text-zinc-400">Node {prereqs.prereqs.node.version}</span>
                                </div>
                                <div className="bg-zinc-950 p-2 rounded border border-zinc-800 flex items-center gap-2">
                                    {prereqs.prereqs.git.installed ? <Check size={12} className="text-emerald-500" /> : <AlertCircle size={12} className="text-red-500" />}
                                    <span className="text-[10px] text-zinc-400">Git</span>
                                </div>
                                <div className="bg-zinc-950 p-2 rounded border border-zinc-800 flex items-center gap-2">
                                    {prereqs.prereqs.pnpm.installed ? <Check size={12} className="text-emerald-500" /> : <AlertCircle size={12} className="text-yellow-500" />}
                                    <span className="text-[10px] text-zinc-400">pnpm</span>
                                </div>
                            </div>
                        )}
                        
                        {prereqs?.existingInstall.found && !installProgress && !installComplete && (
                            <div className="bg-blue-500/10 border border-blue-500/20 p-3 rounded-lg flex items-start gap-2">
                                <InfoIcon className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                                <div className="text-xs text-blue-300">
                                    Found existing installation at <code>{prereqs.existingInstall.path}</code>.
                                    Clicking install will update it.
                                </div>
                            </div>
                        )}

                        {!installProgress && !installComplete?.success && (
                            <Button 
                                onClick={handleInstall} 
                                className="w-full"
                                disabled={!config.openClawPath}
                            >
                                Install & Start Gateway ⚡
                            </Button>
                        )}

                        {renderInstallProgress()}
                    </div>
                )}
            </div>
        )}
      </div>

      <div className="flex justify-between mt-8 pt-4 border-t border-zinc-800">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button onClick={onNext} disabled={config.openClawEnabled && config.openClawMode === 'integrated' && !installComplete?.success}>Next →</Button>
      </div>

      <DirectoryPicker
        isOpen={showPicker}
        currentPath={config.openClawPath || '/'}
        onSelect={(path) => onChange({ openClawPath: path })}
        onClose={() => setShowPicker(false)}
      />
    </div>
  );
}

function InfoIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
    );
}
