import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'success' | 'destructive' | 'warning' | 'outline';
}

const variantStyles: Record<string, string> = {
  default: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  secondary: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  destructive: 'bg-red-500/15 text-red-400 border-red-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  outline: 'bg-transparent text-zinc-400 border-zinc-600',
};

export const Badge: React.FC<BadgeProps> = ({ variant = 'default', className = '', ...props }) => (
  <span
    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase transition-colors ${variantStyles[variant]} ${className}`}
    {...props}
  />
);
