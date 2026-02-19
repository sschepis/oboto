import React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';

export const DropdownMenu: React.FC<{ 
  trigger: React.ReactNode; 
  children: React.ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
}> = ({ trigger, children, align = 'end', side = 'bottom' }) => (
  <DropdownMenuPrimitive.Root>
    <DropdownMenuPrimitive.Trigger asChild>{trigger}</DropdownMenuPrimitive.Trigger>
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        side={side}
        sideOffset={4}
        className="z-[99999] min-w-[8rem] overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 p-1 text-zinc-200 shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  </DropdownMenuPrimitive.Root>
);

export const DropdownMenuItem: React.FC<{ 
  onClick?: () => void; 
  disabled?: boolean; 
  children: React.ReactNode;
  className?: string;
}> = ({ onClick, disabled, children, className = '' }) => (
  <DropdownMenuPrimitive.Item
    onClick={onClick}
    disabled={disabled}
    className={`relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-zinc-800 focus:text-zinc-200 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ${className}`}
  >
    {children}
  </DropdownMenuPrimitive.Item>
);

export const DropdownMenuSeparator: React.FC = () => (
  <DropdownMenuPrimitive.Separator className="-mx-1 my-1 h-px bg-zinc-800" />
);

export const DropdownMenuLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <DropdownMenuPrimitive.Label className="px-2 py-1.5 text-sm font-semibold text-zinc-400">
    {children}
  </DropdownMenuPrimitive.Label>
);
