import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle, AlertTriangle, XCircle, Info } from 'lucide-react';

export type ToastVariant = 'default' | 'success' | 'destructive' | 'warning' | 'info';

export interface ToastProps {
  id: string;
  title?: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
  onDismiss: (id: string) => void;
}

const ToastItem: React.FC<ToastProps> = ({ 
  id, 
  title, 
  description, 
  variant = 'default', 
  duration = 5000, 
  onDismiss 
}) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Small delay to allow animation to start
    requestAnimationFrame(() => setIsVisible(true));

    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => onDismiss(id), 300); // Wait for exit animation
    }, duration);

    return () => clearTimeout(timer);
  }, [id, duration, onDismiss]);

  const variantStyles = {
    default: 'bg-zinc-900 border-zinc-800 text-zinc-200',
    success: 'bg-zinc-900 border-emerald-500/30 text-emerald-400',
    destructive: 'bg-zinc-900 border-red-500/30 text-red-400',
    warning: 'bg-zinc-900 border-amber-500/30 text-amber-400',
    info: 'bg-zinc-900 border-indigo-500/30 text-indigo-400',
  };

  const variantIcons = {
    default: null,
    success: <CheckCircle className="h-4 w-4" />,
    destructive: <XCircle className="h-4 w-4" />,
    warning: <AlertTriangle className="h-4 w-4" />,
    info: <Info className="h-4 w-4" />,
  };

  return (
    <div
      className={`pointer-events-auto relative w-full rounded-lg border p-4 shadow-lg transition-all duration-300 ease-in-out ${
        isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      } ${variantStyles[variant]}`}
    >
      <div className="flex gap-3">
        {variantIcons[variant] && (
          <div className="shrink-0 pt-0.5">{variantIcons[variant]}</div>
        )}
        <div className="flex-1">
          {title && <div className="text-sm font-semibold">{title}</div>}
          {description && <div className="text-sm opacity-90">{description}</div>}
        </div>
        <button
          onClick={() => {
            setIsVisible(false);
            setTimeout(() => onDismiss(id), 300);
          }}
          className="absolute right-2 top-2 rounded-md p-1 opacity-50 transition-opacity hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

// Global event bus for toasts (since they can be triggered from inside the sandbox)
type ToastEvent = Omit<ToastProps, 'id' | 'onDismiss'>;
const listeners = new Set<(toast: ToastEvent) => void>();

// eslint-disable-next-line react-refresh/only-export-components
export const toast = (props: ToastEvent) => {
  listeners.forEach(listener => listener(props));
};

export const ToastProvider: React.FC = () => {
  const [toasts, setToasts] = useState<ToastProps[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    const addToast = (props: ToastEvent) => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts(prev => [...prev, { ...props, id, onDismiss: dismissToast }]);
    };

    listeners.add(addToast);
    return () => {
      listeners.delete(addToast);
    };
  }, [dismissToast]);

  // Render into a portal at the document body level to ensure it's on top of everything
  return createPortal(
    <div className="fixed bottom-0 right-0 z-[200] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]">
      {toasts.map(toast => (
        <ToastItem key={toast.id} {...toast} />
      ))}
    </div>,
    document.body
  );
};
