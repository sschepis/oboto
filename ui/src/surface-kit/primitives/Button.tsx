import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'link';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

const variantStyles: Record<string, string> = {
  default: 'bg-indigo-600 text-white hover:bg-indigo-500 border-transparent',
  outline: 'bg-transparent text-zinc-300 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100',
  ghost: 'bg-transparent text-zinc-400 border-transparent hover:bg-zinc-800 hover:text-zinc-200',
  destructive: 'bg-red-600 text-white hover:bg-red-500 border-transparent',
  link: 'bg-transparent text-indigo-400 underline-offset-4 hover:underline border-transparent p-0 h-auto',
};

const sizeStyles: Record<string, string> = {
  sm: 'h-7 px-2.5 text-xs rounded-md',
  md: 'h-8 px-3 text-sm rounded-lg',
  lg: 'h-10 px-4 text-sm rounded-lg',
  icon: 'h-8 w-8 rounded-lg p-0 flex items-center justify-center',
};

export const Button: React.FC<ButtonProps> = ({ 
  variant = 'default', 
  size = 'md', 
  className = '', 
  disabled,
  ...props 
}) => (
  <button
    className={`inline-flex items-center justify-center gap-2 font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 disabled:opacity-50 disabled:pointer-events-none cursor-pointer ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
    disabled={disabled}
    {...props}
  />
);
