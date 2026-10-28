/**
 * TheMashup background runner (Capacitor Background Runner, headless JS env).
 *
 * Fires `playerHeartbeat` 30 minutes after the app is backgrounded and every
 * 30 minutes thereafter (see capacitor.config.json → plugins.BackgroundRunner).
 *
 * The environment is isolated from the page (no shared localStorage), so this
 * keeps its job small and side-effect free: ensure the local-notification
 * permission state stays fresh so media/download alerts are never silently
 * blocked, then resolve immediately (resolve()/reject() is mandatory or the
 * OS may kill the runner).
 *
 * Playback itself lives in the WebView with the MediaSession API — the OS
 * media notification (lock screen / notification shade) is driven from the
 * page via navigator.mediaSession, not from here.
 */
addEventListener("playerHeartbeat", (resolve, reject) => {
  try {
    if (typeof BackgroundRunner !== "undefined" && BackgroundRunner.requestPermissions) {
      BackgroundRunner.requestPermissions()
        .then(() => resolve())
        .catch(() => resolve());
    } else {
      resolve();
    }
  } catch (err) {
    reject(err);
  }
});
