//! yt-dlp bridge: search and download audio from YouTube / SoundCloud / Bandcamp / etc.
//! as a fallback for anything deemix can't find.

use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Custom path → winget's Links folder (works even if PATH is stale) → PATH.
/// A custom path has to be an existing file named like yt-dlp (`yt-dlp.exe`, `yt-dlp_x86.exe`, …), so
/// the page can't use these commands to start some other program.
fn find_exe(name: &str, custom: Option<&str>) -> Result<PathBuf, String> {
    if let Some(c) = custom.map(str::trim).filter(|c| !c.is_empty()) {
        let p = PathBuf::from(c);
        let named = p.file_name().is_some_and(|f| f.to_string_lossy().to_ascii_lowercase().starts_with(name));
        if !named || !p.is_file() {
            return Err(format!("{c} isn't a {name} program"));
        }
        return Ok(p);
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let p = PathBuf::from(local).join("Microsoft").join("WinGet").join("Links").join(format!("{name}.exe"));
        if p.exists() {
            return Ok(p);
        }
    }
    Ok(PathBuf::from(name))
}

/// Only web links go to yt-dlp, so nothing the page sends can be read as one of its options.
fn web_link(url: &str) -> Result<&str, String> {
    let u = url.trim();
    if u.starts_with("https://") || u.starts_with("http://") {
        Ok(u)
    } else {
        Err("yt-dlp only takes http(s) links".into())
    }
}

/// yt-dlp's `--audio-format` values.
fn audio_format(f: &str) -> Result<&str, String> {
    const OK: [&str; 9] = ["best", "aac", "alac", "flac", "m4a", "mp3", "opus", "vorbis", "wav"];
    OK.contains(&f).then_some(f).ok_or_else(|| format!("unknown audio format {f}"))
}

/// ffmpeg's folder: PATH first, then winget's package dir (`yt-dlp.FFmpeg` / `Gyan.FFmpeg`
/// install there and only reach PATH in freshly started processes).
fn find_ffmpeg_dir() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            if dir.join("ffmpeg.exe").exists() || dir.join("ffmpeg").is_file() {
                return Some(dir);
            }
        }
    }
    let packages = PathBuf::from(std::env::var("LOCALAPPDATA").ok()?).join("Microsoft").join("WinGet").join("Packages");
    for pkg in std::fs::read_dir(packages).ok()?.flatten() {
        if !pkg.file_name().to_string_lossy().to_lowercase().contains("ffmpeg") {
            continue;
        }
        for inner in std::fs::read_dir(pkg.path()).ok()?.flatten() {
            let bin = inner.path().join("bin");
            if bin.join("ffmpeg.exe").exists() {
                return Some(bin);
            }
        }
    }
    None
}

fn command(exe: &PathBuf) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(exe);
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ytdlp_version(bin: Option<String>) -> Result<String, String> {
    let exe = find_exe("yt-dlp", bin.as_deref())?;
    blocking(move || {
        let out = command(&exe).arg("--version").output().map_err(|e| format!("yt-dlp not found ({e})"))?;
        Ok(format!("yt-dlp {}", String::from_utf8_lossy(&out.stdout).trim()))
    })
    .await
}

/// Returns yt-dlp's JSON (flat playlist) for a search term or any supported URL.
#[tauri::command]
pub async fn ytdlp_search(query: String, bin: Option<String>) -> Result<String, String> {
    let exe = find_exe("yt-dlp", bin.as_deref())?;
    let target = match web_link(&query) {
        Ok(u) => u.to_string(),
        Err(_) => format!("ytsearch25:{query}"),
    };
    blocking(move || {
        let out = command(&exe)
            .args(["-J", "--flat-playlist", "--no-warnings", "--", &target])
            .output()
            .map_err(|e| format!("yt-dlp not found ({e})"))?;
        if !out.status.success() {
            return Err(last_line(&String::from_utf8_lossy(&out.stderr)));
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    })
    .await
}

#[derive(Clone, Serialize)]
struct Progress {
    id: String,
    status: &'static str,
    percent: Option<f32>,
    message: Option<String>,
}

#[tauri::command]
pub async fn ytdlp_download(
    app: AppHandle,
    id: String,
    url: String,
    out_dir: String,
    format: String,
    bin: Option<String>,
) -> Result<(), String> {
    let exe = find_exe("yt-dlp", bin.as_deref())?;
    let url = web_link(&url)?.to_string();
    let format = audio_format(&format)?.to_string();
    let ffmpeg = find_ffmpeg_dir();
    blocking(move || {
        let emit = |status: &'static str, percent: Option<f32>, message: Option<String>| {
            let _ = app.emit("ytdlp-progress", Progress { id: id.clone(), status, percent, message });
        };
        // Artist/Album/Title layout so Navidrome files it like everything else.
        let template = format!(
            "{}/%(artist,creator,uploader)s/%(album|Singles)s/%(title)s.%(ext)s",
            out_dir.trim_end_matches(['/', '\\'])
        );
        let mut cmd = command(&exe);
        cmd.args([
            "-x", "--audio-format", &format, "--audio-quality", "0",
            "--embed-metadata", "--embed-thumbnail", "--convert-thumbnails", "jpg",
            "--newline", "--no-warnings",
            "--progress-template", "download:[tonearm] %(progress._percent_str)s",
            "-o", &template,
        ]);
        if url.contains("watch?v=") {
            cmd.arg("--no-playlist");
        }
        match &ffmpeg {
            Some(dir) => {
                cmd.arg("--ffmpeg-location").arg(dir);
            }
            None => {
                emit("error", None, Some("ffmpeg not found — install with: winget install yt-dlp.FFmpeg".into()));
                return Err("ffmpeg not found".into());
            }
        }
        cmd.arg("--").arg(&url).stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("could not start yt-dlp ({e})"))?;
        let mut stderr = child.stderr.take().unwrap();
        let err_reader = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = stderr.read_to_string(&mut s);
            s
        });
        emit("downloading", Some(0.0), None);
        for line in BufReader::new(child.stdout.take().unwrap()).lines().map_while(Result::ok) {
            if let Some(rest) = line.strip_prefix("[tonearm]") {
                let pct = rest.trim().trim_end_matches('%').trim().parse::<f32>().ok();
                emit("downloading", pct, None);
            } else if line.starts_with("[ExtractAudio]") || line.starts_with("[Metadata]") || line.starts_with("[EmbedThumbnail]") {
                emit("processing", Some(100.0), None);
            }
        }
        let status = child.wait().map_err(|e| e.to_string())?;
        let err = err_reader.join().unwrap_or_default();
        if status.success() {
            emit("done", Some(100.0), None);
            Ok(())
        } else {
            let msg = last_line(&err);
            emit("error", None, Some(msg.clone()));
            Err(msg)
        }
    })
    .await
}

fn last_line(s: &str) -> String {
    s.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("yt-dlp failed").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::{audio_format, find_exe, web_link};
    #[test]
    fn only_web_links() {
        assert_eq!(web_link(" https://youtu.be/x ").unwrap(), "https://youtu.be/x");
        assert!(web_link("--exec calc").is_err());
        assert!(web_link("file:///etc/passwd").is_err());
    }
    #[test]
    fn formats_and_programs() {
        assert!(audio_format("opus").is_ok());
        assert!(audio_format("--exec").is_err());
        assert!(find_exe("yt-dlp", Some("/bin/sh")).is_err());
        assert!(find_exe("yt-dlp", Some("/nowhere/yt-dlp")).is_err());
        assert_eq!(find_exe("yt-dlp", None).unwrap().file_name().unwrap(), "yt-dlp");
    }
}
