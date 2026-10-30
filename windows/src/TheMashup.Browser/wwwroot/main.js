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
  // Empty string means no record; null means storage is unavailable. The prefix
  // distinguishes an existing (even empty/corrupt) value from a missing one.
  readLibrary() {
    try {
      const value = localStorage.getItem('themashup.windows.library');
      return value === null ? '' : `1${value}`;
    } catch { return null; }
  },
  writeLibrary(content) {
    try { localStorage.setItem('themashup.windows.library', content); return true; }
    catch { return false; }
  },
};

// One element per attempt, so delayed browser events from an old source cannot
// be reported as events for its replacement. URLs remain on the preview origin.
const videoHost = document.getElementById('browser-video-host');
let media = null;
let emitMedia = null;
let controlExports = null;
let videoBounds = { x: 0, y: 0, width: 0, height: 0, visible: false };
let mediaVolume = 0.8;
function updateVideoBounds() {
  const show = !!(media && media.dataset.video === 'true' && videoBounds.visible);
  videoHost.style.display = show ? 'block' : 'none';
  if (show) {
    videoHost.style.left = `${videoBounds.x}px`;
    videoHost.style.top = `${videoBounds.y}px`;
    videoHost.style.width = `${videoBounds.width}px`;
    videoHost.style.height = `${videoBounds.height}px`;
  }
}
function signal(element, attempt, kind) {
  if (element !== media || !emitMedia) return;
  const position = Number.isFinite(element.currentTime) ? element.currentTime : 0;
  const duration = Number.isFinite(element.duration) ? element.duration : 0;
  // Avoid re-entering .NET synchronously from a .NET → JS player call.
  queueMicrotask(() => { if (element === media) emitMedia(attempt, kind, position, duration); });
}
function playMedia(element, attempt) {
  const started = element.play();
  if (started && typeof started.catch === 'function') started.catch(error => {
    if (element !== media || error?.name === 'AbortError') return;
    signal(element, attempt, error?.name === 'NotAllowedError' ? 5 : 4);
  });
}
globalThis.themashupMedia = {
  open(url, video, attempt, resumeAt) {
    globalThis.themashupMedia.stop();
    const parsed = new URL(url, globalThis.location.href);
    if (parsed.origin !== globalThis.location.origin || !/^\/api\/playback\/stream\/[A-Za-z0-9_-]{24}$/.test(parsed.pathname) || parsed.search || parsed.hash)
      throw new Error('Invalid same-origin playback URL');
    const element = document.createElement('video');
    element.preload = 'metadata';
    element.playsInline = true;
    element.dataset.video = String(video);
    element.dataset.attempt = String(attempt);
    element.volume = mediaVolume;
    media = element;
    videoHost.append(element);
    updateVideoBounds();
    let seekPending = Math.max(0, resumeAt || 0);
    const seekWhenReady = () => {
      if (element !== media || seekPending <= 0) return;
      try {
        element.currentTime = Number.isFinite(element.duration) ? Math.min(seekPending, Math.max(0, element.duration - 0.05)) : seekPending;
        seekPending = 0;
      } catch { /* retry on canplay */ }
    };
    element.addEventListener('loadedmetadata', seekWhenReady);
    element.addEventListener('canplay', seekWhenReady);
    element.addEventListener('playing', () => signal(element, attempt, 0));
    element.addEventListener('pause', () => signal(element, attempt, 1));
    element.addEventListener('timeupdate', () => signal(element, attempt, 2));
    element.addEventListener('durationchange', () => signal(element, attempt, 2));
    element.addEventListener('ended', () => signal(element, attempt, 3));
    element.addEventListener('error', () => signal(element, attempt, 4));
    element.src = parsed.href;
    element.load();
    playMedia(element, attempt);
  },
  play() { if (media) playMedia(media, Number(media.dataset.attempt || 0)); },
  pause() { media?.pause(); },
  stop() {
    const previous = media;
    media = null;
    if (previous) { previous.pause(); previous.removeAttribute('src'); previous.load(); previous.remove(); }
    updateVideoBounds();
  },
  seek(seconds) { if (media && Number.isFinite(seconds)) { try { media.currentTime = Math.max(0, seconds); } catch { } } },
  volume(value) { mediaVolume = Math.max(0, Math.min(1, value)); if (media) media.volume = mediaVolume; },
  bounds(x, y, width, height, visible) { videoBounds = { x, y, width, height, visible }; updateVideoBounds(); },
  getControlBounds(name) { try { return JSON.parse(controlExports.TheMashup.Browser.BrowserMediaBridge.GetControlBounds(name)); } catch { return null; } },
};

try {
  const runtime = await dotnet.withDiagnosticTracing(false).create();
  const config = runtime.getConfig();
  const exports = await runtime.getAssemblyExports(config.mainAssemblyName);
  emitMedia = exports.TheMashup.Browser.BrowserMediaBridge.OnEvent;
  controlExports = exports;
  await runtime.runMain(config.mainAssemblyName, [globalThis.location.href]);
} catch (error) {
  const splash = document.getElementById('loading-message');
  if (splash) splash.textContent = 'The preview could not start. Check the browser console for details.';
  console.error('TheMashup preview failed to start:', error);
}
