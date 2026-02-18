export interface UiManifest {
  project_id: string;
  layout: 'grid' | 'sidebar' | 'focus';
  components: ComponentDefinition[];
}

export interface ComponentDefinition {
  id: string;
  type: 'visualization' | 'control' | 'input';
  component: string;
  props?: Record<string, any>;
  actions?: Record<string, string>;
}

export interface IComponentRegistry {
  register(name: string, component: any): void;
  get(name: string): any | undefined;
}
