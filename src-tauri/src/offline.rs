//! Offline library: download songs (and their artwork) into the app's private data folder so
//! albums/playlists play with no connection. The frontend plays them via the asset protocol.

use serde::Serialize;
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_http::reqwest;

#[derive(Serialize)]
pub struct OfflineFile {
    path: String,
    size: u64,
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("offline"))
}

/// Grant the asset protocol read access to the offline folder (called at startup).
pub fn allow_offline_dir(app: &AppHandle) {
    if let Ok(dir) = root(app) {
        let _ = std::fs::create_dir_all(&dir);
        let _ = app.asset_protocol_scope().allow_directory(&dir, true);
    }
}

/// `rel` comes from the frontend (e.g. "tracks/navidrome-abc/tr_123"): keep it inside the
/// offline folder, and build it from components so separators are native on every OS.
fn safe_rel(rel: &str) -> Result<PathBuf, String> {
    let mut p = PathBuf::new();
    for part in rel.split(['/', '\\']).filter(|s| !s.is_empty()) {
        if part == "." || part == ".." {
            return Err("invalid path".into());
        }
        let clean: String = part.chars().map(|c| if c.is_ascii_alphanumeric() || "-_.".contains(c) { c } else { '_' }).collect();
        p.push(clean);
    }
    if p.as_os_str().is_empty() {
        return Err("invalid path".into());
    }
    Ok(p)
}

fn ext_for(content_type: &str, url: &str) -> &'static str {
    let ct = content_type.to_ascii_lowercase();
    match () {
        _ if ct.contains("flac") => "flac",
        _ if ct.contains("ogg") || ct.contains("opus") => "ogg",
        _ if ct.contains("mp4") || ct.contains("m4a") || ct.contains("aac") => "m4a",
        _ if ct.contains("wav") => "wav",
        _ if ct.contains("mpeg") || ct.contains("mp3") => "mp3",
        _ if ct.contains("png") => "png",
        _ if ct.contains("webp") => "webp",
        _ if ct.contains("jpeg") || ct.contains("jpg") || ct.starts_with("image/") => "jpg",
        _ if url.contains(".flac") => "flac",
        _ => "mp3",
    }
}

/// Download `url` to `<app data>/offline/<rel>.<ext>`; returns the absolute path for playback.
#[tauri::command]
pub async fn offline_save(app: AppHandle, url: String, rel: String) -> Result<OfflineFile, String> {
    let rel = safe_rel(&rel)?;
    let mut resp = reqwest::get(&url).await.map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("server returned {}", resp.status()));
    }
    let ct = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let path = root(&app)?.join(&rel).with_extension(ext_for(&ct, &url));
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // write to a temp name first so a dropped connection never leaves a half file "downloaded"
    let tmp = path.with_extension("part");
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut size = 0u64;
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("download interrupted: {e}"))? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        size += chunk.len() as u64;
    }
    drop(file);
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(OfflineFile { path: path.to_string_lossy().into_owned(), size })
}

/// Delete one saved file or a whole folder (an album/playlist) under the offline root.
#[tauri::command]
pub async fn offline_delete(app: AppHandle, rel: String) -> Result<(), String> {
    let base = root(&app)?;
    let p = base.join(safe_rel(&rel)?);
    if !p.starts_with(&base) {
        return Err("invalid path".into());
    }
    if p.is_dir() {
        std::fs::remove_dir_all(&p).map_err(|e| e.to_string())
    } else if p.exists() {
        std::fs::remove_file(&p).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

/// Delete a file by absolute path, only if it lives inside the offline root.
#[tauri::command]
pub async fn offline_delete_file(app: AppHandle, path: String) -> Result<(), String> {
    let base = root(&app)?;
    let p = PathBuf::from(&path);
    if !p.starts_with(&base) {
        return Err("not an offline file".into());
    }
    let _ = std::fs::remove_file(p);
    Ok(())
}
