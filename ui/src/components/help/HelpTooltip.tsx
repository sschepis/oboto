import React, { useState, useRef, useEffect, useCallback } from 'react';
import { tooltips, type HelpTooltipData } from '../../data/helpContent';

interface HelpTooltipProps {
  helpId: string;
  children: React.ReactNode;
  onLearnMore?: (articleId: string) => void;
  delay?: number;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

const HelpTooltip: React.FC<HelpTooltipProps> = ({
  helpId,
  children,
  onLearnMore,
  delay = 400,
  placement = 'bottom',
}) => {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const data: HelpTooltipData | undefined = tooltips[helpId];

  const calcPosition = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const gap = 8;

    let top = 0;
    let left = 0;

    switch (placement) {
      case 'top':
        top = triggerRect.top - tooltipRect.height - gap;
        left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
        break;
      case 'bottom':
        top = triggerRect.bottom + gap;
        left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
        break;
      case 'left':
        top = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
        left = triggerRect.left - tooltipRect.width - gap;
        break;
      case 'right':
        top = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
        left = triggerRect.right + gap;
        break;
    }

    // Viewport clamping
    const pad = 8;
    if (left < pad) left = pad;
    if (left + tooltipRect.width > window.innerWidth - pad) left = window.innerWidth - tooltipRect.width - pad;
    if (top < pad) top = pad;
    if (top + tooltipRect.height > window.innerHeight - pad) top = window.innerHeight - tooltipRect.height - pad;

    setPosition({ top, left });
  }, [placement]);

  useEffect(() => {
    if (visible) {
      // Defer calculation to next frame so tooltip is rendered
      requestAnimationFrame(calcPosition);
    }
  }, [visible, calcPosition]);

  const handleMouseEnter = () => {
    timerRef.current = setTimeout(() => setVisible(true), delay);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  };

  if (!data) {
    return <>{children}</>;
  }

  return (
    <div
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="inline-flex"
    >
      {children}

      {visible && (
        <div
          ref={tooltipRef}
          className="fixed z-[300] pointer-events-auto animate-fade-in"
          style={{ top: position.top, left: position.left }}
          onMouseEnter={() => {
            if (timerRef.current) clearTimeout(timerRef.current);
          }}
          onMouseLeave={handleMouseLeave}
        >
          <div className="max-w-[280px] bg-[#0d0d0d]/95 border border-zinc-800/50 rounded-xl shadow-2xl shadow-black/50 backdrop-blur-xl overflow-hidden">
            {/* Title */}
            <div className="px-3 py-2 border-b border-zinc-800/30">
              <span className="text-[11px] font-bold text-zinc-200">{data.title}</span>
            </div>

            {/* Description */}
            <div className="px-3 py-2">
              <p className="text-[11px] text-zinc-400 leading-relaxed">{data.description}</p>
            </div>

            {/* Shortcut + Learn More */}
            {(data.shortcut || data.learnMoreId) && (
              <div className="px-3 py-2 border-t border-zinc-800/30 flex items-center justify-between">
                {data.shortcut && (
                  <kbd className="text-[10px] font-mono text-zinc-500 bg-zinc-800/40 px-1.5 py-0.5 rounded border border-zinc-700/30">
                    {data.shortcut}
                  </kbd>
                )}
                {data.learnMoreId && onLearnMore && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setVisible(false);
                      onLearnMore(data.learnMoreId!);
                    }}
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
                  >
                    Learn more →
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default HelpTooltip;
