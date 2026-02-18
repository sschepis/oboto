import React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';

export interface AvatarProps {
  src?: string;
  fallback?: string;
  alt?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeStyles = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-base',
  xl: 'h-20 w-20 text-xl',
};

export const Avatar: React.FC<AvatarProps> = ({ 
  src, 
  fallback, 
  alt, 
  size = 'md',
  className = '' 
}) => (
  <AvatarPrimitive.Root className={`relative flex shrink-0 overflow-hidden rounded-full ${sizeStyles[size]} ${className}`}>
    <AvatarPrimitive.Image
      src={src}
      alt={alt}
      className="aspect-square h-full w-full object-cover"
    />
    <AvatarPrimitive.Fallback className="flex h-full w-full items-center justify-center rounded-full bg-zinc-800 text-zinc-400 font-medium uppercase">
      {fallback || alt?.slice(0, 2) || '?'}
    </AvatarPrimitive.Fallback>
  </AvatarPrimitive.Root>
);
