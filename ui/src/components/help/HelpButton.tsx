import React, { useState, useRef, useEffect } from 'react';
import { HelpCircle, BookOpen, GraduationCap, MousePointerClick, RotateCcw, Keyboard } from 'lucide-react';

interface HelpButtonProps {
  onOpenHelp?: () => void;
  onOpenShortcuts?: () => void;
  onStartTour?: (tourId: string) => void;
  onWhatIsThis?: () => void;
  onResetHelp?: () => void;
}

const HelpButton: React.FC<HelpButtonProps> = ({
  onOpenHelp,
  onOpenShortcuts,
  onStartTour,
  onWhatIsThis,
  onResetHelp,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  const menuItems = [
    {
      icon: <BookOpen size={13} />,
      label: 'Help & Documentation',
      shortcut: '⌘/',
      onClick: () => { setMenuOpen(false); onOpenHelp?.(); },
    },
    {
      icon: <Keyboard size={13} />,
      label: 'Keyboard Shortcuts',
      shortcut: '⌘⇧/',
      onClick: () => { setMenuOpen(false); onOpenShortcuts?.(); },
    },
    {
      icon: <GraduationCap size={13} />,
      label: 'Start Tour',
      onClick: () => { setMenuOpen(false); onStartTour?.('onboarding'); },
    },
    {
      icon: <MousePointerClick size={13} />,
      label: 'What Is This?',
      onClick: () => { setMenuOpen(false); onWhatIsThis?.(); },
    },
    { divider: true },
    {
      icon: <RotateCcw size={13} />,
      label: 'Reset Help Tips',
      onClick: () => { setMenuOpen(false); onResetHelp?.(); },
      subtle: true,
    },
  ];

  return (
    <div ref={menuRef} className="relative" data-help-id="header.help">
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="
          flex items-center gap-1.5 text-zinc-500 hover:text-zinc-200 p-1.5 rounded-lg
          transition-all duration-200 hover:bg-zinc-800/50 active:scale-95
        "
        title="Help (⌘/)"
      >
        <HelpCircle size={13} />
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-[#0d0d0d]/95 border border-zinc-800/50 rounded-xl shadow-2xl shadow-black/50 backdrop-blur-xl overflow-hidden animate-scale-in z-[100]">
          <div className="p-1">
            {menuItems.map((item, i) => {
              if ('divider' in item && item.divider) {
                return <div key={i} className="h-px bg-zinc-800/30 my-1" />;
              }
              const mi = item as typeof menuItems[0] & { label: string; icon: React.ReactNode; onClick: () => void; shortcut?: string; subtle?: boolean };
              return (
                <button
                  key={i}
                  onClick={mi.onClick}
                  className={`
                    w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left
                    transition-all duration-150 group
                    ${mi.subtle
                      ? 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/20'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30'}
                  `}
                >
                  <span className="text-zinc-500 group-hover:text-indigo-400 transition-colors">
                    {mi.icon}
                  </span>
                  <span className="flex-1 text-[12px] font-medium">{mi.label}</span>
                  {mi.shortcut && (
                    <kbd className="text-[10px] font-mono text-zinc-600 bg-zinc-800/30 px-1.5 py-0.5 rounded border border-zinc-700/20">
                      {mi.shortcut}
                    </kbd>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default HelpButton;
