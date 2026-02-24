import React from 'react';
import { Cpu, Check } from 'lucide-react';
import type { AgenticProviderInfo } from '../../../hooks/useChat';

interface AgenticProviderSettingsProps {
  providers: AgenticProviderInfo[];
  activeId: string | null;
  onSwitch: (providerId: string) => void;
}

export const AgenticProviderSettings: React.FC<AgenticProviderSettingsProps> = ({
  providers,
  activeId,
  onSwitch,
}) => {
  if (providers.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-600 text-xs">
        No agentic providers available. Check server configuration.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        Select how the agent processes your messages. Each provider uses a different reasoning strategy.
      </p>

      <div className="grid gap-3">
        {providers.map((provider) => {
          const isActive = provider.id === activeId;
          return (
            <button
              key={provider.id}
              onClick={() => !isActive && onSwitch(provider.id)}
              className={`
                relative w-full text-left p-4 rounded-xl border transition-all duration-200
                ${isActive
                  ? 'bg-indigo-500/10 border-indigo-500/30 shadow-sm shadow-indigo-500/10'
                  : 'bg-zinc-900/30 border-zinc-800/30 hover:bg-zinc-800/40 hover:border-zinc-700/50 cursor-pointer'}
              `}
            >
              <div className="flex items-start gap-3">
                <div className={`
                  p-2 rounded-lg border transition-all duration-200
                  ${isActive
                    ? 'bg-indigo-500/15 border-indigo-500/25 text-indigo-400'
                    : 'bg-zinc-800/50 border-zinc-700/30 text-zinc-500'}
                `}>
                  <Cpu size={16} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${isActive ? 'text-indigo-300' : 'text-zinc-200'}`}>
                      {provider.name}
                    </span>
                    {isActive && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-500/20 border border-indigo-500/30 text-[9px] font-bold text-indigo-400 uppercase tracking-wider">
                        <Check size={10} /> Active
                      </span>
                    )}
                  </div>
                  {provider.description && (
                    <p className="mt-1 text-[11px] text-zinc-500 leading-relaxed">
                      {provider.description}
                    </p>
                  )}
                  <p className="mt-1.5 text-[10px] text-zinc-600 font-mono">
                    ID: {provider.id}
                  </p>
                </div>

                {/* Active indicator dot */}
                <div className={`
                  w-2.5 h-2.5 rounded-full mt-1 transition-all duration-500
                  ${isActive
                    ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]'
                    : 'bg-zinc-700'}
                `} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default AgenticProviderSettings;
