import React from 'react';
import { Info } from 'lucide-react';

export interface PropertyItem {
  key: string;
  label: string;
  description?: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'password';
  value: string | number | boolean;
  options?: { label: string; value: string }[];
  onChange: (value: string | number | boolean) => void;
  disabled?: boolean;
}

interface PropertyGridProps {
  items: PropertyItem[];
  className?: string;
}

export const PropertyGrid: React.FC<PropertyGridProps> = ({ items, className = '' }) => {
  return (
    <div className={`flex flex-col w-full text-sm bg-zinc-900/20 rounded-xl border border-zinc-800/40 overflow-hidden ${className}`}>
      {items.map((item, index) => (
        <div 
          key={item.key} 
          className={`flex items-center justify-between py-3 px-4 hover:bg-zinc-800/20 transition-all duration-150 group ${
            index !== items.length - 1 ? 'border-b border-zinc-800/30' : ''
          }`}
        >
          <div className="flex-1 pr-6 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`font-medium text-[13px] transition-colors duration-150 ${
                item.disabled ? 'text-zinc-500' : 'text-zinc-300 group-hover:text-zinc-200'
              }`}>
                {item.label}
              </span>
              {item.description && (
                <div className="group/tip relative shrink-0">
                  <Info size={12} className="text-zinc-600 hover:text-indigo-400 cursor-help transition-colors duration-150" />
                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-56 bg-[#0e0e0e] border border-zinc-800/60 p-2.5 rounded-lg shadow-xl shadow-black/40 text-[11px] text-zinc-400 leading-relaxed hidden group-hover/tip:block z-50 pointer-events-none animate-fade-in">
                    {item.description}
                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-[#0e0e0e] border-r border-b border-zinc-800/60 rotate-45 -mt-1" />
                  </div>
                </div>
              )}
            </div>
            <div className="text-[10px] text-zinc-600 font-mono truncate">{item.key}</div>
          </div>
          
          <div className="w-[200px] shrink-0">
            {item.type === 'text' || item.type === 'password' ? (
              <input
                type={item.type}
                value={String(item.value)}
                onChange={(e) => item.onChange(e.target.value)}
                disabled={item.disabled}
                className="w-full bg-zinc-950/40 border border-zinc-800/50 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:border-indigo-500/40 focus:shadow-[0_0_0_1px_rgba(99,102,241,0.15)] focus:bg-zinc-950/60 outline-none transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed placeholder:text-zinc-700"
              />
            ) : item.type === 'number' ? (
              <input
                type="number"
                value={Number(item.value)}
                onChange={(e) => item.onChange(Number(e.target.value))}
                disabled={item.disabled}
                className="w-full bg-zinc-950/40 border border-zinc-800/50 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 tabular-nums focus:border-indigo-500/40 focus:shadow-[0_0_0_1px_rgba(99,102,241,0.15)] focus:bg-zinc-950/60 outline-none transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              />
            ) : item.type === 'boolean' ? (
              <div className="flex justify-end">
                <button
                  onClick={() => !item.disabled && item.onChange(!item.value)}
                  disabled={item.disabled}
                  className={`w-10 h-[22px] rounded-full relative transition-all duration-200 ${
                    item.value 
                      ? 'bg-indigo-600 shadow-sm shadow-indigo-500/30' 
                      : 'bg-zinc-700/60'
                  } ${item.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:brightness-110'}`}
                >
                  <div className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200 ease-out ${
                    item.value ? 'left-[22px]' : 'left-[3px]'
                  }`} />
                </button>
              </div>
            ) : item.type === 'select' ? (
              <div className="relative">
                <select
                  value={String(item.value)}
                  onChange={(e) => item.onChange(e.target.value)}
                  disabled={item.disabled}
                  className="w-full appearance-none bg-zinc-950/40 border border-zinc-800/50 rounded-lg px-2.5 py-1.5 pr-8 text-xs text-zinc-200 focus:border-indigo-500/40 focus:shadow-[0_0_0_1px_rgba(99,102,241,0.15)] focus:bg-zinc-950/60 outline-none transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {item.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500">
                  <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
};
