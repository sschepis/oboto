import React, { useState, useEffect, useCallback } from 'react';
import TourStepComponent from './TourStep';
import type { TourStep } from '../../data/helpContent';

interface TourEngineProps {
  isActive: boolean;
  currentStep: TourStep | null;
  currentStepIndex: number;
  totalSteps: number;
  isLastStep: boolean;
  onNext: () => void;
  onPrev: () => void;
  onEnd: () => void;
  onComplete?: () => void;
}

const TourEngine: React.FC<TourEngineProps> = ({
  isActive,
  currentStep,
  currentStepIndex,
  totalSteps,
  isLastStep,
  onNext,
  onPrev,
  onEnd,
  onComplete,
}) => {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [stepPosition, setStepPosition] = useState({ top: 0, left: 0 });

  const updatePositions = useCallback(() => {
    if (!currentStep) return;
    const el = document.querySelector(currentStep.targetSelector);
    if (!el) {
      // Target not found — position in center
      setTargetRect(null);
      setStepPosition({
        top: window.innerHeight / 2 - 100,
        left: window.innerWidth / 2 - 150,
      });
      return;
    }

    const rect = el.getBoundingClientRect();
    setTargetRect(rect);

    const gap = 16;
    let top = 0;
    let left = 0;

    switch (currentStep.placement) {
      case 'bottom':
        top = rect.bottom + gap;
        left = rect.left + rect.width / 2 - 150;
        break;
      case 'top':
        top = rect.top - gap - 220; // Approximate popover height
        left = rect.left + rect.width / 2 - 150;
        break;
      case 'right':
        top = rect.top + rect.height / 2 - 100;
        left = rect.right + gap;
        break;
      case 'left':
        top = rect.top + rect.height / 2 - 100;
        left = rect.left - gap - 300;
        break;
      case 'center':
      default:
        top = window.innerHeight / 2 - 100;
        left = window.innerWidth / 2 - 150;
        break;
    }

    // Viewport clamping
    const pad = 12;
    left = Math.max(pad, Math.min(left, window.innerWidth - 312));
    top = Math.max(pad, Math.min(top, window.innerHeight - 250));

    setStepPosition({ top, left });
  }, [currentStep]);

  useEffect(() => {
    if (!isActive || !currentStep) return;
    const raf = requestAnimationFrame(updatePositions);
    return () => cancelAnimationFrame(raf);
  }, [isActive, currentStep, updatePositions]);

  useEffect(() => {
    if (!isActive) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEnd();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        if (isLastStep) {
          onComplete?.();
          onEnd();
        } else {
          onNext();
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onPrev();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isActive, isLastStep, onNext, onPrev, onEnd, onComplete]);

  if (!isActive || !currentStep) return null;

  const handleNext = () => {
    if (isLastStep) {
      onComplete?.();
      onEnd();
    } else {
      onNext();
    }
  };

  return (
    <>
      {/* Overlay with cutout */}
      <div className="fixed inset-0 z-[240] pointer-events-auto">
        {/* Dark overlay */}
        <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'auto' }}>
          <defs>
            <mask id="tour-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {targetRect && (
                <rect
                  x={targetRect.left - 6}
                  y={targetRect.top - 6}
                  width={targetRect.width + 12}
                  height={targetRect.height + 12}
                  rx="8"
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect
            x="0" y="0" width="100%" height="100%"
            fill="rgba(0,0,0,0.65)"
            mask="url(#tour-mask)"
            onClick={onEnd}
          />
        </svg>

        {/* Highlight border around target */}
        {targetRect && (
          <div
            className="fixed border-2 border-indigo-500/60 rounded-lg pointer-events-none shadow-[0_0_20px_rgba(99,102,241,0.15)]"
            style={{
              top: targetRect.top - 6,
              left: targetRect.left - 6,
              width: targetRect.width + 12,
              height: targetRect.height + 12,
            }}
          />
        )}

        {/* Tour step popover */}
        <TourStepComponent
          title={currentStep.title}
          content={currentStep.content}
          stepIndex={currentStepIndex}
          totalSteps={totalSteps}
          placement={currentStep.placement}
          position={stepPosition}
          isLast={isLastStep}
          onNext={handleNext}
          onPrev={onPrev}
          onSkip={onEnd}
        />
      </div>
    </>
  );
};

export default TourEngine;
