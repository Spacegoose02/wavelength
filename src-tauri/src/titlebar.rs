//! Paints the window's title bar in the active theme's colours (docs/USER-GUIDE.md "Themes").
//!
//! The title bar stays the real Windows one, so dragging, Snap layouts (hover the maximise button), double-click to
//! maximise, the window menu (Alt+Space) and the minimise / maximise / close buttons all keep working exactly as
//! before; only its colours change. src/lib/titleBar.ts reads the theme's colours and calls `titlebar_paint`
//! whenever the theme changes.
//!
//! - Windows 11: the bar, its text and the 1px window border take the theme's colours (DWM caption colours).
//! - Windows 10: those colours aren't supported, so the bar only turns dark or light to match the theme.
//! - The minimise / maximise / close glyphs follow dark or light on both.
//! - macOS and Linux: dark or light only (the system draws the bar there).

use tauri::{Theme, WebviewWindow};

#[tauri::command]
pub fn titlebar_paint(window: WebviewWindow, caption: [u8; 3], text: [u8; 3], dark: bool) {
    let _ = window.set_theme(Some(if dark { Theme::Dark } else { Theme::Light }));
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        dwm::paint(hwnd.0 as _, caption, text);
    }
    #[cfg(not(windows))]
    let _ = (caption, text);
}

#[cfg(windows)]
mod dwm {
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR, DWMWINDOWATTRIBUTE};

    /// COLORREF is 0x00BBGGRR.
    fn colorref([r, g, b]: [u8; 3]) -> u32 {
        u32::from(r) | (u32::from(g) << 8) | (u32::from(b) << 16)
    }

    fn set(hwnd: HWND, attr: DWMWINDOWATTRIBUTE, color: u32) {
        // fails harmlessly (E_INVALIDARG) before Windows 11 build 22000
        unsafe { DwmSetWindowAttribute(hwnd, attr as u32, &color as *const u32 as *const c_void, std::mem::size_of::<u32>() as u32) };
    }

    pub fn paint(hwnd: HWND, caption: [u8; 3], text: [u8; 3]) {
        set(hwnd, DWMWA_CAPTION_COLOR, colorref(caption));
        set(hwnd, DWMWA_BORDER_COLOR, colorref(caption));
        set(hwnd, DWMWA_TEXT_COLOR, colorref(text));
    }

    #[cfg(test)]
    mod tests {
        #[test]
        fn colorref_is_bgr() {
            assert_eq!(super::colorref([0x12, 0x34, 0x56]), 0x0056_3412);
        }
    }
}
