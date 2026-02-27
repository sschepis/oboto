import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';

interface FeatureSpotlightProps {
  id: string;
  targetSelector: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: (id: string) => void;
  isShown?: boolean;
}

const FeatureSpotlight: React.FC<FeatureSpotlightProps> = ({
  id,
  targetSelector,
  title,
  description,
  actionLabel,
  onAction,
  onDismiss,
  isShown = false,
}) => {
  const [position, setPosition] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const popoverRef = useRef<HTMLDivElement>(null);

  const calcPositions = useCallback(() => {
    const target = document.querySelector(targetSelector);
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const pad = 4;
    setPosition({
      top: rect.top - pad,
      left: rect.left - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    });

    // Popover below the target
    setPopoverPos({
      top: rect.bottom + 12,
      left: Math.max(8, rect.left + rect.width / 2 - 140),
    });
  }, [targetSelector]);

  useEffect(() => {
    if (isShown) return; // Already shown/dismissed — don't calculate
    // Defer initial calculation to avoid synchronous setState in effect body
    const raf = requestAnimationFrame(calcPositions);
    const interval = setInterval(calcPositions, 500);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(interval);
    };
  }, [isShown, calcPositions]);

  if (isShown || !position) return null;

  return (
    <>
      {/* Pulsing ring around target */}
      <div
        className="fixed z-[180] pointer-events-none"
        style={{
          top: position.top,
          left: position.left,
          width: position.width,
          height: position.height,
        }}
      >
        <div className="absolute inset-0 rounded-lg border-2 border-indigo-500/50 animate-pulse" />
        <div className="absolute inset-0 rounded-lg border border-indigo-400/20 animate-ping" style={{ animationDuration: '2s' }} />
      </div>

      {/* Popover */}
      <div
        ref={popoverRef}
        className="fixed z-[181] animate-fade-in"
        style={{ top: popoverPos.top, left: popoverPos.left }}
      >
        <div className="w-[280px] bg-[#0d0d0d]/95 border border-zinc-800/50 rounded-xl shadow-2xl shadow-black/50 backdrop-blur-xl overflow-hidden">
          {/* Arrow */}
          <div className="absolute -top-1.5 left-8 w-3 h-3 bg-[#0d0d0d] border-l border-t border-zinc-800/50 rotate-45" />

          <div className="px-3.5 py-3">
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <h4 className="text-[12px] font-bold text-zinc-200">{title}</h4>
              <button
                onClick={() => onDismiss(id)}
                className="p-0.5 rounded hover:bg-zinc-800/40 text-zinc-600 hover:text-zinc-400 transition-colors shrink-0"
              >
                <X size={11} />
              </button>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed mb-3">{description}</p>
            <div className="flex items-center gap-2">
              {actionLabel && onAction && (
                <button
                  onClick={() => {
                    onDismiss(id);
                    onAction();
                  }}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold rounded-lg transition-colors"
                >
                  {actionLabel}
                </button>
              )}
              <button
                onClick={() => onDismiss(id)}
                className="px-3 py-1.5 text-zinc-500 hover:text-zinc-300 text-[10px] font-medium transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default FeatureSpotlight;
