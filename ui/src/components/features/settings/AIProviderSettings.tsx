import React, { useState, useCallback, useEffect } from 'react';
import { Server, Zap, Cpu, Globe, Box, Cloud, ShieldCheck, ShieldAlert, ExternalLink, RefreshCw, Loader2 } from 'lucide-react';
import type { SecretItem } from '../../../hooks/useSecrets';
import type { CloudUsage, CloudModel } from '../../../hooks/useCloudSync';
import { Select, SelectItem } from '../../../surface-kit/primitives/Select';
import { Switch } from '../../../surface-kit/primitives/Switch';
import { wsService } from '../../../services/wsService';

export type AIProviderType = 'openai' | 'gemini' | 'anthropic' | 'lmstudio' | 'cloud';

export interface ProviderConfig {
  enabled: boolean;
  model: string;
  endpoint?: string;
}

export interface AIProviderConfig {
  provider: AIProviderType;
  endpoint?: string;
  model: string;
  providers?: Record<AIProviderType, ProviderConfig>;
}

/** Maps provider type → secret name used for its API key */
const PROVIDER_SECRET_MAP: Record<AIProviderType, string | null> = {
  openai: 'OPENAI_API_KEY',
  gemini: 'GOOGLE_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  lmstudio: null, // no key needed
  cloud: null, // managed by Oboto Cloud login
};

/** Default models for each provider */
const DEFAULT_MODELS: Record<AIProviderType, string> = {
  openai: 'gpt-4o',
  gemini: 'gemini-2.5-flash',
  anthropic: 'claude-sonnet-4-20250514',
  lmstudio: '',
  cloud: 'auto',
};

/** Recommended models to highlight */
const RECOMMENDED_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'o1-preview', 'o3', 'o4-mini'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  anthropic: ['claude-sonnet-4', 'claude-opus-4', 'claude-3-7-sonnet'],
  lmstudio: [],
  cloud: ['gemini-3-flash', 'claude-sonnet-4', 'gpt-4o'],
};

interface ProviderMeta {
  key: AIProviderType;
  label: string;
  description: string;
  icon: React.ReactNode;
  colorClass: string;
  iconColor: string;
  needsKey: boolean;
  authNote?: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    key: 'openai',
    label: 'OpenAI',
    description: 'GPT-4o, o1, o3, o4 models',
    icon: <Zap size={16} />,
    colorClass: 'emerald',
    iconColor: 'text-emerald-400',
    needsKey: true,
  },
  {
    key: 'gemini',
    label: 'Google Gemini',
    description: 'Gemini Pro & Flash models',
    icon: <Cpu size={16} />,
    colorClass: 'blue',
    iconColor: 'text-blue-400',
    needsKey: true,
  },
  {
    key: 'anthropic',
    label: 'Anthropic',
    description: 'Claude via Vertex AI',
    icon: <Box size={16} />,
    colorClass: 'violet',
    iconColor: 'text-violet-400',
    needsKey: false,
    authNote: 'Uses Google Cloud ADC. Run: gcloud auth application-default login',
  },
  {
    key: 'lmstudio',
    label: 'LM Studio',
    description: 'Local LLMs via LM Studio',
    icon: <Server size={16} />,
    colorClass: 'amber',
    iconColor: 'text-amber-400',
    needsKey: false,
  },
  {
    key: 'cloud',
    label: 'Oboto Cloud',
    description: 'Metered AI models via Oboto Cloud subscription',
    icon: <Cloud size={16} />,
    colorClass: 'cyan',
    iconColor: 'text-cyan-400',
    needsKey: false,
    authNote: 'Login to Oboto Cloud in the Cloud tab to enable this provider.',
  },
];

const colorMap: Record<string, { bg: string; border: string; iconBg: string; dot: string }> = {
  emerald: {
    bg: 'bg-emerald-500/5',
    border: 'border-emerald-500/20',
    iconBg: 'bg-emerald-500/15 border-emerald-500/15',
    dot: 'bg-emerald-500',
  },
  blue: {
    bg: 'bg-blue-500/5',
    border: 'border-blue-500/20',
    iconBg: 'bg-blue-500/15 border-blue-500/15',
    dot: 'bg-blue-500',
  },
  violet: {
    bg: 'bg-violet-500/5',
    border: 'border-violet-500/20',
    iconBg: 'bg-violet-500/15 border-violet-500/15',
    dot: 'bg-violet-500',
  },
  amber: {
    bg: 'bg-amber-500/5',
    border: 'border-amber-500/20',
    iconBg: 'bg-amber-500/15 border-amber-500/15',
    dot: 'bg-amber-500',
  },
  cyan: {
    bg: 'bg-cyan-500/5',
    border: 'border-cyan-500/20',
    iconBg: 'bg-cyan-500/15 border-cyan-500/15',
    dot: 'bg-cyan-500',
  },
};

interface AIProviderSettingsProps {
  config: AIProviderConfig;
  onChange: (config: AIProviderConfig) => void;
  /** Current secrets list from the vault (used to show key status) */
  secrets?: SecretItem[];
  /** Secrets status map from the settings payload (preferred over secrets array) */
  secretsStatus?: Record<string, { isConfigured: boolean; source: string }>;
  /** Callback to open the Secrets Vault panel */
  onOpenSecrets?: () => void;
  modelRegistry?: Record<string, {
    provider: string;
    costTier?: string;
    reasoningCapability?: string;
    displayName?: string;
  }>;
  /** Cloud usage data (only for cloud provider) */
  cloudUsage?: CloudUsage | null;
  /** Cloud models list (used for cloud provider model selection) */
  cloudModels?: CloudModel[];
  /** Whether the user is logged into Oboto Cloud */
  cloudLoggedIn?: boolean;
}

export const AIProviderSettings: React.FC<AIProviderSettingsProps> = ({
  config,
  onChange,
  secrets,
  secretsStatus,
  onOpenSecrets,
  modelRegistry = {},
  cloudUsage,
  cloudModels = [],
  cloudLoggedIn = false,
}) => {
  const [refreshingProvider, setRefreshingProvider] = useState<string | null>(null);

  // Get the providers config, falling back to defaults
  const providers: Record<AIProviderType, ProviderConfig> = config.providers || {
    openai: { enabled: config.provider === 'openai', model: config.provider === 'openai' ? config.model : DEFAULT_MODELS.openai },
    gemini: { enabled: config.provider === 'gemini', model: config.provider === 'gemini' ? config.model : DEFAULT_MODELS.gemini },
    anthropic: { enabled: config.provider === 'anthropic', model: config.provider === 'anthropic' ? config.model : DEFAULT_MODELS.anthropic },
    lmstudio: { enabled: config.provider === 'lmstudio', model: config.provider === 'lmstudio' ? config.model : DEFAULT_MODELS.lmstudio },
    cloud: { enabled: config.provider === 'cloud', model: config.provider === 'cloud' ? config.model : DEFAULT_MODELS.cloud },
  };

  // Subscribe to WS 'settings' event to detect when models arrive
  useEffect(() => {
    const unsub = wsService.on('settings', () => {
      setRefreshingProvider(null);
    });
    return unsub;
  }, []);

  const handleRefreshModels = useCallback((providerKey: string) => {
    setRefreshingProvider(providerKey);
    wsService.refreshProviderModels(providerKey);
  }, []);

  const updateProvider = (providerKey: AIProviderType, updates: Partial<ProviderConfig>) => {
    const newProviders = { ...providers };
    newProviders[providerKey] = { ...newProviders[providerKey], ...updates };

    // If this provider is being enabled or its model is changing, and it's the primary provider,
    // also update the top-level config
    const newConfig = { ...config, providers: newProviders };

    // If the currently active provider is being updated, sync top-level fields
    if (providerKey === config.provider) {
      if (updates.model !== undefined) newConfig.model = updates.model;
      if (updates.endpoint !== undefined) newConfig.endpoint = updates.endpoint;
    }

    // If we're enabling a provider and no provider is currently set, make it the primary
    if (updates.enabled && !config.provider) {
      newConfig.provider = providerKey;
      newConfig.model = newProviders[providerKey].model;
    }

    // If we're disabling the current primary provider, switch to first enabled one
    if (updates.enabled === false && providerKey === config.provider) {
      const firstEnabled = (Object.entries(newProviders) as [AIProviderType, ProviderConfig][])
        .find(([k, v]) => v.enabled && k !== providerKey);
      if (firstEnabled) {
        newConfig.provider = firstEnabled[0];
        newConfig.model = firstEnabled[1].model;
      } else {
        newConfig.provider = '' as AIProviderType;
        newConfig.model = '';
      }
    }

    onChange(newConfig);
  };

  const setAsPrimary = (providerKey: AIProviderType) => {
    if (!providers[providerKey]?.enabled) return;
    onChange({
      ...config,
      provider: providerKey,
      model: providers[providerKey].model,
      endpoint: providers[providerKey].endpoint,
    });
  };

  /** Check if a provider's API key is configured */
  const isKeyConfigured = (providerKey: AIProviderType): { configured: boolean; source: string } => {
    const secretName = PROVIDER_SECRET_MAP[providerKey];
    if (!secretName) return { configured: true, source: 'n/a' }; // No key needed

    // Prefer secretsStatus from settings (always up-to-date)
    if (secretsStatus && secretsStatus[secretName]) {
      return {
        configured: secretsStatus[secretName].isConfigured,
        source: secretsStatus[secretName].source,
      };
    }

    // Fallback to secrets array
    if (secrets) {
      const entry = secrets.find(s => s.name === secretName);
      if (entry) return { configured: entry.isConfigured, source: entry.source };
    }

    return { configured: false, source: 'none' };
  };

  /** Get available models for a specific provider */
  const getModelsForProvider = (providerKey: string) => {
    // For cloud provider, merge cloudModels with any models from the registry
    if (providerKey === 'cloud' && cloudModels.length > 0) {
      const cloudEntries: [string, { provider: string; displayName: string }][] = cloudModels.map(m => [
        m.id,
        { provider: 'cloud', displayName: m.name },
      ]);
      return cloudEntries.sort((a, b) => {
        const aRec = isRecommended('cloud', a[0]);
        const bRec = isRecommended('cloud', b[0]);
        if (aRec && !bRec) return -1;
        if (!aRec && bRec) return 1;
        return a[0].localeCompare(b[0]);
      });
    }

    return Object.entries(modelRegistry)
      .filter(([, caps]) => caps.provider === providerKey)
      .sort((a, b) => {
        const aRec = isRecommended(providerKey, a[0]);
        const bRec = isRecommended(providerKey, b[0]);
        if (aRec && !bRec) return -1;
        if (!aRec && bRec) return 1;
        return a[0].localeCompare(b[0]);
      });
  };

  const isRecommended = (providerKey: string, modelId: string) => {
    const list = RECOMMENDED_MODELS[providerKey] || [];
    return list.some(r => modelId.includes(r));
  };

  return (
    <div className="space-y-3 animate-fade-in">
      {PROVIDERS.map(meta => {
        const pConfig = providers[meta.key];
        const isPrimary = config.provider === meta.key;
        const keyStatus = isKeyConfigured(meta.key);
        const models = getModelsForProvider(meta.key);
        const isRefreshing = refreshingProvider === meta.key;
        const colors = colorMap[meta.colorClass];
        const canConfigure = meta.needsKey ? keyStatus.configured : true;

        return (
          <div
            key={meta.key}
            className={`rounded-xl border overflow-hidden transition-all duration-300 ${
              pConfig.enabled
                ? `${colors.bg} ${colors.border}`
                : 'bg-zinc-950/20 border-zinc-800/30 opacity-70'
            }`}
          >
            {/* Provider Header */}
            <div className="flex items-center gap-3 p-4">
              <div className={`p-2 rounded-lg border transition-all ${
                pConfig.enabled ? `${colors.iconBg} ${meta.iconColor}` : 'bg-zinc-900/60 text-zinc-600 border-zinc-800/30'
              }`}>
                {meta.icon}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className={`text-sm font-semibold ${pConfig.enabled ? 'text-zinc-100' : 'text-zinc-500'}`}>
                    {meta.label}
                  </h3>
                  {isPrimary && pConfig.enabled && (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/20">
                      Primary
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-zinc-500 mt-0.5">{meta.description}</p>
              </div>

              {/* Primary button */}
              {pConfig.enabled && !isPrimary && (
                <button
                  onClick={() => setAsPrimary(meta.key)}
                  className="text-[10px] font-medium text-zinc-500 hover:text-indigo-400 px-2 py-1 rounded-md hover:bg-indigo-500/10 transition-all"
                  title="Set as primary provider"
                >
                  Set Primary
                </button>
              )}

              {/* Enable toggle */}
              <Switch
                checked={pConfig.enabled}
                onCheckedChange={(checked) => updateProvider(meta.key, { enabled: checked })}
              />
            </div>

            {/* Provider Details (shown when enabled) */}
            {pConfig.enabled && (
              <div className="px-4 pb-4 space-y-3 border-t border-zinc-800/20 pt-3 animate-fade-in">
                {/* API Key Status */}
                {meta.needsKey && (
                  <div className="flex items-center justify-between p-2.5 rounded-lg border border-zinc-800/40 bg-zinc-950/30">
                    <div className="flex items-center gap-2">
                      {keyStatus.configured ? (
                        <>
                          <ShieldCheck size={13} className="text-emerald-400" />
                          <span className="text-[11px] text-emerald-400 font-medium">API Key Configured</span>
                          <span className="text-[9px] text-zinc-600 bg-zinc-900/60 px-1.5 py-0.5 rounded border border-zinc-800/30">
                            {keyStatus.source === 'vault' ? 'Secrets Vault' : keyStatus.source === 'env' ? '.env file' : 'Unknown'}
                          </span>
                        </>
                      ) : (
                        <>
                          <ShieldAlert size={13} className="text-amber-400 animate-pulse" />
                          <span className="text-[11px] text-amber-400 font-medium">API Key Required</span>
                          <span className="text-[9px] text-zinc-600">{PROVIDER_SECRET_MAP[meta.key]}</span>
                        </>
                      )}
                    </div>
                    <button
                      onClick={onOpenSecrets}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 transition-all active:scale-95"
                    >
                      {keyStatus.configured ? 'Manage' : 'Set Key'} <ExternalLink size={9} />
                    </button>
                  </div>
                )}

                {/* Auth note for providers that don't need API keys (non-cloud) */}
                {meta.authNote && meta.key !== 'cloud' && (
                  <div className="p-2.5 rounded-lg bg-violet-500/8 border border-violet-500/15">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={13} className="text-violet-400" />
                      <span className="text-[11px] text-violet-300 font-medium">Google Cloud Auth</span>
                    </div>
                    <p className="text-[10px] text-violet-200/60 mt-1 leading-relaxed font-mono">{meta.authNote}</p>
                  </div>
                )}

                {/* Cloud Provider: Login status + Usage Meter */}
                {meta.key === 'cloud' && (
                  <div className="space-y-3">
                    {/* Cloud login status */}
                    <div className="flex items-center justify-between p-2.5 rounded-lg border border-zinc-800/40 bg-zinc-950/30">
                      <div className="flex items-center gap-2">
                        {cloudLoggedIn ? (
                          <>
                            <ShieldCheck size={13} className="text-cyan-400" />
                            <span className="text-[11px] text-cyan-400 font-medium">Logged into Oboto Cloud</span>
                          </>
                        ) : (
                          <>
                            <ShieldAlert size={13} className="text-amber-400 animate-pulse" />
                            <span className="text-[11px] text-amber-400 font-medium">Not logged in</span>
                            <span className="text-[9px] text-zinc-600">Login via Cloud tab</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Usage meter */}
                    {cloudLoggedIn && cloudUsage && (
                      <div className={`p-3 rounded-lg ${cloudUsage.is_unlimited ? 'bg-emerald-500/5 border border-emerald-500/15' : 'bg-cyan-500/5 border border-cyan-500/15'}`}>
                        {(() => {
                          const isUnlimited = cloudUsage.is_unlimited === true;
                          const usageRatio = (!isUnlimited && cloudUsage.daily_limit > 0)
                            ? cloudUsage.tokens_used / cloudUsage.daily_limit
                            : 0;
                          return (<>
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-[11px] font-medium ${isUnlimited ? 'text-emerald-300' : 'text-cyan-300'}`}>
                            {isUnlimited ? 'Usage (Unlimited)' : 'Daily Usage'}
                          </span>
                          <span className="text-[10px] text-zinc-400 font-mono">
                            {isUnlimited
                              ? `${(cloudUsage.tokens_used / 1000).toFixed(1)}K tokens used`
                              : `${(cloudUsage.tokens_used / 1000).toFixed(1)}K / ${(cloudUsage.daily_limit / 1000).toFixed(0)}K tokens`}
                          </span>
                        </div>
                        {!isUnlimited && (
                        <div className="w-full h-2 bg-zinc-900/60 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              cloudUsage.remaining <= 0
                                ? 'bg-red-500'
                                : usageRatio > 0.8
                                  ? 'bg-amber-500'
                                  : 'bg-cyan-500'
                            }`}
                            style={{ width: `${Math.min(100, usageRatio * 100)}%` }}
                          />
                        </div>
                        )}
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-[9px] text-zinc-600 capitalize">{cloudUsage.tier} tier</span>
                          {isUnlimited ? (
                            <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider">∞ Admin — No Limit</span>
                          ) : (
                          <span className={`text-[9px] font-medium ${
                            cloudUsage.remaining <= 0 ? 'text-red-400' : 'text-zinc-500'
                          }`}>
                            {cloudUsage.remaining <= 0
                              ? 'Limit reached'
                              : `${(cloudUsage.remaining / 1000).toFixed(1)}K remaining`}
                          </span>
                          )}
                        </div>
                          </>);
                        })()}
                      </div>
                    )}
                  </div>
                )}

                {/* LM Studio Endpoint */}
                {meta.key === 'lmstudio' && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5">
                      <Globe size={10} /> Endpoint URL
                    </label>
                    <input
                      type="text"
                      value={pConfig.endpoint || ''}
                      onChange={(e) => updateProvider('lmstudio', { endpoint: e.target.value })}
                      className="w-full bg-zinc-950/40 border border-zinc-800/50 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500/40 focus:shadow-[0_0_0_1px_rgba(99,102,241,0.15)] outline-none transition-all duration-200 font-mono"
                      placeholder="http://localhost:1234/v1/chat/completions"
                    />
                  </div>
                )}

                {/* Model Selection */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5">
                      <Box size={10} /> Default Model
                    </label>
                    <button
                      onClick={() => handleRefreshModels(meta.key)}
                      disabled={isRefreshing || !canConfigure}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
                      title="Refresh model list from provider"
                    >
                      {isRefreshing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                      {isRefreshing ? 'Fetching...' : 'Refresh'}
                    </button>
                  </div>

                  {isRefreshing ? (
                    <div className="flex items-center gap-2 py-2.5 px-3 bg-zinc-950/40 border border-zinc-800/50 rounded-lg">
                      <Loader2 size={12} className="animate-spin text-indigo-400" />
                      <span className="text-[11px] text-zinc-400">Fetching models from {meta.label}...</span>
                    </div>
                  ) : models.length > 0 ? (
                    <Select
                      value={pConfig.model}
                      onValueChange={(val) => updateProvider(meta.key, { model: val })}
                      placeholder="Select a model..."
                    >
                      {models.map(([id, caps]) => {
                        const rec = isRecommended(meta.key, id);
                        return (
                          <SelectItem key={id} value={id}>
                            <span className={rec ? "font-bold text-indigo-300" : "text-zinc-200"}>
                              {caps.displayName || id}
                              {rec && <span className="ml-2 text-[9px] bg-indigo-500/20 text-indigo-300 px-1 rounded">★</span>}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </Select>
                  ) : (
                    <input
                      type="text"
                      value={pConfig.model}
                      onChange={(e) => updateProvider(meta.key, { model: e.target.value })}
                      className="w-full bg-zinc-950/40 border border-zinc-800/50 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:border-indigo-500/40 focus:shadow-[0_0_0_1px_rgba(99,102,241,0.15)] outline-none transition-all duration-200 font-mono"
                      placeholder={DEFAULT_MODELS[meta.key] || 'model-name'}
                    />
                  )}

                  {!isRefreshing && models.length === 0 && canConfigure && (
                    <p className="text-[10px] text-zinc-600">
                      {meta.key === 'lmstudio'
                        ? "Ensure LM Studio is running with 'Start Server' enabled, then click Refresh."
                        : "Click Refresh to fetch available models."}
                    </p>
                  )}
                  {!isRefreshing && !canConfigure && (
                    <p className="text-[10px] text-amber-500/70">
                      Configure the API key first, then models will be fetched automatically.
                    </p>
                  )}
                  {!isRefreshing && models.length > 0 && (
                    <p className="text-[10px] text-zinc-600">
                      {models.length} model{models.length !== 1 ? 's' : ''} available
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
