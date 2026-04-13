import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught error:", error, info);
  }

  handleReset = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-red-loss/30 bg-surface-900/80 p-6 backdrop-blur-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-loss/10 border border-red-loss/20">
              <AlertTriangle className="h-5 w-5 text-red-loss" />
            </div>
            <div>
              <h1 className="text-base font-bold text-surface-100">
                Something went wrong
              </h1>
              <p className="text-xs text-surface-400">
                The dashboard hit an unexpected error
              </p>
            </div>
          </div>

          <div className="mb-4 rounded-lg border border-surface-700/40 bg-surface-950/60 p-3">
            <p className="font-mono text-xs text-red-loss/90 break-all">
              {this.state.error.message || "Unknown error"}
            </p>
          </div>

          <button
            onClick={this.handleReset}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-amber-glow px-4 py-2.5 text-sm font-semibold text-surface-950 transition-colors hover:bg-amber-soft"
          >
            <RefreshCw className="h-4 w-4" />
            Reload dashboard
          </button>
        </div>
      </div>
    );
  }
}
