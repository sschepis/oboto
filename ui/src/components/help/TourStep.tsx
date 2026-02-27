import React from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface TourStepProps {
  title: string;
  content: string;
  stepIndex: number;
  totalSteps: number;
  placement: 'top' | 'bottom' | 'left' | 'right' | 'center';
  position: { top: number; left: number };
  isLast: boolean;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}

/** Format inline bold markdown **text** */
function formatInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(<strong key={match.index} className="font-bold text-zinc-100">{match[1]}</strong>);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? <>{parts}</> : text;
}

const TourStepComponent: React.FC<TourStepProps> = ({
  title,
  content,
  stepIndex,
  totalSteps,
  position,
  isLast,
  onNext,
  onPrev,
  onSkip,
}) => {
  return (
    <div
      className="fixed z-[250] animate-scale-in"
      style={{ top: position.top, left: position.left }}
    >
      <div className="w-[300px] bg-[#0d0d0d]/95 border border-zinc-800/50 rounded-xl shadow-2xl shadow-black/50 backdrop-blur-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/30">
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-indigo-400/70">
            Step {stepIndex + 1} of {totalSteps}
          </span>
          <button
            onClick={onSkip}
            className="p-1 rounded-md hover:bg-zinc-800/40 text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            <X size={12} />
          </button>
        </div>

        {/* Content */}
        <div className="px-4 py-3">
          <h3 className="text-[13px] font-bold text-zinc-200 mb-1.5">{title}</h3>
          <p className="text-[12px] text-zinc-400 leading-relaxed">
            {formatInline(content)}
          </p>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-zinc-800/30 flex items-center justify-between">
          {/* Progress dots */}
          <div className="flex items-center gap-1">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`
                  w-1.5 h-1.5 rounded-full transition-all duration-200
                  ${i === stepIndex
                    ? 'bg-indigo-500 w-3'
                    : i < stepIndex
                      ? 'bg-zinc-600'
                      : 'bg-zinc-800'}
                `}
              />
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-1.5">
            {stepIndex > 0 && (
              <button
                onClick={onPrev}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 transition-all"
              >
                <ChevronLeft size={12} />
                Back
              </button>
            )}
            <button
              onClick={onNext}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-md shadow-indigo-500/20"
            >
              {isLast ? 'Done' : 'Next'}
              {!isLast && <ChevronRight size={12} />}
            </button>
          </div>
        </div>

        {/* Skip link */}
        <div className="px-4 pb-2.5 text-center">
          <button
            onClick={onSkip}
            className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Skip Tour
          </button>
        </div>
      </div>
    </div>
  );
};

export default TourStepComponent;
