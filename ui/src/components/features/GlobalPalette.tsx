import React, { useState, useEffect, useRef } from 'react';
import { Command as CommandIcon, Search } from 'lucide-react';
import type { Command } from '../../types';

interface GlobalPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (commandLabel: string) => void;
  actions: Command[];
}

const GlobalPalette: React.FC<GlobalPaletteProps> = ({ isOpen, onClose, onSelect, actions }) => {
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredActions = actions.filter(a => a.label.toLowerCase().includes(filter.toLowerCase()));

  useEffect(() => {
    // Focus input on mount
    inputRef.current?.focus();
  }, []);

  // Handle keyboard navigation within the palette
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(p => (p + 1) % filteredActions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(p => (p - 1 + filteredActions.length) % filteredActions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredActions[selectedIndex]) {
        onClose();
        onSelect(filteredActions[selectedIndex].label);
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4">
      {/* Backdrop with blur */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-lg animate-fade-in"
        onClick={onClose}
      />

      {/* Palette container */}
      <div className="relative w-full max-w-2xl bg-[#0d0d0d]/95 border border-zinc-800/50 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden animate-scale-in"
        style={{ backdropFilter: 'blur(20px) saturate(180%)' }}
      >
        {/* Search header */}
        <div className="flex items-center px-5 py-4 border-b border-zinc-800/30 bg-zinc-900/20">
          <Search size={16} className="text-zinc-500 mr-3 shrink-0" />
          <input 
            ref={inputRef} 
            type="text" 
            value={filter} 
            onChange={(e) => { setFilter(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search commands..." 
            className="flex-1 bg-transparent border-none focus:ring-0 text-zinc-100 placeholder:text-zinc-600 text-[15px] outline-none" 
          />
          <kbd className="text-[10px] font-mono text-zinc-600 bg-zinc-800/40 px-2 py-0.5 rounded border border-zinc-700/20 ml-2">esc</kbd>
        </div>

        {/* Results */}
        <div className="p-1.5 max-h-[400px] overflow-y-auto custom-scrollbar">
          {filteredActions.map((act, i) => (
            <button 
              key={act.id} 
              onClick={() => { onClose(); onSelect(act.label); }}
              className={`
                w-full flex items-center gap-3.5 px-4 py-3 rounded-xl
                transition-all duration-150
                ${i === selectedIndex
                  ? 'bg-indigo-600/8 text-white border border-indigo-500/10'
                  : 'text-zinc-400 hover:bg-zinc-800/20 border border-transparent'}
              `}
            >
              <div className={`
                p-2 rounded-lg transition-all duration-200
                ${i === selectedIndex
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                  : 'bg-zinc-800/60 text-zinc-500'}
              `}>
                {act.icon}
              </div>
              <div className="flex flex-col items-start text-left flex-1 min-w-0">
                <span className={`text-[13px] font-semibold ${i === selectedIndex ? 'text-zinc-100' : ''}`}>{act.label}</span>
                <span className="text-[11px] text-zinc-600 font-medium">{act.desc}</span>
              </div>
              {act.shortcut && (
                <kbd className={`
                  text-[10px] font-mono px-2 py-0.5 rounded border shrink-0
                  ${i === selectedIndex
                    ? 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20'
                    : 'text-zinc-600 bg-zinc-800/30 border-zinc-700/20'}
                `}>
                  {act.shortcut}
                </kbd>
              )}
            </button>
          ))}
          {filteredActions.length === 0 && (
            <div className="p-8 text-center animate-fade-in">
              <CommandIcon size={24} className="text-zinc-700 mx-auto mb-2" />
              <p className="text-zinc-600 text-sm">No commands match "{filter}"</p>
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-zinc-800/20 flex items-center gap-4 text-[10px] text-zinc-600">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-zinc-800/30 rounded border border-zinc-700/20">↑↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-zinc-800/30 rounded border border-zinc-700/20">↵</kbd>
            select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-zinc-800/30 rounded border border-zinc-700/20">esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>
  );
};

export default GlobalPalette;
