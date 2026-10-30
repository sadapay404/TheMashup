import { dotnet } from './_framework/dotnet.js';

// This store is browser-preview-only. The Windows app uses its own local file.
// Storage may be blocked in private browsing; the C# UI reports failed writes.
globalThis.themashupPreferences = {
  readTheme() {
    try { return localStorage.getItem('themashup.windows.theme'); }
    catch { return null; }
  },
  writeTheme(theme) {
    try { localStorage.setItem('themashup.windows.theme', theme); return true; }
    catch { return false; }
  },
};

try {
  const runtime = await dotnet.withDiagnosticTracing(false).create();
  const config = runtime.getConfig();
  await runtime.runMain(config.mainAssemblyName, [globalThis.location.href]);
} catch (error) {
  const splash = document.getElementById('loading-message');
  if (splash) splash.textContent = 'The preview could not start. Check the browser console for details.';
  console.error('TheMashup preview failed to start:', error);
}
