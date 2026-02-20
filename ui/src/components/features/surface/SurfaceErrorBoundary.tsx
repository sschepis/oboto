/**
 * Surface Error Boundary
 * Catches runtime errors in surface components and triggers auto-fix via the agent.
 */
import React from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { wsService } from '../../../services/wsService';

const MAX_FIX_ATTEMPTS = 3;

interface Props {
  surfaceId: string;
  componentName: string;
  source: string;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: string | null;
  fixing: boolean;
  fixAttempts: number;
}

export class SurfaceErrorBoundary extends React.Component<Props, State> {
  private _unsub: (() => void) | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, fixing: false, fixAttempts: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error: error.message || String(error) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const errorMessage = `${error.message}\n\nComponent Stack:${info.componentStack || '(unavailable)'}`;
    console.error(`[Surface Runtime Error] ${this.props.componentName}:`, errorMessage);

    if (this.state.fixAttempts < MAX_FIX_ATTEMPTS) {
      this.setState(prev => ({ fixing: true, fixAttempts: prev.fixAttempts + 1 }));
      wsService.sendMessage('surface-auto-fix', {
        surfaceId: this.props.surfaceId,
        componentName: this.props.componentName,
        errorType: 'runtime',
        error: errorMessage,
        source: this.props.source,
        attempt: this.state.fixAttempts + 1
      });
    }
  }

  componentDidMount() {
    this._unsub = wsService.on('surface-updated', (payload: unknown) => {
      const p = payload as { surfaceId: string; component?: { name: string; deleted?: boolean } };
      if (p.surfaceId === this.props.surfaceId && p.component?.name === this.props.componentName && !p.component?.deleted) {
        this.setState({ hasError: false, error: null, fixing: false });
      }
    });
  }

  componentWillUnmount() {
    this._unsub?.();
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.source !== this.props.source && this.state.hasError) {
      this.setState({ hasError: false, error: null, fixing: false });
    }
  }

  private handleRetry = () => {
    this.setState({ fixAttempts: 0, fixing: true });
    wsService.sendMessage('surface-auto-fix', {
      surfaceId: this.props.surfaceId,
      componentName: this.props.componentName,
      errorType: 'runtime',
      error: this.state.error,
      source: this.props.source,
      attempt: 1
    });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="p-4 mb-4 bg-red-500/10 border border-red-500/30 rounded-lg text-sm font-mono whitespace-pre-wrap">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 font-bold text-red-400">
            <AlertTriangle size={14} />
            Runtime Error: {this.props.componentName}
          </div>
          {this.state.fixing && (
            <div className="flex items-center gap-1.5 text-amber-400 text-xs">
              <Loader2 size={12} className="animate-spin" />
              Auto-fixing (attempt {this.state.fixAttempts}/{MAX_FIX_ATTEMPTS})...
            </div>
          )}
          {!this.state.fixing && this.state.fixAttempts >= MAX_FIX_ATTEMPTS && (
            <span className="text-zinc-500 text-xs">Max fix attempts reached</span>
          )}
        </div>
        <div className="text-red-400/80 text-xs max-h-[120px] overflow-y-auto">{this.state.error}</div>
        {!this.state.fixing && (
          <button
            onClick={this.handleRetry}
            className="mt-2 px-3 py-1 text-xs bg-amber-500/20 text-amber-400 rounded hover:bg-amber-500/30 transition-colors"
          >
            Retry Auto-Fix
          </button>
        )}
      </div>
    );
  }
}
