import React from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';

export interface ScrollAreaProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'dir'> {
  orientation?: 'vertical' | 'horizontal' | 'both';
  dir?: 'ltr' | 'rtl';
}

export const ScrollArea: React.FC<ScrollAreaProps> = ({ 
  children, 
  className = '',
  orientation = 'vertical',
  ...props 
}) => (
  <ScrollAreaPrimitive.Root className={`relative overflow-hidden ${className}`} {...props}>
    <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
      {children}
    </ScrollAreaPrimitive.Viewport>
    {(orientation === 'vertical' || orientation === 'both') && (
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex touch-none select-none transition-colors h-full w-2 border-l border-l-transparent p-px"
      >
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-zinc-700 hover:bg-zinc-600" />
      </ScrollAreaPrimitive.Scrollbar>
    )}
    {(orientation === 'horizontal' || orientation === 'both') && (
      <ScrollAreaPrimitive.Scrollbar
        orientation="horizontal"
        className="flex touch-none select-none transition-colors flex-col h-2 border-t border-t-transparent p-px"
      >
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-zinc-700 hover:bg-zinc-600" />
      </ScrollAreaPrimitive.Scrollbar>
    )}
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
);
