import React from 'react';
import { IComponentRegistry } from './types';
// @ts-ignore - .mjs module (see console-styler.d.ts for types)
import { consoleStyler } from '../console-styler.mjs';

class ComponentRegistry implements IComponentRegistry {
  private components: Map<string, React.ComponentType<any>>;

  constructor() {
    this.components = new Map();
  }

  register(name: string, component: React.ComponentType<any>): void {
    if (this.components.has(name)) {
      consoleStyler.log('warning', `Component ${name} already registered. Overwriting.`);
    }
    this.components.set(name, component);
  }

  get(name: string): React.ComponentType<any> | undefined {
    return this.components.get(name);
  }
}

export const componentRegistry = new ComponentRegistry();
