import React from 'react';
import {
  Puzzle, CheckCircle, AlertCircle, ToggleRight, ToggleLeft,
  Wrench, Lightbulb, Settings, BookOpen, Terminal, Zap
} from 'lucide-react';
import { getPluginWelcomeInfo } from '../../data/pluginWelcomeData';
import type { PluginInfo } from '../../hooks/usePlugins';

interface PluginWelcomePageProps {
  pluginName: string;
  plugin?: PluginInfo;
  onEnable?: (name: string) => void;
  onDisable?: (name: string) => void;
}

const categoryColors: Record<string, string> = {
  automation: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  ai: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  media: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  development: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  productivity: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  data: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  integration: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  utility: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  debugging: 'bg-red-500/10 text-red-400 border-red-500/20',
};

const categoryIcons: Record<string, React.ReactNode> = {
  automation: <Zap size={12} />,
  ai: <Lightbulb size={12} />,
  media: <BookOpen size={12} />,
  development: <Terminal size={12} />,
  productivity: <CheckCircle size={12} />,
  data: <BookOpen size={12} />,
  integration: <Puzzle size={12} />,
  utility: <Settings size={12} />,
  debugging: <Wrench size={12} />,
};

const PluginWelcomePage: React.FC<PluginWelcomePageProps> = ({
  pluginName,
  plugin,
  onEnable,
  onDisable,
}) => {
  const info = getPluginWelcomeInfo(pluginName);
  const isActive = plugin?.status === 'active';
  const hasError = plugin?.status === 'error';
  const catColor = categoryColors[info.category] || categoryColors.utility;

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#080808]">
      <div className="max-w-3xl mx-auto px-8 py-10 space-y-8">
        {/* Header */}
        <div className="flex items-start gap-5">
          {/* Icon */}
          <div className="shrink-0 w-16 h-16 rounded-2xl bg-zinc-900/80 border border-zinc-800/60 flex items-center justify-center text-3xl shadow-lg">
            {info.iconEmoji}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">
                {info.displayName}
              </h1>

              {/* Status badge */}
              {plugin && (
                <span className={`
                  inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border
                  ${isActive
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : hasError
                      ? 'bg-red-500/10 text-red-400 border-red-500/20'
                      : 'bg-zinc-800/50 text-zinc-500 border-zinc-700/30'
                  }
                `}>
                  {isActive ? <CheckCircle size={10} /> : hasError ? <AlertCircle size={10} /> : <ToggleLeft size={10} />}
                  {plugin.status}
                </span>
              )}

              {/* Category badge */}
              <span className={`
                inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border
                ${catColor}
              `}>
                {categoryIcons[info.category]}
                {info.category}
              </span>
            </div>

            <p className="mt-1 text-sm text-zinc-400 font-medium">{info.tagline}</p>

            {plugin && (
              <div className="flex items-center gap-3 mt-2 text-[10px] text-zinc-600">
                <span>v{plugin.version}</span>
                <span>·</span>
                <span className="capitalize">{plugin.source}</span>
              </div>
            )}
          </div>

          {/* Enable / Disable button */}
          {plugin && (onEnable || onDisable) && (
            <button
              onClick={() => {
                if (isActive) {
                  onDisable?.(pluginName);
                } else {
                  onEnable?.(pluginName);
                }
              }}
              className={`
                shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium
                transition-all duration-200 border
                ${isActive
                  ? 'bg-zinc-800/60 text-zinc-400 border-zinc-700/40 hover:bg-zinc-800 hover:text-zinc-300'
                  : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20 hover:bg-indigo-500/20'
                }
              `}
            >
              {isActive ? (
                <>
                  <ToggleRight size={16} className="text-emerald-400" />
                  Enabled
                </>
              ) : (
                <>
                  <ToggleLeft size={16} />
                  Enable
                </>
              )}
            </button>
          )}
        </div>

        {/* Error message */}
        {hasError && plugin?.error && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-red-500/5 border border-red-500/15">
            <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-red-400">Plugin Error</p>
              <p className="text-[11px] text-red-400/70 mt-0.5">{plugin.error}</p>
            </div>
          </div>
        )}

        {/* Description */}
        <div className="text-sm text-zinc-400 leading-relaxed">
          {info.description}
        </div>

        {/* Configuration notice */}
        {info.requiresConfig && info.requiresConfig.length > 0 && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-500/5 border border-amber-500/15">
            <Settings size={14} className="text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-amber-400">Configuration Required</p>
              <p className="text-[11px] text-amber-400/70 mt-0.5">
                This plugin requires the following settings to be configured:
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {info.requiresConfig.map(c => (
                  <li key={c.key} className="text-[11px] text-amber-400/60 flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-amber-400/40" />
                    {c.label}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Features */}
        {info.features.length > 0 && (
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500 mb-3 flex items-center gap-2">
              <Zap size={12} className="text-indigo-400" />
              Features
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {info.features.map((feat, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 px-4 py-3 rounded-xl bg-zinc-900/40 border border-zinc-800/30 hover:border-zinc-700/40 transition-colors"
                >
                  <span className="text-lg shrink-0 mt-0.5">{feat.icon}</span>
                  <div>
                    <p className="text-xs font-semibold text-zinc-300">{feat.title}</p>
                    <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">{feat.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tools */}
        {info.tools.length > 0 && (
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500 mb-3 flex items-center gap-2">
              <Wrench size={12} className="text-amber-400" />
              Available Tools
            </h2>
            <div className="space-y-2">
              {info.tools.map((tool, i) => (
                <div
                  key={i}
                  className="px-4 py-3 rounded-xl bg-zinc-900/40 border border-zinc-800/30 hover:border-zinc-700/40 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <code className="text-[11px] font-mono text-indigo-400 bg-indigo-500/5 px-1.5 py-0.5 rounded">
                      {tool.name}
                    </code>
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-1">{tool.description}</p>
                  {tool.example && (
                    <p className="text-[10px] text-zinc-600 mt-1 italic">
                      Example: {tool.example}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Usage Examples */}
        {info.usageExamples && info.usageExamples.length > 0 && (
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500 mb-3 flex items-center gap-2">
              <Lightbulb size={12} className="text-emerald-400" />
              Usage Examples
            </h2>
            <div className="space-y-1.5">
              {info.usageExamples.map((ex, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-zinc-900/30 border border-zinc-800/20"
                >
                  <span className="text-[10px] text-zinc-600 font-mono shrink-0 w-4 text-right">{i + 1}.</span>
                  <span className="text-[11px] text-zinc-400">{ex}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Capabilities (from plugin data) */}
        {plugin && Object.keys(plugin.capabilities).length > 0 && (
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500 mb-3 flex items-center gap-2">
              <Settings size={12} className="text-zinc-400" />
              Capabilities
            </h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(plugin.capabilities)
                .filter(([, v]) => v)
                .map(([cap]) => (
                  <span
                    key={cap}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-mono bg-zinc-900/60 text-zinc-500 border border-zinc-800/30"
                  >
                    <CheckCircle size={9} className="text-emerald-500/60" />
                    {cap}
                  </span>
                ))
              }
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="pt-4 border-t border-zinc-800/30">
          <p className="text-[10px] text-zinc-700 text-center">
            This plugin is part of the Oboto plugin ecosystem. Configure it in Settings → Plug-ins.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PluginWelcomePage;
