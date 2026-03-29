import React, { useState } from 'react';
import { Key, Eye, EyeOff, X } from 'lucide-react';
import { wsService } from '../../services/wsService';

interface SecretVaultBlockProps {
  secretLabel: string;
  requestId?: string;
  secretName?: string;
  description?: string;
  onProvide?: (value: string) => void;
}

const SecretVaultBlock: React.FC<SecretVaultBlockProps> = ({
  secretLabel,
  requestId,
  secretName,
  description,
  onProvide,
}) => {
  const [value, setValue] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);

  const handleSubmit = () => {
    if (!value.trim()) return;

    // If we have a requestId and secretName, send via WebSocket (AI tool flow)
    if (requestId && secretName) {
      wsService.submitSecret(requestId, secretName, value);
    }

    // Legacy callback for non-tool usage
    onProvide?.(value);

    // Clear the value from component state immediately for security
    setValue('');
    setIsSubmitted(true);
  };

  const handleCancel = () => {
    if (requestId && secretName) {
      wsService.cancelSecret(requestId, secretName);
    }
    setValue('');
    setIsCancelled(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  return (
    <div className="w-full max-w-md bg-[#0d0d0d] border border-indigo-500/20 rounded-[2rem] p-8 space-y-6 shadow-2xl my-4 relative overflow-hidden">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
          <Key size={20} />
        </div>
        <div>
          <span className="text-xs font-black text-zinc-100 uppercase tracking-widest">Secret Required</span>
          {secretName && (
            <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{secretName}</p>
          )}
        </div>
      </div>

      {description && !isSubmitted && !isCancelled && (
        <p className="text-xs text-zinc-400 leading-relaxed">{description}</p>
      )}

      {!isSubmitted && !isCancelled ? (
        <div className="space-y-4">
          <div className="relative">
            <input
              type={isVisible ? 'text' : 'password'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Enter ${secretLabel}...`}
              className="w-full bg-[#161616] border border-zinc-800 rounded-xl px-5 py-3 text-sm text-indigo-300 focus:border-indigo-500 transition-all font-mono"
              autoFocus
            />
            <button
              onClick={() => setIsVisible(!isVisible)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
            >
              {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleSubmit}
              disabled={!value.trim()}
              className="flex-1 py-3 rounded-xl bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-500"
            >
              Commit to Vault
            </button>
            <button
              onClick={handleCancel}
              className="px-4 py-3 rounded-xl border border-zinc-700 text-zinc-400 text-[10px] font-black uppercase tracking-widest transition-all hover:border-zinc-500 hover:text-zinc-300"
              title="Skip this secret"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ) : isSubmitted ? (
        <div className="flex items-center justify-center p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-emerald-500 animate-in zoom-in-95">
          <span className="text-[10px] font-black uppercase tracking-[0.2em]">Stored in Vault</span>
        </div>
      ) : (
        <div className="flex items-center justify-center p-4 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-zinc-500 animate-in zoom-in-95">
          <span className="text-[10px] font-black uppercase tracking-[0.2em]">Skipped</span>
        </div>
      )}
    </div>
  );
};

export default SecretVaultBlock;
