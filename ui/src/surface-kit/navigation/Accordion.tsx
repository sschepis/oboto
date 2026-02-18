import React from 'react';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';

export const Accordion: React.FC<React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Root>> = ({ className = '', ...props }) => (
  <AccordionPrimitive.Root className={className} {...props} />
);

export const AccordionItem: React.FC<React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>> = ({ className = '', ...props }) => (
  <AccordionPrimitive.Item className={`border-b border-zinc-800 ${className}`} {...props} />
);

export const AccordionTrigger: React.FC<React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>> = ({ className = '', children, ...props }) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      className={`flex flex-1 items-center justify-between py-4 text-sm font-medium transition-all hover:underline [&[data-state=open]>svg]:rotate-180 ${className}`}
      {...props}
    >
      {children}
      <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-200" />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
);

export const AccordionContent: React.FC<React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>> = ({ className = '', children, ...props }) => (
  <AccordionPrimitive.Content
    className={`overflow-hidden text-sm data-[state=closed]:animate-accordion-down data-[state=open]:animate-accordion-up ${className}`}
    {...props}
  >
    <div className="pb-4 pt-0 text-zinc-400">{children}</div>
  </AccordionPrimitive.Content>
);
