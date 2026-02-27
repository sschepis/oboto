import React, { useState } from 'react';
import { Lightbulb, X, ChevronDown, ChevronUp } from 'lucide-react';

interface InlineHelpProps {
  id: string;
  title: string;
  children: React.ReactNode;
  isDismissed?: boolean;
  onDismiss?: (id: string) => void;
  links?: { label: string; onClick: () => void }[];
  defaultExpanded?: boolean;
}

const InlineHelp: React.FC<InlineHelpProps> = ({
  id,
  title,
  children,
  isDismissed = false,
  onDismiss,
  links,
  defaultExpanded = true,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (isDismissed) {
    return null;
  }

  return (
    <div className="bg-indigo-500/[0.04] border border-indigo-500/10 rounded-xl overflow-hidden mb-4 animate-fade-in">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-indigo-500/[0.03] transition-colors"
      >
        <Lightbulb size={12} className="text-indigo-400/70 shrink-0" />
        <span className="flex-1 text-[11px] font-semibold text-indigo-300/80">{title}</span>
        {expanded ? (
          <ChevronUp size={12} className="text-indigo-400/40" />
        ) : (
          <ChevronDown size={12} className="text-indigo-400/40" />
        )}
      </button>

      {/* Expandable body */}
      <div
        className={`
          grid transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
          ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}
        `}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-1">
            <div className="text-[11px] text-zinc-400 leading-relaxed">
              {children}
            </div>

            {/* Links + dismiss */}
            <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-indigo-500/5">
              <div className="flex items-center gap-3">
                {links?.map((link, i) => (
                  <button
                    key={i}
                    onClick={link.onClick}
                    className="text-[10px] font-medium text-indigo-400/70 hover:text-indigo-400 transition-colors"
                  >
                    ▸ {link.label}
                  </button>
                ))}
              </div>
              {onDismiss && (
                <button
                  onClick={() => onDismiss(id)}
                  className="flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  <X size={10} />
                  Dismiss
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InlineHelp;
