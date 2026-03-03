import React, { useState, useEffect, useMemo } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { wsService } from '../../services/wsService';
import { compileComponent } from './surface/surfaceCompiler';

interface PluginHostProps {
  /** Plugin name */
  pluginName: string;
  /** Component filename (relative to plugin dir) */
  componentFile: string;
  /** Optional props to pass to the rendered component */
  componentProps?: Record<string, unknown>;
  /** Fallback content while loading */
  fallback?: React.ReactNode;
}

/**
 * PluginHost renders a plugin UI component by fetching its JSX source
 * from the server and compiling it at runtime using the surface compiler.
 *
 * This provides a sandboxed rendering environment similar to how Surfaces work.
 */
const PluginHost: React.FC<PluginHostProps> = ({
  pluginName,
  componentFile,
  componentProps = {},
  fallback,
}) => {
  const [source, setSource] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Reset state during render when plugin/component changes.
  // This is a React-recommended pattern for synchronising state with props
  // *without* an Effect.  It triggers a synchronous re-render before the
  // browser paints, which avoids the stale-UI flash that useEffect would cause.
  // See: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevKey, setPrevKey] = useState(`${pluginName}/${componentFile}`);
  const currentKey = `${pluginName}/${componentFile}`;
  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    setSource(null);
    setFetchError(null);
  }

  // Subscribe to WS for component source and request it
  useEffect(() => {
    const unsub = wsService.on('plugin:component-source', (payload: unknown) => {
      const data = payload as {
        pluginName: string;
        componentFile: string;
        source: string | null;
        error: string | null;
      };

      if (data.pluginName === pluginName && data.componentFile === componentFile) {
        if (data.error) {
          setFetchError(data.error);
        } else if (data.source) {
          setSource(data.source);
        }
      }
    });

    wsService.sendMessage('plugin:get-component', { pluginName, componentFile });

    return () => {
      unsub();
    };
  }, [pluginName, componentFile]);

  // Derive compiled component from source (synchronous transform, not an effect)
  const { CompiledComponent, compileError } = useMemo(() => {
    if (!source) return { CompiledComponent: null, compileError: null };
    try {
      const Component = compileComponent(source, `${pluginName}/${componentFile}`);
      return {
        CompiledComponent: Component as React.FC<Record<string, unknown>>,
        compileError: null,
      };
    } catch (err) {
      return {
        CompiledComponent: null,
        compileError: `Failed to compile component: ${(err as Error).message}`,
      };
    }
  }, [source, pluginName, componentFile]);

  // Derive loading and error from state (no explicit loading state needed)
  const error = fetchError || compileError;
  const loading = !source && !fetchError;

  if (loading) {
    return fallback || (
      <div className="flex items-center justify-center h-full text-zinc-500 text-xs gap-2 p-4">
        <Loader2 size={14} className="animate-spin" />
        Loading plugin component...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded p-3 m-2">
        <AlertCircle size={14} className="shrink-0" />
        <div>
          <p className="font-medium">Plugin Error</p>
          <p className="text-[10px] text-red-500 mt-0.5">{error}</p>
        </div>
      </div>
    );
  }

  if (CompiledComponent) {
    return (
      <div className="plugin-host" data-plugin={pluginName} data-component={componentFile}>
        <ErrorBoundary pluginName={pluginName}>
          <CompiledComponent {...componentProps} />
        </ErrorBoundary>
      </div>
    );
  }

  return null;
};

/**
 * Error boundary to catch rendering errors in plugin components.
 */
class ErrorBoundary extends React.Component<
  { pluginName: string; children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { pluginName: string; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded p-3 m-2">
          <AlertCircle size={14} className="shrink-0" />
          <div>
            <p className="font-medium">Plugin Render Error ({this.props.pluginName})</p>
            <p className="text-[10px] text-red-500 mt-0.5">{this.state.error?.message}</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default PluginHost;
