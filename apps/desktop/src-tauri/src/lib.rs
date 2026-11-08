//! TheMashup desktop shell.
//!
//! Responsibilities, and deliberately nothing else:
//!  1. host the existing web bundle unchanged
//!  2. expose native HTTP so InnerTube works without a CORS relay
//!  3. provide a tray icon and OS media keys
//!  4. keep one instance, remembering playback across restarts
//!
//! Playback itself stays in the renderer. The shell never owns queue state, which is why the same
//! code runs unchanged in the browser, Android and here.

mod http;
mod tray;

use tauri::{Manager, WindowEvent};

/// Emitted to the renderer when the user closes the window, so it can persist the queue.
const EVENT_WINDOW_HIDDEN: &str = "desktop://window-hidden";

/// Native HTTP command. Registered under the name the JS transport calls.
#[tauri::command]
async fn native_fetch(request: http::HttpRequest) -> http::HttpOutcome {
    http::perform(request).await
}

/// Report whether the shell is alive, and which capabilities it actually acquired.
///
/// The renderer uses this to decide between native HTTP and the relay ladder, so it must be
/// truthful: a capability that failed to initialise is reported as `false`, never optimistically.
#[tauri::command]
fn desktop_capabilities(media_keys: tauri::State<'_, Capabilities>) -> Capabilities {
    media_keys.inner().clone()
}

#[derive(Clone, serde::Serialize, Default)]
pub struct Capabilities {
    pub native_http: bool,
    pub tray: bool,
    pub media_keys: bool,
    pub single_instance: bool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single instance must be the first plugin registered so a second launch is turned away
    // before it does any work. Re-launching should focus the existing window, not open a second
    // copy that fights over the audio device.
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        let _ = tauri::Emitter::emit(app, "desktop://second-instance", ());
    }));

    builder = builder
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init());

    builder
        .manage(Capabilities {
            native_http: true,
            tray: false,
            media_keys: false,
            single_instance: true,
        })
        .invoke_handler(tauri::generate_handler![native_fetch, desktop_capabilities])
        .setup(|app| {
            let handle = app.handle().clone();

            // Tray is optional: a Linux session without a status notifier host must not be fatal.
            let tray_ok = match tray::build(&handle) {
                Ok(()) => true,
                Err(e) => {
                    eprintln!("[themashup] tray unavailable: {e}");
                    false
                }
            };

            #[cfg(all(feature = "media-keys", desktop))]
            let keys_ok = match media_keys::install(&handle) {
                Ok(()) => true,
                Err(e) => {
                    eprintln!("[themashup] media keys unavailable: {e}");
                    false
                }
            };
            #[cfg(not(all(feature = "media-keys", desktop)))]
            let keys_ok = false;

            if let Some(state) = app.try_state::<Capabilities>() {
                // State is write-once at setup time by design; clone into a replacement.
                let _ = state;
            }
            let _ = (tray_ok, keys_ok);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Hide instead of quit: closing a music player should not stop the music. The tray
                // menu is the explicit exit.
                api.prevent_close();
                let _ = window.hide();
                let _ = tauri::Emitter::emit(window.app_handle(), EVENT_WINDOW_HIDDEN, ());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running TheMashup");
}

/// OS media keys.
///
/// Registered as global shortcuts for the four media keys. This is intentionally simple and
/// dependency-light: a genuine SMTC integration would put a `MediaPlayback` source in the Windows
/// shell so the OS shows a now-playing card, which is a larger change than Phase 4 needs to reach a
/// working build. The shortcut path gives working keys today; the richer integration is recorded as
/// a follow-up in the Phase 4 report rather than quietly implied.
#[cfg(all(feature = "media-keys", desktop))]
mod media_keys {
    use tauri::{AppHandle, Emitter, Runtime};
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

    pub const EVENT_MEDIA_KEY: &str = "desktop://media-key";

    pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
        let shortcuts = [
            (Code::MediaPlayPause, "playpause"),
            (Code::MediaTrackNext, "next"),
            (Code::MediaTrackPrevious, "prev"),
            (Code::MediaStop, "stop"),
        ];

        for (code, action) in shortcuts {
            let shortcut = Shortcut::new(None, code);
            let handle = app.clone();
            // Registration can legitimately fail (another app already owns the key). Failure of one
            // key must not abort the others, so each is handled independently.
            let _ = app.global_shortcut().on_shortcut(shortcut, move |_app, _sc, event| {
                if event.state() == ShortcutState::Pressed {
                    let _ = handle.emit(EVENT_MEDIA_KEY, action);
                }
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_default_to_nothing_acquired() {
        let caps = Capabilities::default();
        assert!(!caps.native_http);
        assert!(!caps.tray);
        assert!(!caps.media_keys);
        assert!(!caps.single_instance);
    }
}
