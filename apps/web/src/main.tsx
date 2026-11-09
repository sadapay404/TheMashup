/**
 * Boot. Ring 4 of the reliability model: a boot guard wraps everything, and an unhandledrejection
 * listener keeps a stray async error from silently killing a feature.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Boundary } from './components/shell/Boundary';
import { nativeBootMark } from './lib/native';
import './styles.css';

// First line of the web half of the boot log. If the native log ends before this, the page never got
// as far as executing its entry module, which is a different problem from the app crashing later.
nativeBootMark('module loaded');

// Global safety net: log, never rethrow.
window.addEventListener('unhandledrejection', (e) => {
  try {
    const key = 'mashup.diagnostics';
    const prev = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown[];
    prev.unshift({
      at: Date.now(),
      scope: 'unhandledrejection',
      message: String((e.reason as { message?: string } | undefined)?.message ?? e.reason),
    });
    localStorage.setItem(key, JSON.stringify(prev.slice(0, 200)));
  } catch {
    /* ignore */
  }
  e.preventDefault();
});

// Tell the boot sentinel in index.html that the bundle loaded and React is about to paint, so it
// stops waiting. Declared by that inline script; absent in tests and in any non-HTML host.
const booted = (window as unknown as { __mashupBooted?: () => void }).__mashupBooted;

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <Boundary
        scope="App"
        fallback={(reset, message) => (
          <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="text-2xl font-semibold">TheMashup couldn't start</div>
            <p className="text-sm text-[var(--color-text-2)]">{message}</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={reset}
                className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--on-accent)]"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => {
                  localStorage.clear();
                  location.reload();
                }}
                className="rounded-full bg-[color-mix(in_oklab,var(--wash)_11%,transparent)] px-5 py-2.5 text-sm font-semibold"
              >
                Reset local data
              </button>
            </div>
          </div>
        )}
      >
        <App />
      </Boundary>
    </StrictMode>,
  );
  // Armed only after a successful render call: if createRoot threw above, the sentinel still owns
  // the screen and will report the failure.
  booted?.();
  nativeBootMark('react rendered');
}
