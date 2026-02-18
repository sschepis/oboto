import React from 'react';
import * as SeparatorPrimitive from '@radix-ui/react-separator';

export interface SeparatorProps {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  decorative?: boolean;
}

export const Separator: React.FC<SeparatorProps> = ({ 
  orientation = 'horizontal', 
  className = '',
  decorative = true,
}) => (
  <SeparatorPrimitive.Root
    decorative={decorative}
    orientation={orientation}
    className={`shrink-0 bg-zinc-800 ${
      orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px'
    } ${className}`}
  />
);
