import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor shell config.
 *
 * `androidScheme: 'https'` is required so the WebView is a secure origin: Web Audio, Media Session,
 * service workers and IndexedDB persistence all behave like they do in a real browser.
 * `allowMixedContent` stays OFF — we only ever talk to HTTPS.
 */
const config: CapacitorConfig = {
  appId: 'app.themashup.music',
  appName: 'TheMashup',
  webDir: '../../apps/web/dist',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: '#07070a',
  },
  server: {
    androidScheme: 'https',
    // No remote URL: the app is fully offline-capable and ships its own bundle.
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#07070a',
      showSpinner: false,
    },
  },
};

export default config;
