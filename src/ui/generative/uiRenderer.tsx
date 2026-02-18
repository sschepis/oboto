import React, { useEffect, useState } from 'react';
import { UiManifest, ComponentDefinition } from './types';
import { componentRegistry } from './componentRegistry';
import { ErrorBoundary } from './errorBoundary';

interface UiRendererProps {
  manifest: UiManifest;
}

export const UiRenderer: React.FC<UiRendererProps> = ({ manifest }) => {
  const [components, setComponents] = useState<ComponentDefinition[]>([]);

  useEffect(() => {
    if (manifest && manifest.components) {
      setComponents(manifest.components);
    }
  }, [manifest]);

  return (
    <div className={`layout-${manifest.layout}`}>
      {components.map((comp) => {
        const Component = componentRegistry.get(comp.component);
        if (!Component) {
          return (
            <div key={comp.id} className="component-placeholder">
              Unknown Component: {comp.component}
            </div>
          );
        }
        
        return (
          <ErrorBoundary key={comp.id}>
            <Component {...comp.props} />
          </ErrorBoundary>
        );
      })}
    </div>
  );
};
