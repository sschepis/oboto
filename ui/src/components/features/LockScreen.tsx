import React, { useState } from 'react';
import { Lock } from 'lucide-react';

interface LockScreenProps {
  onUnlock: () => void;
}

const LockScreen: React.FC<LockScreenProps> = ({ onUnlock }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.toLowerCase() === 'nexus') {
      onUnlock();
    } else {
      setError(true);
      setTimeout(() => setError(false), 1000);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-[40px] animate-in fade-in duration-700 font-sans">
      <div className={`max-w-md w-full p-12 rounded-[3.5rem] bg-[#0d0d0d] border border-white/5 shadow-[0_0_100px_rgba(0,0,0,1)] transition-all duration-300 ${error ? 'border-rose-500/50 shake' : 'border-indigo-500/20'}`}>
        <div className="text-center space-y-8">
          <div className="relative inline-block">
             <div className="w-24 h-24 bg-indigo-600/10 rounded-[2.5rem] border border-indigo-500/20 flex items-center justify-center mx-auto mb-2 relative z-10">
               <Lock size={32} className={`${error ? 'text-rose-500' : 'text-indigo-400'} transition-colors`} />
             </div>
             <div className="absolute inset-0 bg-indigo-500/20 blur-3xl rounded-full animate-pulse"></div>
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-black uppercase tracking-[0.3em] text-white leading-none">Substrate Locked</h2>
            <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest leading-relaxed">Singularity Protocol v7.8<br/>Verification Required</p>
          </div>
          <form onSubmit={handleUnlock} className="space-y-4">
            <input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter Access Key..." className="w-full bg-[#161616] border border-zinc-800 rounded-2xl px-6 py-4 text-center text-sm font-mono tracking-[0.5em] text-indigo-400 focus:border-indigo-500 focus:ring-0 transition-all placeholder:tracking-normal placeholder:text-zinc-800" />
            <button type="submit" className="w-full py-4 rounded-2xl bg-white text-black font-black uppercase tracking-[0.2em] text-[10px] transition-all hover:scale-[1.02] active:scale-95 shadow-2xl">Unlock Terminal</button>
          </form>
          <div className="pt-4"><p className="mt-6 text-[9px] text-zinc-700 italic font-medium uppercase tracking-tighter">"The communication is the proof of existence"</p></div>
        </div>
      </div>
      <style>{`@keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-8px); } 75% { transform: translateX(8px); } } .shake { animation: shake 0.2s ease-in-out 0s 2; }`}</style>
    </div>
  );
};

export default LockScreen;
