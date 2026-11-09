/**
 * Error boundaries — ring 3 of the reliability model (docs/08 §7).
 * A dead panel must never take down the player or the navigation.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Shown in the fallback so the user knows which part of the app died. */
  scope: string;
  /** Rendered instead of the children on failure. */
  fallback?: (reset: () => void, message: string) => ReactNode;
}

interface State {
  error: Error | null;
  fingerprint: string;
}

function fingerprint(err: Error): string {
  let h = 2166136261;
  const input = `${err.name}:${err.message}`;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 7);
}

export class Boundary extends Component<Props, State> {
  override state: State = { error: null, fingerprint: '' };

  static getDerivedStateFromError(error: Error): State {
    return { error, fingerprint: fingerprint(error) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Diagnostics ring buffer (last 200, PII-free, never sent anywhere).
    try {
      const key = 'mashup.diagnostics';
      const prev = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown[];
      prev.unshift({
        at: Date.now(),
        scope: this.props.scope,
        message: error.message,
        stack: info.componentStack?.slice(0, 1200) ?? '',
      });
      localStorage.setItem(key, JSON.stringify(prev.slice(0, 200)));
    } catch {
      /* storage unavailable — the app still recovers */
    }
    // eslint-disable-next-line no-console
    console.error(`[TheMashup:${this.props.scope}]`, error);
  }

  private reset = (): void => this.setState({ error: null, fingerprint: '' });

  override render(): ReactNode {
    const { error, fingerprint: fp } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset, error.message);
    return (
      <div className="flex flex-col items-start gap-2 rounded-2xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/8 p-4">
        <div className="text-[13px] font-semibold text-[var(--color-danger)]">
          {this.props.scope} hit a problem
        </div>
        <p className="text-[11.5px] leading-relaxed text-[var(--color-text-2)]">
          The rest of the app is still running. Ref <code className="font-[family-name:var(--font-mono)]">{fp}</code>
        </p>
        <button
          type="button"
          onClick={this.reset}
          className="mt-1 rounded-full bg-[color-mix(in_oklab,var(--wash)_11%,transparent)] px-3 py-1.5 text-[11.5px] font-medium"
        >
          Try again
        </button>
      </div>
    );
  }
}
