//! Log in to an SMB share (\\server\share) so yt-dlp can write into the NAS music folder.
//! Uses WNetAddConnection2W — the same thing as `net use`, without putting the password
//! on a command line.

use std::path::Path;

/// `\\server\share\Music\yt-dlp` → `\\server\share`
fn share_root(path: &str) -> Option<String> {
    let rest = path.strip_prefix(r"\\").or_else(|| path.strip_prefix("//"))?;
    let mut parts = rest.split(['\\', '/']).filter(|p| !p.is_empty());
    Some(format!(r"\\{}\{}", parts.next()?, parts.next()?))
}

#[cfg(windows)]
fn connect(root: &str, user: &str, pass: &str) -> Result<(), String> {
    use windows_sys::Win32::NetworkManagement::WNet::{WNetAddConnection2W, NETRESOURCEW, RESOURCETYPE_DISK};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let mut remote = wide(root);
    let user_w = wide(user);
    let pass_w = wide(pass);
    let mut res: NETRESOURCEW = unsafe { std::mem::zeroed() };
    res.dwType = RESOURCETYPE_DISK;
    res.lpRemoteName = remote.as_mut_ptr();
    let code = unsafe { WNetAddConnection2W(&res, pass_w.as_ptr(), user_w.as_ptr(), 0) };
    match code {
        0 => Ok(()),
        // already connected (possibly with the same or other saved credentials) — usable as is
        85 | 1219 => Ok(()),
        86 | 1326 => Err("the share rejected that username/password".into()),
        53 | 67 => Err(format!("can't reach {root} — check the server name and share")),
        other => Err(format!("Windows error {other} connecting to {root}")),
    }
}

#[cfg(not(windows))]
fn connect(_root: &str, _user: &str, _pass: &str) -> Result<(), String> {
    Ok(())
}

/// Connect (if credentials are given) and confirm the folder is writable.
#[tauri::command]
pub async fn connect_share(path: String, user: Option<String>, pass: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = path.trim().to_string();
        if path.is_empty() {
            return Err("no folder set".into());
        }
        let mut note = String::new();
        if let (Some(root), Some(user)) = (share_root(&path), user.filter(|u| !u.trim().is_empty())) {
            connect(&root, user.trim(), pass.as_deref().unwrap_or(""))?;
            note = format!("logged in to {root}, ");
        }
        let dir = Path::new(&path);
        std::fs::create_dir_all(dir).map_err(|e| format!("can't create {path}: {e}"))?;
        let probe = dir.join(".tonearm-write-test");
        std::fs::write(&probe, b"ok").map_err(|e| format!("folder isn't writable: {e}"))?;
        let _ = std::fs::remove_file(&probe);
        Ok(format!("{note}folder is writable"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::share_root;
    #[test]
    fn roots() {
        assert_eq!(share_root(r"\\nas\music\yt-dlp").as_deref(), Some(r"\\nas\music"));
        assert_eq!(share_root(r"\\nas\music").as_deref(), Some(r"\\nas\music"));
        assert_eq!(share_root(r"D:\Music"), None);
    }
}
