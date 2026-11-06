//! Desktop extras (docs/USER-GUIDE.md "Mini player, tray and hotkeys"): an icon in the tray (or menu bar) with
//! play/pause, next and previous; Ctrl+Alt+Space / → / ← that work from any app; a small always-on-top mini
//! player window; and, if you want it, closing the window keeps the music going in the tray.
//!
//! Playback lives in the main window, so everything here sends the main window a `remote` event with what to do
//! ("toggle", "next", "prev"), and src/lib/desktop.ts does it. The mini player is the same app in a second
//! window that only draws the mini player (src/components/MiniPlayer.tsx).

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);

const KEYS: [(Code, &str); 3] = [(Code::Space, "toggle"), (Code::ArrowRight, "next"), (Code::ArrowLeft, "prev")];

fn shortcut(code: Code) -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), code)
}

fn remote(app: &AppHandle, what: &str) {
    let _ = app.emit_to("main", "remote", what);
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Opens the mini player, or closes it when it's open.
fn toggle_mini(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("mini") {
        return w.close();
    }
    WebviewWindowBuilder::new(app, "mini", WebviewUrl::App("index.html".into()))
        .title("Wavelength mini player")
        .inner_size(360.0, 112.0)
        .min_inner_size(280.0, 112.0)
        .resizable(true)
        .maximizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .build()?;
    Ok(())
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, sc, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            if let Some((_, what)) = KEYS.iter().find(|(code, _)| shortcut(*code) == *sc) {
                remote(app, what);
            }
        })
        .build()
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let play = MenuItem::with_id(app, "toggle", "Play / pause", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Next", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, "prev", "Previous", true, None::<&str>)?;
    let mini = MenuItem::with_id(app, "mini", "Mini player", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show Wavelength", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep = || PredefinedMenuItem::separator(app);
    let menu = Menu::with_items(app, &[&play, &next, &prev, &sep()?, &mini, &show, &sep()?, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Wavelength")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "mini" => {
                let _ = toggle_mini(app);
            }
            "show" => show_main(app),
            "quit" => app.exit(0),
            what => remote(app, what),
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    if let Some(w) = app.get_webview_window("main") {
        let handle = app.clone();
        w.on_window_event(move |e| {
            if let WindowEvent::CloseRequested { api, .. } = e {
                if CLOSE_TO_TRAY.load(Ordering::Relaxed) {
                    api.prevent_close();
                    if let Some(w) = handle.get_webview_window("main") {
                        let _ = w.hide();
                    }
                } else if let Some(mini) = handle.get_webview_window("mini") {
                    // the mini player can't play anything once the main window is gone
                    let _ = mini.close();
                }
            }
        });
    }
    Ok(())
}

/// Turns the Ctrl+Alt hotkeys on or off. Fails when another app already has them.
#[tauri::command]
pub fn hotkeys_set(app: AppHandle, on: bool) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    if on {
        for (code, _) in KEYS {
            gs.register(shortcut(code)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn tray_close_to(on: bool) {
    CLOSE_TO_TRAY.store(on, Ordering::Relaxed);
}

#[tauri::command]
pub fn mini_toggle(app: AppHandle) -> Result<(), String> {
    toggle_mini(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn main_show(app: AppHandle) {
    show_main(&app);
}
