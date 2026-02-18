import React, { useEffect, useRef } from 'react';
import { X, Keyboard, Command } from 'lucide-react';
import type { KeyboardShortcut } from '../../hooks/useKeyboardShortcuts';

interface KeyboardShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
  shortcuts: KeyboardShortcut[];
}

const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  tabs: 'Tabs',
  editor: 'Editor',
  navigation: 'Navigation',
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  general: <Command size={10} />,
  tabs: <Keyboard size={10} />,
  editor: <Keyboard size={10} />,
  navigation: <Keyboard size={10} />,
};

const CATEGORY_ORDER = ['general', 'tabs', 'editor', 'navigation'];

const KeyboardShortcutsHelp: React.FC<KeyboardShortcutsHelpProps> = ({ isOpen, onClose, shortcuts }) => {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Group shortcuts by category
  const grouped = CATEGORY_ORDER
    .map(cat => ({
      category: cat,
      label: CATEGORY_LABELS[cat] || cat,
      icon: CATEGORY_ICONS[cat],
      items: shortcuts.filter(s => s.category === cat),
    }))
    .filter(g => g.items.length > 0);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-md animate-fade-in"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="w-full max-w-lg bg-[#0d0d0d] border border-zinc-800/60 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/40 bg-zinc-900/20">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/15">
              <Keyboard size={14} className="text-indigo-400" />
            </div>
            <h2 className="text-sm font-bold text-zinc-200 tracking-wide">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-800/60 text-zinc-500 hover:text-zinc-300 transition-all duration-150 active:scale-90"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {grouped.map((group, groupIdx) => (
            <div key={group.category} className="animate-fade-in" style={{ animationDelay: `${groupIdx * 0.05}s` }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-indigo-400/50">{group.icon}</span>
                <h3 className="text-[10px] font-black uppercase tracking-[0.15em] text-indigo-400/70">
                  {group.label}
                </h3>
                <div className="flex-1 h-px bg-zinc-800/40" />
              </div>
              <div className="space-y-0.5">
                {group.items.map((shortcut, idx) => (
                  <div
                    key={shortcut.id}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-zinc-800/30 transition-all duration-150 group"
                    style={{ animationDelay: `${(groupIdx * 0.05) + (idx * 0.02)}s` }}
                  >
                    <span className="text-[12px] text-zinc-400 group-hover:text-zinc-300 transition-colors duration-150">
                      {shortcut.description}
                    </span>
                    <kbd className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-zinc-800/60 border border-zinc-700/40 text-[11px] font-mono text-zinc-300 shrink-0 ml-4 shadow-sm shadow-black/20 group-hover:border-zinc-600/50 group-hover:bg-zinc-800/80 transition-all duration-150">
                      {shortcut.display}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-800/40 flex items-center justify-between bg-zinc-900/10">
          <span className="text-[10px] text-zinc-600">
            {shortcuts.length} shortcuts available
          </span>
          <kbd className="text-[10px] text-zinc-600 font-mono px-1.5 py-0.5 rounded bg-zinc-800/40 border border-zinc-800/40">
            ESC
          </kbd>
        </div>
      </div>
    </div>
  );
};

export default KeyboardShortcutsHelp;
