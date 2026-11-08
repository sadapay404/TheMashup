//! System tray.
//!
//! Behaviour chosen for a music app specifically:
//!  - closing the window hides it instead of quitting, because a music player that exits when you
//!    dismiss it is a bug, not a feature
//!  - the tray is the only way to actually quit, which makes the intent explicit
//!  - every menu action is emitted to the renderer as an event, so the web UI stays the single
//!    transport authority rather than duplicating play/pause logic in Rust

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const EVENT_TRAY_ACTION: &str = "desktop://tray-action";

/// Build and attach the tray icon. Returns the tray for later removal.
///
/// All failures are returned rather than panicking: a desktop without a system tray (some Linux
/// configurations) should still run with a normal window.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show TheMashup", true, None::<&str>)?;
    let play = MenuItem::with_id(app, "toggle-play", "Play / Pause", true, Some("MediaPlayPause"))?;
    let next = MenuItem::with_id(app, "next", "Next track", true, Some("MediaNext"))?;
    let prev = MenuItem::with_id(app, "prev", "Previous track", true, Some("MediaPrev"))?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &play, &next, &prev, &separator, &quit])?;

    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().cloned().unwrap_or_else(placeholder_icon))
        .tooltip("TheMashup")
        .menu(&menu)
        // Left-click shows/hides; the menu stays on right-click, which is what users expect on
        // Windows while remaining sane on Linux.
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    match event.id.as_ref() {
        "show" => reveal(app),
        "quit" => {
            // `exit` runs RunEvent::ExitRequested, which flushes any pending state.
            app.exit(0);
        }
        // Transport actions are forwarded, never executed here: the web queue is the only thing
        // that knows what "next" means (shuffle, repeat, radio continuation).
        "toggle-play" => emit_action(app, "toggle-play"),
        "next" => emit_action(app, "next"),
        "prev" => emit_action(app, "prev"),
        _ => {}
    }
}

fn emit_action<R: Runtime>(app: &AppHandle<R>, action: &str) {
    // A closed window means nothing is listening; silently ignoring is correct and avoids an error
    // dialog for a keystroke the user cannot act on.
    let _ = app.emit(EVENT_TRAY_ACTION, action);
}

/// Show and focus the main window, recreating it if the user closed it while the app kept running.
fn reveal<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// A 1×1 transparent fallback so a missing icon cannot abort startup.
fn placeholder_icon() -> tauri::image::Image<'static> {
    const TRANSPARENT_PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
        0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];
    tauri::image::Image::from_bytes(TRANSPARENT_PNG)
        .unwrap_or_else(|_| tauri::image::Image::new_owned(vec![0, 0, 0, 0], 1, 1))
}
