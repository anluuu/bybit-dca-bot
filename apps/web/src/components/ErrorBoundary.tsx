import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

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
    return <FallbackView error={this.state.error} onReset={this.handleReset} />;
  }
}

/**
 * Rendered when the boundary catches. Split out so it can consume the
 * `useTranslation` hook (class components can't).
 */
function FallbackView({
  error,
  onReset,
}: {
  error: Error;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-red-loss/30 bg-surface-900/80 p-6 backdrop-blur-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-loss/10 border border-red-loss/20">
            <AlertTriangle className="h-5 w-5 text-red-loss" />
          </div>
          <div>
            <h1 className="text-base font-bold text-surface-100">
              {t("errors.somethingWentWrong")}
            </h1>
            <p className="text-xs text-surface-400">
              {t("errors.unexpectedError")}
            </p>
          </div>
        </div>

        <div className="mb-4 rounded-lg border border-surface-700/40 bg-surface-950/60 p-3">
          <p className="font-mono text-xs text-red-loss/90 break-all">
            {error.message || t("errors.unknownError")}
          </p>
        </div>

        <button
          onClick={onReset}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-amber-glow px-4 py-2.5 text-sm font-semibold text-surface-950 transition-colors hover:bg-amber-soft"
        >
          <RefreshCw className="h-4 w-4" />
          {t("errors.reload")}
        </button>
      </div>
    </div>
  );
}
