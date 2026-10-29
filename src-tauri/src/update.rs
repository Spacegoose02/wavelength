//! In-app updates from GitHub Releases. The frontend (lib/updates.ts) picks the release and the
//! file; Rust lists releases (GitHub's API wants a User-Agent), downloads the file into
//! `<app cache>/updates`, and on Windows runs the installer or swaps the portable exe.
//! On Android the APK is handed to the system installer by UpdateBridge.kt.

use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_http::reqwest;

const RELEASES_API: &str = "https://api.github.com/repos/Spacegoose02/wavelength/releases?per_page=20";
/// Only files attached to our own releases can be downloaded (and then run).
const DOWNLOAD_PREFIX: &str = "https://github.com/Spacegoose02/wavelength/releases/download/";
const UA: &str = concat!("Wavelength/", env!("CARGO_PKG_VERSION"), " (update check)");

#[derive(Clone, Serialize)]
struct Progress {
    received: u64,
    total: Option<u64>,
}

fn updates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_cache_dir().map_err(|e| e.to_string())?.join("updates"))
}

/// Keep a release asset's name to a plain file name.
fn safe_name(name: &str) -> Result<String, String> {
    let clean: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || "-_.".contains(*c)).collect();
    if clean.is_empty() || clean.starts_with('.') {
        return Err("invalid file name".into());
    }
    Ok(clean)
}

/// How this copy was installed, so the frontend picks the right file:
/// `installer` (setup exe), `portable` (Wavelength.exe on its own), `android`, or `none` (dev / other OS).
#[tauri::command]
pub fn update_target() -> &'static str {
    if cfg!(target_os = "android") {
        return "android";
    }
    if !cfg!(windows) || cfg!(debug_assertions) {
        return "none";
    }
    // the NSIS installer puts uninstall.exe next to Wavelength.exe; the portable exe runs alone
    let installed = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("uninstall.exe").exists()))
        .unwrap_or(false);
    if installed { "installer" } else { "portable" }
}

/// The repo's recent releases, as GitHub's API returns them (JSON array).
#[tauri::command]
pub async fn update_releases() -> Result<serde_json::Value, String> {
    let resp = reqwest::Client::new()
        .get(RELEASES_API)
        .header("User-Agent", UA)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("can't reach GitHub: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("GitHub returned {}", resp.status()));
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("unexpected reply from GitHub: {e}"))
}

/// Download a release file to `<app cache>/updates/<name>`; emits `update-progress`. Returns the path.
#[tauri::command]
pub async fn update_download(app: AppHandle, url: String, name: String) -> Result<String, String> {
    if !url.starts_with(DOWNLOAD_PREFIX) {
        return Err("not a Wavelength release file".into());
    }
    let dir = updates_dir(&app)?;
    // only ever keep the file being downloaded now
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(safe_name(&name)?);

    let mut resp = reqwest::Client::new()
        .get(&url)
        .header("User-Agent", UA)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("GitHub returned {}", resp.status()));
    }
    let total = resp.content_length();
    let tmp = path.with_extension("part");
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut received = 0u64;
    let mut last_emit = 0u64;
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("download interrupted: {e}"))? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        if received - last_emit > 256 * 1024 {
            last_emit = received;
            let _ = app.emit("update-progress", Progress { received, total });
        }
    }
    drop(file);
    if total.is_some_and(|t| t != received) {
        let _ = std::fs::remove_file(&tmp);
        return Err("download was cut short, try again".into());
    }
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    let _ = app.emit("update-progress", Progress { received, total: Some(received) });
    Ok(path.to_string_lossy().into_owned())
}

/// The downloaded file, if `path` really is one in the updates folder.
fn downloaded(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let dir = updates_dir(app)?.canonicalize().map_err(|e| e.to_string())?;
    let p = Path::new(path).canonicalize().map_err(|_| "the update file is gone, download it again".to_string())?;
    if p.parent() != Some(dir.as_path()) {
        return Err("not a downloaded update".into());
    }
    Ok(p)
}

/// Windows: install the downloaded update and quit. `installer` runs the setup exe in passive mode
/// (progress bar only, closes Wavelength, reopens it when done); `portable` swaps Wavelength.exe in place.
#[tauri::command]
pub fn update_install(app: AppHandle, path: String) -> Result<(), String> {
    let file = downloaded(&app, &path)?;
    match update_target() {
        "installer" => {
            // /P = passive (Tauri's NSIS template), /R = restart the app afterwards
            std::process::Command::new(&file)
                .args(["/P", "/R"])
                .spawn()
                .map_err(|e| format!("couldn't start the installer: {e}"))?;
        }
        "portable" => {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let old = exe.with_extension("exe.old");
            let _ = std::fs::remove_file(&old);
            // Windows lets a running exe be renamed, not overwritten
            std::fs::rename(&exe, &old).map_err(|e| format!("can't replace {}: {e}", exe.display()))?;
            if let Err(e) = std::fs::copy(&file, &exe) {
                let _ = std::fs::rename(&old, &exe);
                return Err(format!("can't write the new Wavelength.exe: {e}"));
            }
            std::process::Command::new(&exe).spawn().map_err(|e| format!("updated, but couldn't restart: {e}"))?;
        }
        _ => return Err("updates are installed by the system on this device".into()),
    }
    app.exit(0);
    Ok(())
}

/// At startup: remove the old portable exe left by the last update, and the downloaded installer.
pub fn clean_up(app: &AppHandle) {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(exe.with_extension("exe.old"));
    }
    if let Ok(dir) = updates_dir(app) {
        let _ = std::fs::remove_dir_all(dir);
    }
}

#[cfg(test)]
mod tests {
    use super::safe_name;
    #[test]
    fn names() {
        assert_eq!(safe_name("Wavelength_0.10.0_x64-setup.exe").unwrap(), "Wavelength_0.10.0_x64-setup.exe");
        assert!(safe_name("../../evil.exe").is_err());
        assert_eq!(safe_name("a/b\\Wavelength.exe").unwrap(), "abWavelength.exe");
    }
}
