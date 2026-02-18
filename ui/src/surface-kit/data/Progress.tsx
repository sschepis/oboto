import React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';

export interface ProgressProps {
  value?: number;
  max?: number;
  className?: string;
}

export const Progress: React.FC<ProgressProps> = ({ 
  value = 0, 
  max = 100, 
  className = '' 
}) => {
  const percentage = Math.min(100, Math.max(0, ((value || 0) / max) * 100));
  
  return (
    <ProgressPrimitive.Root
      className={`relative h-2 w-full overflow-hidden rounded-full bg-zinc-800 ${className}`}
      value={value}
      max={max}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-indigo-500 transition-all duration-500 ease-in-out"
        style={{ transform: `translateX(-${100 - percentage}%)` }}
      />
    </ProgressPrimitive.Root>
  );
};
