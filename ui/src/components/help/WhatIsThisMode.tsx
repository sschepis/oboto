import React, { useEffect, useCallback } from 'react';
import { MousePointerClick } from 'lucide-react';
import { tooltips } from '../../data/helpContent';

interface WhatIsThisModeProps {
  isActive: boolean;
  onExit: () => void;
  onSelectHelpId: (helpId: string) => void;
}

const WhatIsThisMode: React.FC<WhatIsThisModeProps> = ({
  isActive,
  onExit,
  onSelectHelpId,
}) => {
  const handleClick = useCallback((e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Walk up the DOM tree looking for data-help-id
    let el = e.target as HTMLElement | null;
    while (el) {
      const helpId = el.getAttribute('data-help-id');
      if (helpId) {
        onExit();
        // If we have a tooltip with a learnMoreId, navigate to that article
        const tooltip = tooltips[helpId];
        if (tooltip?.learnMoreId) {
          onSelectHelpId(tooltip.learnMoreId);
        } else {
          // Show tooltip info for this element
          onSelectHelpId(helpId);
        }
        return;
      }
      el = el.parentElement;
    }

    // No help ID found — exit mode
    onExit();
  }, [onExit, onSelectHelpId]);

  useEffect(() => {
    if (!isActive) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onExit();
      }
    };

    // Use capture phase to intercept clicks before other handlers
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKey);

    // Change cursor
    document.body.style.cursor = 'help';

    return () => {
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKey);
      document.body.style.cursor = '';
    };
  }, [isActive, handleClick, onExit]);

  if (!isActive) return null;

  return (
    <>
      {/* Subtle overlay tint */}
      <div className="fixed inset-0 z-[170] bg-indigo-500/[0.03] pointer-events-none animate-fade-in" />

      {/* Status bar indicator */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[175] animate-fade-in">
        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-[#0d0d0d]/95 border border-indigo-500/20 rounded-xl shadow-2xl shadow-black/50 backdrop-blur-xl">
          <MousePointerClick size={14} className="text-indigo-400 animate-pulse" />
          <span className="text-[12px] text-zinc-300 font-medium">
            Click any element for help
          </span>
          <span className="text-zinc-600 mx-1">·</span>
          <span className="text-[11px] text-zinc-500">
            Press <kbd className="px-1.5 py-0.5 bg-zinc-800/40 rounded border border-zinc-700/30 font-mono text-zinc-400 text-[10px]">ESC</kbd> to exit
          </span>
        </div>
      </div>
    </>
  );
};

export default WhatIsThisMode;
