import React, { useState, useEffect } from 'react';
import { Save, Settings, Database, Cpu, LayoutGrid, Info, X, Puzzle, Cloud, Blocks } from 'lucide-react';
import type { OpenClawStatus } from '../../types';
import { PropertyGrid, type PropertyItem } from './settings/PropertyGrid';
import { AIProviderSettings, type AIProviderConfig, type ProviderConfig, type AIProviderType } from './settings/AIProviderSettings';
import { ModelRoutingSettings } from './settings/ModelRoutingSettings';
import { AgenticProviderSettings } from './settings/AgenticProviderSettings';
import SkillsSettings from './settings/SkillsSettings';
import CloudSettings from './settings/CloudSettings';
import PluginSettingsTab from './settings/PluginSettingsTab';
import type { SecretItem } from '../../hooks/useSecrets';
import type { SkillInfo, ClawHubSkill } from '../../hooks/useSkills';
import type { AgenticProviderInfo } from '../../hooks/useChat';
import { useCloudSync } from '../../hooks/useCloudSync';
import { usePlugins } from '../../hooks/usePlugins';

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

export interface AgentSettings {
  maxTurns: number;
  maxSubagents: number;
  ai?: AIProviderConfig;
  routing?: Record<string, string>;
  modelRegistry?: Record<string, ModelCapabilities>;
  secretsStatus?: Record<string, { isConfigured: boolean; source: string }>;
}

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AgentSettings;
  onSave: (settings: AgentSettings) => void;
  openClawStatus?: OpenClawStatus | null;
  onConfigureOpenClaw?: (config: { mode: string; url: string; authToken: string; path: string; restart?: boolean; scope?: string }) => void;
  onDeployOpenClaw?: (config: { mode: string; url: string; authToken: string; path: string }) => void;
  /** Secrets from the vault — used to display API key status */
  secrets?: SecretItem[];
  /** Callback to open the Secrets Vault panel */
  onOpenSecrets?: () => void;
  /** Callback to launch the setup wizard */
  onRunSetupWizard?: () => void;
  /** Agentic provider management props */
  agenticProviders?: AgenticProviderInfo[];
  activeAgenticProvider?: string | null;
  onSwitchAgenticProvider?: (providerId: string) => void;
  /** Skills management props */
  skills?: {
    installedSkills: SkillInfo[];
    clawHubResults: ClawHubSkill[];
    clawHubAvailable: boolean;
    isLoading: boolean;
    isInstalling: boolean;
    installProgress: string | null;
    error: string | null;
    onFetchSkills: () => void;
    onSearchClawHub: (query: string) => void;
    onInstallFromClawHub: (slug: string, version?: string) => void;
    onInstallFromNpm: (packageName: string) => void;
    onUninstallSkill: (name: string) => void;
    onClearError: () => void;
  };
}

type SettingsTab = 'general' | 'ai' | 'openclaw' | 'skills' | 'plugins' | 'cloud';
type AISubTab = 'config' | 'routing' | 'agentic';

const SettingsDialog: React.FC<SettingsDialogProps> = ({ 
  isOpen, 
  onClose, 
  settings: initialSettings, 
  onSave, 
  openClawStatus, 
  onConfigureOpenClaw, 
  onDeployOpenClaw,
  secrets,
  onOpenSecrets,
  onRunSetupWizard,
  agenticProviders,
  activeAgenticProvider,
  onSwitchAgenticProvider,
  skills: skillsProps,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [aiSubTab, setAISubTab] = useState<AISubTab>('config');
  const [settings, setSettings] = useState<AgentSettings>(initialSettings);

  // Plugin data from the usePlugins hook
  const {
    plugins: pluginList,
    loading: pluginsLoading,
    pluginSettings: pluginSettingsData,
    pluginSchemas,
    fetchPluginSettings,
    savePluginSettings: savePluginSettingsFn,
    fetchPluginSchema,
  } = usePlugins();

  // Cloud data for the AI provider cloud card
  const { loggedIn: cloudLoggedIn, usage: cloudUsage, cloudModels, getUsage: cloudGetUsage, listCloudModels } = useCloudSync();

  // Fetch cloud usage and models when the AI tab is active and user is logged in
  useEffect(() => {
    if (activeTab === 'ai' && cloudLoggedIn) {
      cloudGetUsage();
      listCloudModels();
    }
  }, [activeTab, cloudLoggedIn, cloudGetUsage, listCloudModels]);
  
  // Local state for OpenClaw that isn't part of the main AgentSettings object yet
  const [saveScope, setSaveScope] = useState('session');
  const [localOpenClawConfig, setLocalOpenClawConfig] = useState({
    mode: 'external',
    url: 'ws://127.0.0.1:18789',
    authToken: '',
    path: ''
  });

  useEffect(() => {
    setSettings(initialSettings);
  }, [initialSettings]);

  useEffect(() => {
    if (openClawStatus) {
      setLocalOpenClawConfig({
        mode: openClawStatus.mode || 'external',
        url: openClawStatus.url || 'ws://127.0.0.1:18789',
        authToken: openClawStatus.authToken || '',
        path: openClawStatus.path || ''
      });
    }
  }, [openClawStatus]);

  if (!isOpen) return null;

  const generalItems: PropertyItem[] = [
    {
      key: 'maxTurns',
      label: 'Max LLM Turns',
      description: 'Maximum number of reasoning steps per request before the agent stops.',
      type: 'number',
      value: settings.maxTurns,
      onChange: (val) => setSettings(prev => ({ ...prev, maxTurns: Number(val) }))
    },
    {
      key: 'maxSubagents',
      label: 'Max Subagents',
      description: 'Default limit for concurrent sub-agent spawning.',
      type: 'number',
      value: settings.maxSubagents,
      onChange: (val) => setSettings(prev => ({ ...prev, maxSubagents: Number(val) }))
    }
  ];

  const handleAISettingsChange = (aiConfig: AIProviderConfig) => {
    setSettings(prev => ({ ...prev, ai: aiConfig }));
  };

  const handleRoutingChange = (routing: Record<string, string>) => {
    setSettings(prev => ({ ...prev, routing }));
  };

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: 'General', icon: <LayoutGrid size={15} /> },
    { id: 'ai', label: 'AI Providers', icon: <Cpu size={15} /> },
    { id: 'openclaw', label: 'OpenClaw', icon: <Database size={15} /> },
    { id: 'skills', label: 'Skills', icon: <Puzzle size={15} /> },
    { id: 'plugins', label: 'Plugins', icon: <Blocks size={15} /> },
    { id: 'cloud', label: 'Cloud', icon: <Cloud size={15} /> },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'general':
        return (
          <div className="space-y-6 animate-fade-in-up" key="general">
            <div>
              <h3 className="text-lg font-semibold text-zinc-100 mb-1">General Settings</h3>
              <p className="text-xs text-zinc-500 mb-5">Core agent behavior configuration.</p>
              <PropertyGrid items={generalItems} />
              
              <div className="mt-6 pt-6 border-t border-zinc-800/30">
                <h4 className="text-sm font-medium text-zinc-300 mb-2">Setup Wizard</h4>
                <p className="text-xs text-zinc-500 mb-3">Re-run the initial configuration wizard to change provider, workspace, or OpenClaw settings.</p>
                <button
                  onClick={() => { onClose(); onRunSetupWizard?.(); }}
                  className="px-3 py-2 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300 rounded-lg text-xs font-medium border border-zinc-700/50 transition-colors"
                >
                  Run Setup Wizard...
                </button>
              </div>
            </div>
          </div>
        );
      
      case 'ai':
        return (
          <div className="space-y-5 animate-fade-in-up" key="ai">
            <div>
              <h3 className="text-lg font-semibold text-zinc-100 mb-1">AI Providers</h3>
              <p className="text-xs text-zinc-500 mb-4">Configure AI providers and model routing.</p>
              
              {/* Sub-tab navigation */}
              <div className="flex bg-zinc-900/40 rounded-lg p-1 border border-zinc-800/30 mb-5">
                <button
                  onClick={() => setAISubTab('config')}
                  className={`flex-1 px-4 py-2 text-xs font-semibold rounded-md transition-all duration-200 ${
                    aiSubTab === 'config'
                      ? 'bg-zinc-800 text-white shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Configuration
                </button>
                <button
                  onClick={() => setAISubTab('routing')}
                  className={`flex-1 px-4 py-2 text-xs font-semibold rounded-md transition-all duration-200 ${
                    aiSubTab === 'routing'
                      ? 'bg-zinc-800 text-white shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Model Routing
                </button>
                <button
                  onClick={() => setAISubTab('agentic')}
                  className={`flex-1 px-4 py-2 text-xs font-semibold rounded-md transition-all duration-200 ${
                    aiSubTab === 'agentic'
                      ? 'bg-zinc-800 text-white shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Agent Mode
                </button>
              </div>

              {aiSubTab === 'config' ? (
                <AIProviderSettings 
                  config={settings.ai || { provider: 'openai', model: 'gpt-4o' }} 
                  onChange={handleAISettingsChange}
                  secrets={secrets}
                  secretsStatus={settings.secretsStatus}
                  onOpenSecrets={() => { onClose(); onOpenSecrets?.(); }}
                  modelRegistry={settings.modelRegistry || {}}
                  cloudUsage={cloudUsage}
                  cloudModels={cloudModels}
                  cloudLoggedIn={cloudLoggedIn}
                />
              ) : aiSubTab === 'routing' ? (
                <ModelRoutingSettings
                  routing={settings.routing || {}}
                  modelRegistry={settings.modelRegistry || {}}
                  onChange={handleRoutingChange}
                  providers={settings.ai?.providers as Record<AIProviderType, ProviderConfig> | undefined}
                />
              ) : (
                <AgenticProviderSettings
                  providers={agenticProviders || []}
                  activeId={activeAgenticProvider || null}
                  onSwitch={(id) => onSwitchAgenticProvider?.(id)}
                />
              )}
            </div>
          </div>
        );

      case 'skills':
        return (
          <div className="space-y-6 animate-fade-in-up" key="skills">
            <div>
              <h3 className="text-lg font-semibold text-zinc-100 mb-1">Skills</h3>
              <p className="text-xs text-zinc-500 mb-5">Install and manage global skills available across all workspaces.</p>
              {skillsProps ? (
                <SkillsSettings
                  installedSkills={skillsProps.installedSkills}
                  clawHubResults={skillsProps.clawHubResults}
                  clawHubAvailable={skillsProps.clawHubAvailable}
                  isLoading={skillsProps.isLoading}
                  isInstalling={skillsProps.isInstalling}
                  installProgress={skillsProps.installProgress}
                  error={skillsProps.error}
                  onFetchSkills={skillsProps.onFetchSkills}
                  onSearchClawHub={skillsProps.onSearchClawHub}
                  onInstallFromClawHub={skillsProps.onInstallFromClawHub}
                  onInstallFromNpm={skillsProps.onInstallFromNpm}
                  onUninstallSkill={skillsProps.onUninstallSkill}
                  onClearError={skillsProps.onClearError}
                />
              ) : (
                <div className="text-center py-8 text-zinc-600 text-xs">
                  Skills management not available.
                </div>
              )}
            </div>
          </div>
        );

      case 'openclaw':
        return (
          <div className="space-y-6 animate-fade-in-up" key="openclaw">
            <div>
              <h3 className="text-lg font-semibold text-zinc-100 mb-1">OpenClaw Integration</h3>
              <p className="text-xs text-zinc-500 mb-5">Connect to the OpenClaw gateway for external tools.</p>
              
              <div className="bg-zinc-900/20 rounded-xl border border-zinc-800/30 overflow-hidden">
                <div className="p-4 border-b border-zinc-800/30 flex items-center justify-between">
                   <div className="flex items-center gap-2.5">
                     <div className={`
                       w-2 h-2 rounded-full transition-all duration-500
                       ${openClawStatus?.connected
                         ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                         : 'bg-zinc-600'}
                     `}></div>
                     <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-[0.15em]">Status</span>
                   </div>
                   {openClawStatus?.available ? (
                      <span className="text-[10px] text-zinc-500 bg-zinc-900/50 px-2 py-0.5 rounded-md border border-zinc-800/30">{openClawStatus.mode} mode</span>
                   ) : (
                      <span className="text-[10px] text-zinc-500">Not Available</span>
                   )}
                </div>

                <div className="p-4 space-y-4">
                  <PropertyGrid items={[
                    {
                      key: 'mode',
                      label: 'Integration Mode',
                      description: 'Choose between connecting to an external gateway or running an integrated process.',
                      type: 'select',
                      value: localOpenClawConfig.mode,
                      options: [
                        { label: 'External Gateway', value: 'external' },
                        { label: 'Integrated Process', value: 'integrated' }
                      ],
                      onChange: (val) => setLocalOpenClawConfig(prev => ({ ...prev, mode: val as string }))
                    }
                  ]} className="!bg-transparent !border-0" />

                  {localOpenClawConfig.mode === 'external' ? (
                    <PropertyGrid items={[
                      {
                        key: 'url',
                        label: 'Gateway URL',
                        type: 'text',
                        value: localOpenClawConfig.url,
                        onChange: (val) => setLocalOpenClawConfig(prev => ({ ...prev, url: val as string }))
                      },
                      {
                        key: 'authToken',
                        label: 'Auth Token',
                        type: 'password',
                        value: localOpenClawConfig.authToken,
                        onChange: (val) => setLocalOpenClawConfig(prev => ({ ...prev, authToken: val as string }))
                      }
                    ]} className="!bg-transparent !border-0" />
                  ) : (
                    <PropertyGrid items={[
                      {
                        key: 'path',
                        label: 'Installation Path',
                        description: 'Path to the local OpenClaw repository.',
                        type: 'text',
                        value: localOpenClawConfig.path,
                        onChange: (val) => setLocalOpenClawConfig(prev => ({ ...prev, path: val as string }))
                      }
                    ]} className="!bg-transparent !border-0" />
                  )}

                  <div className="pt-4 border-t border-zinc-800/30 flex flex-col gap-4">
                     <div className="flex items-center justify-between">
                        <label className="text-xs text-zinc-400">Save Scope</label>
                        <div className="flex bg-zinc-950 rounded-lg p-0.5 border border-zinc-800/30">
                            {['session', 'global', 'workspace'].map(scope => (
                                <button
                                    key={scope}
                                    onClick={() => setSaveScope(scope)}
                                    className={`
                                      px-3 py-1 text-[10px] font-medium rounded-md transition-all duration-200
                                      ${saveScope === scope 
                                        ? 'bg-zinc-800 text-white shadow-sm' 
                                        : 'text-zinc-500 hover:text-zinc-300'}
                                    `}
                                >
                                    {scope.charAt(0).toUpperCase() + scope.slice(1)}
                                </button>
                            ))}
                        </div>
                     </div>

                     <div className="flex justify-end gap-2">
                        {localOpenClawConfig.mode === 'integrated' && (
                            <button
                                onClick={() => onDeployOpenClaw?.(localOpenClawConfig)}
                                className="
                                  px-4 py-2 bg-emerald-600/10 text-emerald-400 hover:bg-emerald-600/20
                                  border border-emerald-600/20 rounded-lg text-xs font-bold
                                  transition-all duration-200 flex items-center gap-2
                                  hover:shadow-md hover:shadow-emerald-500/10 active:scale-95
                                "
                            >
                                <Database size={14} /> Install & Deploy
                            </button>
                        )}
                        <button
                            onClick={() => onConfigureOpenClaw?.({ ...localOpenClawConfig, restart: true, scope: saveScope })}
                            className="
                              px-4 py-2 bg-zinc-100 text-zinc-900 hover:bg-white rounded-lg
                              text-xs font-bold transition-all duration-200
                              shadow-lg shadow-zinc-100/10 active:scale-95
                              hover:-translate-y-0.5
                            "
                        >
                            Apply Configuration
                        </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 'plugins':
        return (
          <div className="space-y-6 animate-fade-in-up" key="plugins">
            <div>
              <h3 className="text-lg font-semibold text-zinc-100 mb-1">Plugins</h3>
              <p className="text-xs text-zinc-500 mb-5">Configure settings for installed plugins.</p>
              <PluginSettingsTab
                plugins={pluginList}
                pluginSettings={pluginSettingsData}
                pluginSchemas={pluginSchemas}
                fetchPluginSettings={fetchPluginSettings}
                savePluginSettings={savePluginSettingsFn}
                fetchPluginSchema={fetchPluginSchema}
                loading={pluginsLoading}
              />
            </div>
          </div>
        );

      case 'cloud':
        return (
          <div className="space-y-6 animate-fade-in-up" key="cloud">
            <div>
              <h3 className="text-lg font-semibold text-zinc-100 mb-1">Oboto Cloud</h3>
              <p className="text-xs text-zinc-500 mb-5">Connect to Oboto Cloud for sync, collaboration, and cloud AI agents.</p>
              <CloudSettings />
            </div>
          </div>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md animate-fade-in"
        onClick={onClose}
      />

      {/* Dialog — made larger */}
      <div className="relative w-full max-w-5xl h-[720px] bg-[#09090b]/95 border border-zinc-800/40 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden flex animate-scale-in"
        style={{ backdropFilter: 'blur(20px)' }}
      >
        
        {/* Sidebar */}
        <div className="w-56 bg-zinc-900/20 border-r border-zinc-800/30 flex flex-col">
          <div className="p-5 pb-4 border-b border-zinc-800/20">
            <div className="flex items-center gap-3 text-zinc-100">
              <div className="p-2 bg-indigo-500/10 rounded-lg border border-indigo-500/15 text-indigo-400">
                <Settings size={18} />
              </div>
              <h2 className="font-bold tracking-tight text-[15px]">Settings</h2>
            </div>
          </div>
          
          <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto custom-scrollbar">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium
                  transition-all duration-200 relative
                  ${activeTab === tab.id 
                    ? 'bg-zinc-800/60 text-white shadow-sm' 
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'}
                `}
              >
                {activeTab === tab.id && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-full bg-indigo-500" />
                )}
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
          
          <div className="p-3 border-t border-zinc-800/20">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900/30 border border-zinc-800/20">
                <Info size={12} className="text-zinc-600" />
                <span className="text-[10px] text-zinc-600 font-mono">v1.2.0-alpha</span>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#09090b]">
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-3 right-3 p-1.5 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/40 transition-all duration-200 active:scale-90 z-10"
            >
              <X size={16} />
            </button>

            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                {renderContent()}
            </div>
            
            <div className="p-5 border-t border-zinc-800/20 bg-zinc-900/10 flex justify-end gap-3">
                <button 
                    onClick={onClose} 
                    className="
                      px-4 py-2 rounded-lg text-xs font-bold text-zinc-400
                      hover:text-white hover:bg-zinc-800/50
                      transition-all duration-200 active:scale-95
                    "
                >
                    Cancel
                </button>
                <button 
                    onClick={() => { onSave(settings); onClose(); }} 
                    className="
                      flex items-center gap-2 px-5 py-2 rounded-lg
                      bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold
                      transition-all duration-250 shadow-lg shadow-indigo-500/20
                      hover:shadow-xl hover:shadow-indigo-500/30
                      hover:-translate-y-0.5 active:scale-95
                    "
                >
                    <Save size={14} /> Save Configuration
                </button>
            </div>
        </div>

      </div>
    </div>
  );
};

export default SettingsDialog;
