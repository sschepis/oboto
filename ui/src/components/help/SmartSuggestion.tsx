import React, { useState, useEffect } from 'react';
import { X, Lightbulb, ArrowRight } from 'lucide-react';

interface SmartSuggestionProps {
  id: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: (id: string) => void;
  autoHideMs?: number;
}

const SmartSuggestion: React.FC<SmartSuggestionProps> = ({
  id,
  message,
  actionLabel,
  onAction,
  onDismiss,
  autoHideMs = 10000,
}) => {
  const [visible, setVisible] = useState(true);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => {
        setVisible(false);
        onDismiss(id);
      }, 300);
    }, autoHideMs);

    return () => clearTimeout(timer);
  }, [autoHideMs, id, onDismiss]);

  const handleDismiss = () => {
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      onDismiss(id);
    }, 300);
  };

  if (!visible) return null;

  return (
    <div
      className={`
        fixed bottom-6 right-6 z-[160] max-w-[340px]
        transition-all duration-300
        ${exiting ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0 animate-fade-in'}
      `}
    >
      <div className="bg-[#0d0d0d]/95 border border-zinc-800/50 rounded-xl shadow-2xl shadow-black/50 backdrop-blur-xl overflow-hidden">
        <div className="flex items-start gap-3 px-4 py-3">
          <Lightbulb size={14} className="text-amber-400/70 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] text-zinc-300 leading-relaxed">{message}</p>
            {actionLabel && onAction && (
              <button
                onClick={() => {
                  handleDismiss();
                  onAction();
                }}
                className="flex items-center gap-1 mt-2 text-[11px] font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                {actionLabel}
                <ArrowRight size={10} />
              </button>
            )}
          </div>
          <button
            onClick={handleDismiss}
            className="p-1 rounded-md hover:bg-zinc-800/40 text-zinc-600 hover:text-zinc-400 transition-colors shrink-0"
          >
            <X size={12} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default SmartSuggestion;
