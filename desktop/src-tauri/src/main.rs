//! TheMashup desktop shell (Tauri v2).
//!
//! Hosts the reused apps/web UI and adds the native bits from the blueprint:
//! system media-key shortcuts (globalShortcut), a tray menu, and — via
//! plugins wired on the JS side — native save dialogs for downloads.
//! Tray/global-shortcut actions are forwarded to the page as `player-action`
//! events ("toggle" | "next" | "prev" | "seek-back" | "seek-fwd").

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, Shortcut, ShortcutEvent, ShortcutState};

const ACTION_EVENT: &str = "player-action";

fn emit_action(app: &tauri::AppHandle, action: &str) {
    if let Err(err) = app.emit(ACTION_EVENT, action) {
        eprintln!("[desktop] failed to emit {action}: {err}");
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn register_media_shortcuts(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    // Windows media keys first; extra combos as a portable fallback.
    let shortcuts = [
        Shortcut::new(None, Code::MediaPlayPause),
        Shortcut::new(None, Code::MediaTrackNext),
        Shortcut::new(None, Code::MediaTrackPrevious),
        Shortcut::new(Some(tauri_plugin_global_shortcut::Modifiers::CONTROL | tauri_plugin_global_shortcut::Modifiers::ALT), Code::KeyP),
        Shortcut::new(Some(tauri_plugin_global_shortcut::Modifiers::CONTROL | tauri_plugin_global_shortcut::Modifiers::ALT), Code::ArrowRight),
        Shortcut::new(Some(tauri_plugin_global_shortcut::Modifiers::CONTROL | tauri_plugin_global_shortcut::Modifiers::ALT), Code::ArrowLeft),
    ];
    for shortcut in shortcuts {
        if let Err(err) = app.global_shortcut().register(shortcut) {
            // Media keys are unavailable on some platforms — combos still work.
            eprintln!("[desktop] shortcut {:?} not registered: {err}", shortcut.key);
        }
    }
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show player", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Play / Pause", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, "prev", "Previous", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Next", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit TheMashup", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &toggle, &prev, &next, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("TheMashup")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "toggle" => emit_action(app, "toggle"),
            "next" => emit_action(app, "next"),
            "prev" => emit_action(app, "prev"),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                let visible = app
                    .get_webview_window("main")
                    .and_then(|w| w.is_visible().ok())
                    .unwrap_or(false);
                if visible {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.hide();
                    }
                } else {
                    show_main_window(app);
                }
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut: &Shortcut, event: ShortcutEvent| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let combo = tauri_plugin_global_shortcut::Modifiers::CONTROL
                        | tauri_plugin_global_shortcut::Modifiers::ALT;
                    let action = match shortcut.key {
                        Code::MediaPlayPause => "toggle",
                        Code::MediaTrackNext => "next",
                        Code::MediaTrackPrevious => "prev",
                        Code::KeyP if shortcut.mods.contains(combo) => "toggle",
                        Code::ArrowRight if shortcut.mods.contains(combo) => "next",
                        Code::ArrowLeft if shortcut.mods.contains(combo) => "prev",
                        _ => return,
                    };
                    emit_action(app, action);
                })
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            build_tray(&handle)?;
            register_media_shortcuts(&handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running TheMashup");
}

fn main() {
    run();
}
