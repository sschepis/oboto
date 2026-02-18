import React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

export const Tabs = TabsPrimitive.Root;

export const TabsList: React.FC<React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>> = ({ className = '', ...props }) => (
  <TabsPrimitive.List
    className={`inline-flex h-9 items-center justify-center rounded-lg bg-zinc-900 p-1 text-zinc-400 ${className}`}
    {...props}
  />
);

export const TabsTrigger: React.FC<React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>> = ({ className = '', ...props }) => (
  <TabsPrimitive.Trigger
    className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-zinc-950 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-50 data-[state=active]:shadow ${className}`}
    {...props}
  />
);

export const TabsContent: React.FC<React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>> = ({ className = '', ...props }) => (
  <TabsPrimitive.Content
    className={`mt-2 ring-offset-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 ${className}`}
    {...props}
  />
);
