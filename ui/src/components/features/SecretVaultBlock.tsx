import React, { useState } from 'react';
import { Key, Eye, EyeOff } from 'lucide-react';

interface SecretVaultBlockProps {
  secretLabel: string;
  onProvide?: (value: string) => void;
}

const SecretVaultBlock: React.FC<SecretVaultBlockProps> = ({ secretLabel, onProvide }) => {
  const [value, setValue] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = () => { 
    if (value.trim()) { 
      onProvide?.(value); 
      setIsSubmitted(true); 
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
        </div>
      </div>
      {!isSubmitted ? (
        <div className="space-y-4">
          <div className="relative">
            <input 
              type={isVisible ? "text" : "password"} 
              value={value} 
              onChange={(e) => setValue(e.target.value)} 
              placeholder={`Enter ${secretLabel}...`} 
              className="w-full bg-[#161616] border border-zinc-800 rounded-xl px-5 py-3 text-sm text-indigo-300 focus:border-indigo-500 transition-all font-mono" 
            />
            <button onClick={() => setIsVisible(!isVisible)} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400">
              {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <button onClick={handleSubmit} className="w-full py-3 rounded-xl bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest transition-all">
            Commit to Vault
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-center p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-emerald-500 animate-in zoom-in-95">
          <span className="text-[10px] font-black uppercase tracking-[0.2em]">Stored in Session Vault</span>
        </div>
      )}
    </div>
  );
};

export default SecretVaultBlock;
