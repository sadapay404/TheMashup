import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Top-level crash containment — the app must never show a blank screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[TheMashup] render error", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-bg p-8 text-center">
        <div className="text-5xl">🎧</div>
        <h1 className="font-display text-2xl font-bold text-ink">Something went sideways</h1>
        <p className="max-w-md text-sm text-dim">
          The player hit an unexpected error — your queue is safe. Reloading usually fixes it.
        </p>
        <pre className="max-w-lg overflow-x-auto rounded-lg bg-surface px-4 py-3 text-left text-xs text-faint">
          {this.state.error.message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-contrast transition hover:brightness-110 active:scale-[0.98]"
        >
          Reload TheMashup
        </button>
      </div>
    );
  }
}
