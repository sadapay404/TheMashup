/**
 * Boot. Ring 4 of the reliability model: a boot guard wraps everything, and an unhandledrejection
 * listener keeps a stray async error from silently killing a feature.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Boundary } from './components/shell/Boundary';
import './styles.css';

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
                className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-black"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => {
                  localStorage.clear();
                  location.reload();
                }}
                className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold"
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
}
