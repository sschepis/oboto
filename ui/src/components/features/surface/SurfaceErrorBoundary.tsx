/**
 * Surface Error Boundary
 * Catches runtime errors in surface components and shows a "Fix…" button
 * so the user can manually trigger agent-driven repair.
 */
import React from 'react';
import { Loader2, AlertTriangle, Wrench } from 'lucide-react';
import { wsService } from '../../../services/wsService';

const MAX_FIX_ATTEMPTS = 3;
const FIX_TIMEOUT_MS = 30_000; // Fallback timeout if server never responds

interface Props {
  surfaceId: string;
  componentName: string;
  source: string;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: string | null;
  detailedError: string | null;
  fixing: boolean;
  fixAttempts: number;
}

export class SurfaceErrorBoundary extends React.Component<Props, State> {
  private _unsubUpdated: (() => void) | null = null;
  private _unsubFailed: (() => void) | null = null;
  private _fixTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, detailedError: null, fixing: false, fixAttempts: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error: error.message || String(error) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const errorMessage = `${error.message}\n\nComponent Stack:${info.componentStack || '(unavailable)'}`;
    console.error(`[Surface Runtime Error] ${this.props.componentName}:`, errorMessage);
    // Store the detailed error (with component stack) so handleFix can send it to the agent.
    this.setState({ detailedError: errorMessage });
  }

  componentDidMount() {
    // Listen for successful updates to clear the error state
    this._unsubUpdated = wsService.on('surface-updated', (payload: unknown) => {
      const p = payload as { surfaceId: string; component?: { name: string; deleted?: boolean } };
      if (p.surfaceId === this.props.surfaceId && p.component?.name === this.props.componentName && !p.component?.deleted) {
        this._clearFixTimeout();
        this.setState({ hasError: false, error: null, detailedError: null, fixing: false, fixAttempts: 0 });
      }
    });
    // Listen for fix failure to stop the spinner
    this._unsubFailed = wsService.on('surface-auto-fix-failed', (payload: unknown) => {
      const p = payload as { surfaceId: string; componentName: string };
      if (p.surfaceId === this.props.surfaceId && p.componentName === this.props.componentName) {
        this._clearFixTimeout();
        this.setState({ fixing: false });
      }
    });
  }

  componentWillUnmount() {
    this._unsubUpdated?.();
    this._unsubFailed?.();
    this._clearFixTimeout();
  }

  private _clearFixTimeout() {
    if (this._fixTimeout) {
      clearTimeout(this._fixTimeout);
      this._fixTimeout = null;
    }
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.source !== this.props.source && this.state.hasError) {
      this.setState({ hasError: false, error: null, detailedError: null, fixing: false, fixAttempts: 0 });
    }
  }

  private handleFix = () => {
    const attempt = this.state.fixAttempts + 1;
    this.setState({ fixing: true, fixAttempts: attempt });
    // Fallback: if server never responds, stop the spinner after FIX_TIMEOUT_MS
    this._clearFixTimeout();
    this._fixTimeout = setTimeout(() => this.setState({ fixing: false }), FIX_TIMEOUT_MS);
    wsService.sendMessage('surface-auto-fix', {
      surfaceId: this.props.surfaceId,
      componentName: this.props.componentName,
      errorType: 'runtime',
      error: this.state.detailedError || this.state.error,
      source: this.props.source,
      attempt
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
              Fixing (attempt {this.state.fixAttempts}/{MAX_FIX_ATTEMPTS})…
            </div>
          )}
        </div>
        <div className="text-red-400/80 text-xs max-h-[120px] overflow-y-auto">{this.state.error}</div>
        {!this.state.fixing && (
          <button
            onClick={this.handleFix}
            disabled={this.state.fixAttempts >= MAX_FIX_ATTEMPTS}
            className="mt-2 px-3 py-1 text-xs bg-amber-500/20 text-amber-400 rounded hover:bg-amber-500/30 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Wrench size={12} />
            {this.state.fixAttempts >= MAX_FIX_ATTEMPTS ? 'Max fix attempts reached' : 'Fix…'}
          </button>
        )}
      </div>
    );
  }
}
