import React, { useState, useEffect, useCallback } from 'react';
import { Search, Download, Trash2, Package, Globe, AlertCircle, Loader2, Plus, X } from 'lucide-react';
import type { SkillInfo, ClawHubSkill } from '../../../hooks/useSkills';

interface SkillsSettingsProps {
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
}

const SkillsSettings: React.FC<SkillsSettingsProps> = ({
  installedSkills,
  clawHubResults,
  clawHubAvailable,
  isLoading,
  isInstalling,
  installProgress,
  error,
  onFetchSkills,
  onSearchClawHub,
  onInstallFromClawHub,
  onInstallFromNpm,
  onUninstallSkill,
  onClearError,
}) => {
  const [clawHubQuery, setClawHubQuery] = useState('');
  const [npmPackageName, setNpmPackageName] = useState('');
  const [showNpmInput, setShowNpmInput] = useState(false);

  // Fetch installed skills when component mounts
  useEffect(() => {
    onFetchSkills();
  }, [onFetchSkills]);

  // Debounced ClawHub search
  useEffect(() => {
    if (!clawHubQuery.trim()) return;
    const timer = setTimeout(() => {
      onSearchClawHub(clawHubQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [clawHubQuery, onSearchClawHub]);

  const handleNpmInstall = useCallback(() => {
    const name = npmPackageName.trim();
    if (!name) return;
    onInstallFromNpm(name);
    setNpmPackageName('');
    setShowNpmInput(false);
  }, [npmPackageName, onInstallFromNpm]);

  const sourceBadge = (source: string) => {
    const colors: Record<string, string> = {
      global: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
      clawhub: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      npm: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      workspace: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    };
    return (
      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${colors[source] || colors.global}`}>
        {source}
      </span>
    );
  };

  return (
    <div className="space-y-8">
      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg animate-fade-in-up">
          <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-300 flex-1">{error}</p>
          <button onClick={onClearError} className="text-red-400 hover:text-red-300 transition-colors">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Install Progress */}
      {isInstalling && installProgress && (
        <div className="flex items-center gap-3 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg animate-fade-in-up">
          <Loader2 size={16} className="text-indigo-400 animate-spin flex-shrink-0" />
          <p className="text-xs text-indigo-300">{installProgress}</p>
        </div>
      )}

      {/* ─── Installed Skills ─────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-sm font-semibold text-zinc-200">Installed Skills</h4>
            <p className="text-[11px] text-zinc-500 mt-0.5">Global skills available to all workspaces</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowNpmInput(prev => !prev)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-900/50 hover:bg-zinc-800/50 border border-zinc-800/30 rounded-lg transition-all duration-200"
            >
              <Plus size={12} />
              Add npm Package
            </button>
          </div>
        </div>

        {/* NPM Install Input */}
        {showNpmInput && (
          <div className="mb-4 flex items-center gap-2 p-3 bg-zinc-900/30 rounded-lg border border-zinc-800/30 animate-fade-in-up">
            <Package size={14} className="text-amber-400 flex-shrink-0" />
            <input
              type="text"
              value={npmPackageName}
              onChange={(e) => setNpmPackageName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNpmInstall()}
              placeholder="e.g. @openclaw/skill-weather"
              className="flex-1 bg-transparent border-none outline-none text-xs text-zinc-200 placeholder-zinc-600"
              autoFocus
            />
            <button
              onClick={handleNpmInstall}
              disabled={!npmPackageName.trim() || isInstalling}
              className="px-3 py-1.5 text-[11px] font-bold bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 rounded-md transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Install
            </button>
            <button
              onClick={() => { setShowNpmInput(false); setNpmPackageName(''); }}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {isLoading && installedSkills.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="text-zinc-500 animate-spin" />
          </div>
        ) : installedSkills.length === 0 ? (
          <div className="text-center py-8 text-zinc-600 text-xs">
            No skills installed yet. Install from ClawHub or add an npm package.
          </div>
        ) : (
          <div className="space-y-1.5">
            {installedSkills.map(skill => (
              <div
                key={skill.name}
                className="group flex items-center gap-3 px-3 py-2.5 bg-zinc-900/20 hover:bg-zinc-900/40 rounded-lg border border-zinc-800/20 transition-all duration-200"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-zinc-200 truncate">{skill.name}</span>
                    {sourceBadge(skill.source)}
                  </div>
                  {skill.description && (
                    <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{skill.description}</p>
                  )}
                </div>
                {skill.source !== 'workspace' && (
                  <button
                    onClick={() => onUninstallSkill(skill.name)}
                    disabled={isInstalling}
                    className="opacity-0 group-hover:opacity-100 p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all duration-200 disabled:opacity-40"
                    title="Uninstall skill"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── ClawHub Browser ──────────────────────────────────────── */}
      <div className="pt-6 border-t border-zinc-800/30">
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <Globe size={14} className="text-emerald-400" />
            <h4 className="text-sm font-semibold text-zinc-200">ClawHub</h4>
          </div>
          <p className="text-[11px] text-zinc-500">Search and install skills from clawhub.com</p>
        </div>

        {!clawHubAvailable ? (
          <div className="p-4 bg-zinc-900/20 rounded-lg border border-zinc-800/30 text-center">
            <p className="text-xs text-zinc-400 mb-2">ClawHub CLI is not installed</p>
            <p className="text-[11px] text-zinc-600 mb-3">
              Install it to browse and install skills from the ClawHub registry.
            </p>
            <button
              onClick={() => onInstallFromNpm('clawdhub')}
              disabled={isInstalling}
              className="px-3 py-1.5 text-[11px] font-bold bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-md transition-all duration-200 disabled:opacity-40"
            >
              Install ClawHub CLI
            </button>
          </div>
        ) : (
          <>
            {/* Search Bar */}
            <div className="relative mb-4">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={clawHubQuery}
                onChange={(e) => setClawHubQuery(e.target.value)}
                placeholder="Search skills on ClawHub..."
                className="w-full pl-9 pr-4 py-2 bg-zinc-900/30 border border-zinc-800/30 rounded-lg text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-emerald-500/30 transition-colors"
              />
              {isLoading && clawHubQuery && (
                <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 animate-spin" />
              )}
            </div>

            {/* Search Results */}
            {clawHubResults.length > 0 && (
              <div className="space-y-1.5 max-h-64 overflow-y-auto custom-scrollbar">
                {clawHubResults.map(skill => (
                  <div
                    key={skill.slug}
                    className="flex items-center gap-3 px-3 py-2.5 bg-zinc-900/20 hover:bg-zinc-900/40 rounded-lg border border-zinc-800/20 transition-all duration-200"
                  >
                    {skill.emoji && (
                      <span className="text-base flex-shrink-0">{skill.emoji}</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-zinc-200 truncate">{skill.name}</span>
                        {skill.version && (
                          <span className="text-[9px] text-zinc-600 font-mono">v{skill.version}</span>
                        )}
                      </div>
                      {skill.description && (
                        <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{skill.description}</p>
                      )}
                    </div>
                    {skill.installed ? (
                      <span className="text-[10px] text-emerald-500 font-medium px-2 py-1">Installed</span>
                    ) : (
                      <button
                        onClick={() => onInstallFromClawHub(skill.slug)}
                        disabled={isInstalling}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-md transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Download size={11} />
                        Install
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {clawHubQuery && !isLoading && clawHubResults.length === 0 && (
              <div className="text-center py-6 text-zinc-600 text-xs">
                No skills found for &ldquo;{clawHubQuery}&rdquo;
              </div>
            )}

            {!clawHubQuery && (
              <div className="text-center py-6 text-zinc-600 text-xs">
                Type a search query to browse skills on ClawHub
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SkillsSettings;
