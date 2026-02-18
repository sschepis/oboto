import React from 'react';
import { AlertTriangle, CheckCircle, Info, XCircle } from 'lucide-react';

export interface AlertProps {
  title?: string;
  children: React.ReactNode;
  variant?: 'default' | 'destructive' | 'success' | 'warning' | 'info';
  className?: string;
}

const variantStyles = {
  default: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  destructive: 'bg-red-500/15 text-red-400 border-red-500/30',
  success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  info: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
};

const variantIcons = {
  default: null,
  destructive: <XCircle className="h-4 w-4" />,
  success: <CheckCircle className="h-4 w-4" />,
  warning: <AlertTriangle className="h-4 w-4" />,
  info: <Info className="h-4 w-4" />,
};

export const Alert: React.FC<AlertProps> = ({ 
  title, 
  children, 
  variant = 'default',
  className = '' 
}) => {
  return (
    <div className={`relative w-full rounded-lg border px-4 py-3 text-sm flex gap-3 ${variantStyles[variant]} ${className}`}>
      {variantIcons[variant] && (
        <div className="shrink-0 pt-0.5 opacity-90">{variantIcons[variant]}</div>
      )}
      <div className="flex-1">
        {title && <h5 className="font-medium leading-none tracking-tight mb-1">{title}</h5>}
        <div className="text-sm opacity-90">{children}</div>
      </div>
    </div>
  );
};
