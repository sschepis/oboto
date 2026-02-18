import React, { useState } from 'react';
import { ShieldAlert, CheckCircle2, XCircle } from 'lucide-react';

interface ApprovalBlockProps {
  action: string;
  description: string;
  onApprove?: () => void;
  onDeny?: () => void;
}

const ApprovalBlock: React.FC<ApprovalBlockProps> = ({ action, description, onApprove, onDeny }) => {
  const [status, setStatus] = useState<'pending' | 'approved' | 'denied'>('pending');

  const handleApprove = () => {
    setStatus('approved');
    onApprove?.();
  };

  const handleDeny = () => {
    setStatus('denied');
    onDeny?.();
  };

  return (
    <div className="w-full max-w-md bg-[#0a0a0a] border border-amber-500/15 rounded-2xl p-6 space-y-5 shadow-2xl shadow-amber-500/5 my-4 relative overflow-hidden animate-fade-in-up">
      {/* Top accent line */}
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
      
      {/* Ambient glow */}
      <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-40 h-20 bg-amber-500/5 blur-3xl rounded-full pointer-events-none" />
      
      <div className="flex items-center gap-3 relative">
        <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/15 animate-glow-pulse">
          <ShieldAlert size={18} />
        </div>
        <div>
          <span className="text-[11px] font-black text-zinc-100 uppercase tracking-[0.15em]">Authorization Required</span>
          <p className="text-[10px] text-zinc-500 font-mono">Level 4: System Modification</p>
        </div>
      </div>
      
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-zinc-200">
          Execute: <span className="text-amber-400 font-mono">{action}</span>
        </p>
        <p className="text-xs text-zinc-500 leading-relaxed">{description}</p>
      </div>
      
      {status === 'pending' ? (
        <div className="flex gap-2.5 pt-1">
          <button 
            onClick={handleDeny}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-zinc-900/60 border border-zinc-800/40 text-zinc-400 text-[10px] font-black uppercase tracking-widest hover:bg-zinc-800/60 hover:text-zinc-300 hover:border-zinc-700/40 transition-all duration-200 active:scale-[0.97]"
          >
            <XCircle size={12} />
            Deny
          </button>
          <button 
            onClick={handleApprove}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white text-black text-[10px] font-black uppercase tracking-widest hover:bg-zinc-100 transition-all duration-200 shadow-lg shadow-white/5 active:scale-[0.97]"
          >
            <CheckCircle2 size={12} />
            Authorize
          </button>
        </div>
      ) : (
        <div className={`flex items-center justify-center gap-2 p-4 rounded-xl border animate-scale-in ${
          status === 'approved' 
            ? 'bg-emerald-500/5 border-emerald-500/15 text-emerald-400' 
            : 'bg-rose-500/5 border-rose-500/15 text-rose-400'
        }`}>
          {status === 'approved' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          <span className="text-[10px] font-black uppercase tracking-[0.2em]">
            Directive {status}
          </span>
        </div>
      )}
    </div>
  );
};

export default ApprovalBlock;
