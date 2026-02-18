import React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';

export interface CheckboxProps {
  checked?: boolean | 'indeterminate';
  onCheckedChange?: (checked: boolean | 'indeterminate') => void;
  disabled?: boolean;
  label?: string;
  id?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({ 
  checked, 
  onCheckedChange, 
  disabled, 
  label,
  id 
}) => {
  const uniqueId = React.useId();
  const generatedId = id || uniqueId;
  
  return (
    <div className="flex items-center space-x-2">
      <CheckboxPrimitive.Root
        id={generatedId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="peer h-4 w-4 shrink-0 rounded-sm border border-zinc-500 bg-transparent shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-zinc-50 data-[state=checked]:text-zinc-900"
      >
        <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
          <Check className="h-4 w-4" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label && (
        <label
          htmlFor={generatedId}
          className="text-sm font-medium leading-none text-zinc-400 peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          {label}
        </label>
      )}
    </div>
  );
};
