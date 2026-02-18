import React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';

export type LabelProps = React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>;

export const Label: React.FC<LabelProps> = ({ className = '', ...props }) => (
  <LabelPrimitive.Root
    className={`text-xs font-medium text-zinc-400 leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 ${className}`}
    {...props}
  />
);
