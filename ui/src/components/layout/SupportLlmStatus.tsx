/**
 * SupportLlmStatus — Non-intrusive status bar indicator for the local
 * WebLLM Support LLM engine.
 *
 * Designed to sit in the StatusBar and show the current state of
 * the background download/initialization:
 *   - idle / checking → subtle spinner
 *   - downloading     → progress percentage
 *   - ready           → green dot + "Local AI Ready"
 *   - unavailable     → hidden (or grey indicator)
 *   - error           → red indicator
 *
 * @see ui/src/services/supportLlmService.ts
 * @see ui/src/hooks/useSupportLlmStatus.ts
 */

import React from 'react';
import { Cpu, Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { useSupportLlmStatus } from '../../hooks/useSupportLlmStatus';

const SupportLlmStatus: React.FC = () => {
  const status = useSupportLlmStatus();

  // Don't render anything in idle state — the user doesn't need to know yet
  if (status.state === 'idle') return null;

  // Unavailable is non-critical; hide unless user explicitly needs to know
  // Show a subtle muted indicator that disappears after first render
  if (status.state === 'unavailable') {
    return (
      <div
        className="flex items-center gap-1 px-1 py-0.5 rounded text-zinc-600 cursor-default opacity-60"
        title={`Local AI: ${status.message}`}
      >
        <Cpu size={11} className="text-zinc-600" />
        <span className="hidden sm:inline text-[10px]">No Local AI</span>
      </div>
    );
  }

  // Error state
  if (status.state === 'error') {
    return (
      <div
        className="flex items-center gap-1 px-1 py-0.5 rounded text-red-400/80 cursor-default"
        title={`Local AI Error: ${status.message}`}
      >
        <XCircle size={11} />
        <span className="hidden sm:inline text-[10px]">AI Error</span>
      </div>
    );
  }

  // Checking hardware
  if (status.state === 'checking') {
    return (
      <div
        className="flex items-center gap-1 px-1 py-0.5 rounded text-zinc-500 cursor-default animate-pulse"
        title={status.message}
      >
        <Loader2 size={11} className="animate-spin" />
        <span className="hidden sm:inline text-[10px]">Checking GPU…</span>
      </div>
    );
  }

  // Downloading / initializing
  if (status.state === 'downloading') {
    return (
      <div
        className="flex items-center gap-1 px-1 py-0.5 rounded text-amber-400/80 cursor-default"
        title={`${status.message} — ${status.model || 'Local AI'}`}
      >
        <Loader2 size={11} className="animate-spin" />
        <span className="hidden sm:inline text-[10px]">
          {status.progress > 0 && status.progress < 100
            ? `AI: ${status.progress}%`
            : 'Initializing AI…'}
        </span>
        {/* Tiny inline progress bar */}
        {status.progress > 0 && status.progress < 100 && (
          <div className="hidden sm:block w-12 h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400/70 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${status.progress}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  // Ready state
  if (status.state === 'ready') {
    return (
      <div
        className="flex items-center gap-1 px-1 py-0.5 rounded text-emerald-400/70 cursor-default"
        title={`Local AI Ready — ${status.model || 'WebLLM'}`}
      >
        <CheckCircle2 size={11} />
        <span className="hidden sm:inline text-[10px]">Local AI</span>
      </div>
    );
  }

  // Fallback — should not happen
  return (
    <div
      className="flex items-center gap-1 px-1 py-0.5 rounded text-zinc-600 cursor-default"
      title={status.message}
    >
      <AlertTriangle size={11} />
    </div>
  );
};

export default SupportLlmStatus;
