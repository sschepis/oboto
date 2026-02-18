import React from 'react';

export interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  direction?: 'vertical' | 'horizontal';
  gap?: number;
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between' | 'around';
  wrap?: boolean;
}

const alignMap = { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch' };
const justifyMap = { start: 'justify-start', center: 'justify-center', end: 'justify-end', between: 'justify-between', around: 'justify-around' };

export const Stack: React.FC<StackProps> = ({
  direction = 'vertical',
  gap = 2,
  align = 'stretch',
  justify = 'start',
  wrap = false,
  className = '',
  ...props
}) => (
  <div
    className={`flex ${direction === 'horizontal' ? 'flex-row' : 'flex-col'} gap-${gap} ${alignMap[align]} ${justifyMap[justify]} ${wrap ? 'flex-wrap' : ''} ${className}`}
    {...props}
  />
);
