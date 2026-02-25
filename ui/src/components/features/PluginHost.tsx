import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { wsService } from '../../services/wsService';

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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [CompiledComponent, setCompiledComponent] = useState<React.FC<Record<string, unknown>> | null>(null);

  // Fetch the component source
  useEffect(() => {
    setLoading(true);
    setError(null);

    const unsub = wsService.on('plugin:component-source', (payload: unknown) => {
      const data = payload as {
        pluginName: string;
        componentFile: string;
        source: string | null;
        error: string | null;
      };

      if (data.pluginName === pluginName && data.componentFile === componentFile) {
        if (data.error) {
          setError(data.error);
          setLoading(false);
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

  // Compile the source once received
  const compileSource = useCallback(async (jsx: string) => {
    try {
      // Try to use the surface compiler if available
      const { compileComponent } = await import('./surface/surfaceCompiler');
      const Component = compileComponent(jsx, `${pluginName}/${componentFile}`);
      // Wrap in arrow to avoid React treating it as a state updater function
      setCompiledComponent(() => Component as React.FC<Record<string, unknown>>);
      setLoading(false);
    } catch (err) {
      // Fallback: render the source as a simple info display
      setError(`Failed to compile component: ${(err as Error).message}`);
      setLoading(false);
    }
  }, [pluginName, componentFile]);

  useEffect(() => {
    if (source) {
      compileSource(source);
    }
  }, [source, compileSource]);

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
