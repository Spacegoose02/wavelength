//! In-app updates from GitHub Releases. The frontend (lib/updates.ts) picks the release and the
//! file; Rust lists releases (GitHub's API wants a User-Agent), downloads the file into
//! `<app cache>/updates`, and on Windows runs the installer or swaps the portable exe.
//! On Android the APK is handed to the system installer by UpdateBridge.kt.
//!
//! Every download is checked before it can be installed: its SHA-256 must match the `digest` GitHub
//! publishes for the release file, and when `update-key.pub` holds a key, the release must also carry a
//! `<file>.sig` made with the matching private key (docs/RELEASING.md "Update signing").

use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_http::reqwest;

const RELEASES_API: &str = "https://api.github.com/repos/Spacegoose02/wavelength/releases?per_page=20";
/// Only files attached to our own releases can be downloaded (and then run).
const DOWNLOAD_PREFIX: &str = "https://github.com/Spacegoose02/wavelength/releases/download/";
const UA: &str = concat!("Wavelength/", env!("CARGO_PKG_VERSION"), " (update check)");
/// Public key for update signatures (`npx tauri signer generate`). Empty: only the SHA-256 is checked.
const UPDATE_KEY: &str = include_str!("../update-key.pub");

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
    releases().await
}

async fn releases() -> Result<serde_json::Value, String> {
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
    // Look the file up in GitHub's own list rather than trusting the page for its checksum
    let list = releases().await?;
    let (sha256, sig_url) = expected(&list, &url)?;
    let signature = match sig_url {
        Some(sig) if !UPDATE_KEY.trim().is_empty() => Some(get_text(&sig).await?),
        _ if !UPDATE_KEY.trim().is_empty() => return Err("this release isn't signed, so it can't be installed".into()),
        _ => None,
    };
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
    let mut hasher = Sha256::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("download interrupted: {e}"))? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        hasher.update(&chunk);
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
    let got = hex(&hasher.finalize());
    if got != sha256 {
        let _ = std::fs::remove_file(&tmp);
        return Err("the downloaded file doesn't match the release's checksum, so it wasn't installed".into());
    }
    if let Some(sig) = signature {
        let bytes = std::fs::read(&tmp).map_err(|e| e.to_string())?;
        if let Err(e) = verify_signature(UPDATE_KEY, &sig, &bytes) {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("the update's signature is wrong ({e}), so it wasn't installed"));
        }
    }
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    let _ = app.emit("update-progress", Progress { received, total: Some(received) });
    Ok(path.to_string_lossy().into_owned())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// For the release file at `url`: its SHA-256 (from the asset's `digest`, "sha256:<hex>") and the
/// download link of its `.sig`, if the release has one.
fn expected(releases: &serde_json::Value, url: &str) -> Result<(String, Option<String>), String> {
    let assets = releases
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|r| r["assets"].as_array())
        .find(|a| a.iter().any(|x| x["browser_download_url"] == url))
        .ok_or("that file isn't in a Wavelength release")?;
    let asset = assets.iter().find(|x| x["browser_download_url"] == url).unwrap();
    let sha = asset["digest"]
        .as_str()
        .and_then(|d| d.strip_prefix("sha256:"))
        .filter(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or("this release has no checksum, so it can't be installed")?
        .to_ascii_lowercase();
    let sig_url = format!("{url}.sig");
    let sig = assets
        .iter()
        .any(|x| x["browser_download_url"] == sig_url.as_str())
        .then_some(sig_url);
    Ok((sha, sig))
}

async fn get_text(url: &str) -> Result<String, String> {
    let resp = reqwest::Client::new()
        .get(url)
        .header("User-Agent", UA)
        .send()
        .await
        .map_err(|e| format!("can't download the signature: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("GitHub returned {} for the signature", resp.status()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

/// `key` and `sig` as `tauri signer` writes them: base64 of minisign's text formats.
fn verify_signature(key: &str, sig: &str, data: &[u8]) -> Result<(), String> {
    let b64 = |s: &str| {
        base64::engine::general_purpose::STANDARD
            .decode(s.trim())
            .map_err(|e| e.to_string())
            .and_then(|b| String::from_utf8(b).map_err(|e| e.to_string()))
    };
    let pk = minisign_verify::PublicKey::decode(&b64(key)?).map_err(|e| e.to_string())?;
    let sig = minisign_verify::Signature::decode(&b64(sig)?).map_err(|e| e.to_string())?;
    pk.verify(data, &sig, false).map_err(|e| e.to_string())
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
    use super::{expected, safe_name, verify_signature};
    #[test]
    fn names() {
        assert_eq!(safe_name("Wavelength_0.10.0_x64-setup.exe").unwrap(), "Wavelength_0.10.0_x64-setup.exe");
        assert!(safe_name("../../evil.exe").is_err());
        assert_eq!(safe_name("a/b\\Wavelength.exe").unwrap(), "abWavelength.exe");
    }

    #[test]
    fn checksums() {
        let url = "https://github.com/Spacegoose02/wavelength/releases/download/v1.0.0/Wavelength.exe";
        let hash = "AB".repeat(32);
        let list = serde_json::json!([{ "assets": [
            { "browser_download_url": url, "digest": format!("sha256:{hash}") },
            { "browser_download_url": format!("{url}.sig") },
        ]}]);
        let (sha, sig) = expected(&list, url).unwrap();
        assert_eq!(sha, hash.to_lowercase());
        assert_eq!(sig.as_deref(), Some(&*format!("{url}.sig")));
        let no_digest = serde_json::json!([{ "assets": [{ "browser_download_url": url }] }]);
        assert!(expected(&no_digest, url).is_err());
        assert!(expected(&list, "https://github.com/Spacegoose02/wavelength/releases/download/v1.0.0/other.exe").is_err());
    }

    #[test]
    fn signatures() {
        // a throwaway key made for this test with `tauri signer generate`
        let key = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEQ3MkI2QTA4NzNDQjUwQUQKUldTdFVNdHpDR29yMXpaM0lwM1hOd2NEMVRhOFFFYmhEeWU1eUs4dGdSRU1tMjFmbkd3Mit0NVUK";
        let sig = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTdFVNdHpDR29yMTMyNEJUVmpFSWpWa2xzMnBPYXJUaC9jRmxMazhoQlJyNERwQ0N4WUhqb01yTDZaVzVDZkdqKy9xVHdZRkkwcjRRTTVad2l1M0xaWkdNbDc3K2hLeVFvPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkzNDAyNzkwCWZpbGU6ZGF0YS5iaW4Kd0V0eVVYbUVBbW1YKzUvR2h4VkZ6WktYemJQY0ZHZW5KTUpNWXdudXR6MTYyWFNvWlZxU3dDcStYNFBzSmhBamZ2UTBsVTh0SWFPT2VvMld2UmFQREE9PQo=";
        assert!(verify_signature(key, sig, b"hello\n").is_ok());
        assert!(verify_signature(key, sig, b"hullo\n").is_err());
    }
}
