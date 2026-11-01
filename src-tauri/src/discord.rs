//! Discord status ("Listening to …"): Discord's local RPC, the same pipe or socket the desktop Discord app
//! opens for games and players. Frames are a little-endian opcode and length, then JSON. Nothing goes over the
//! network from here; Discord shows the activity to your friends. Needs a Discord Application ID (its name is
//! what Discord shows), which the person makes in Discord's developer portal and pastes into Settings.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::sync::Mutex;

#[cfg(unix)]
type Pipe = std::os::unix::net::UnixStream;
#[cfg(windows)]
type Pipe = std::fs::File;

struct Conn {
    client_id: String,
    pipe: Pipe,
}

static CONN: Mutex<Option<Conn>> = Mutex::new(None);

const HANDSHAKE: u32 = 0;
const FRAME: u32 = 1;
const CLOSE: u32 = 2;

fn encode(op: u32, body: &Value) -> Vec<u8> {
    let data = body.to_string().into_bytes();
    let mut out = Vec::with_capacity(8 + data.len());
    out.extend_from_slice(&op.to_le_bytes());
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(&data);
    out
}

fn read_frame(p: &mut Pipe) -> Result<(u32, Value), String> {
    let mut head = [0u8; 8];
    p.read_exact(&mut head).map_err(|e| e.to_string())?;
    let op = u32::from_le_bytes(head[0..4].try_into().unwrap());
    let len = u32::from_le_bytes(head[4..8].try_into().unwrap()) as usize;
    if len > 1 << 20 {
        return Err("Discord sent too much".into());
    }
    let mut buf = vec![0u8; len];
    p.read_exact(&mut buf).map_err(|e| e.to_string())?;
    Ok((op, serde_json::from_slice(&buf).unwrap_or(Value::Null)))
}

#[cfg(unix)]
fn candidates() -> Vec<std::path::PathBuf> {
    let mut dirs: Vec<std::path::PathBuf> = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"]
        .iter()
        .filter_map(|k| std::env::var_os(k).map(Into::into))
        .collect();
    dirs.push("/tmp".into());
    let mut out = vec![];
    for d in dirs {
        // the plain app, then the Flatpak and Snap builds
        for sub in ["", "app/com.discordapp.Discord", "snap.discord", ".flatpak/dev.vencord.Vesktop/xdg-run"] {
            for i in 0..10 {
                out.push(d.join(sub).join(format!("discord-ipc-{i}")));
            }
        }
    }
    out
}

fn open() -> Option<Pipe> {
    #[cfg(unix)]
    {
        for path in candidates() {
            if let Ok(s) = std::os::unix::net::UnixStream::connect(&path) {
                let _ = s.set_read_timeout(Some(std::time::Duration::from_secs(3)));
                return Some(s);
            }
        }
        None
    }
    #[cfg(windows)]
    {
        (0..10).find_map(|i| std::fs::OpenOptions::new().read(true).write(true).open(format!(r"\\?\pipe\discord-ipc-{i}")).ok())
    }
}

fn connect(client_id: &str) -> Result<Conn, String> {
    let mut pipe = open().ok_or("Discord isn’t running on this computer")?;
    pipe.write_all(&encode(HANDSHAKE, &json!({ "v": 1, "client_id": client_id }))).map_err(|e| e.to_string())?;
    let (op, ready) = read_frame(&mut pipe)?;
    if op == CLOSE || ready.get("evt").and_then(Value::as_str) == Some("ERROR") {
        let why = ready.get("message").and_then(Value::as_str).unwrap_or("Discord refused the Application ID");
        return Err(why.to_string());
    }
    Ok(Conn { client_id: client_id.to_string(), pipe })
}

fn send(activity: Value, client_id: &str) -> Result<(), String> {
    let mut g = CONN.lock().map_err(|_| "busy")?;
    if g.as_ref().is_some_and(|c| c.client_id != client_id) {
        *g = None;
    }
    // one retry: Discord restarted since the last song
    for attempt in 0..2 {
        if g.is_none() {
            *g = Some(connect(client_id)?);
        }
        let c = g.as_mut().unwrap();
        let nonce = format!("{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        let body = json!({ "cmd": "SET_ACTIVITY", "args": { "pid": std::process::id(), "activity": activity }, "nonce": nonce });
        let ok = c.pipe.write_all(&encode(FRAME, &body)).is_ok() && read_frame(&mut c.pipe).map(|(op, _)| op != CLOSE).unwrap_or(false);
        if ok {
            return Ok(());
        }
        *g = None;
        if attempt == 1 {
            return Err("Lost the connection to Discord".into());
        }
    }
    Ok(())
}

/// Show what's playing. `activity` is Discord's activity object (type 2 = "Listening to"), built in lib/discord.ts.
#[tauri::command]
pub async fn discord_set(client_id: String, activity: Value) -> Result<(), String> {
    if client_id.is_empty() || client_id.len() > 32 || !client_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("The Discord Application ID is a long number".into());
    }
    tauri::async_runtime::spawn_blocking(move || send(activity, &client_id)).await.map_err(|e| e.to_string())?
}

/// Clear the status (paused, stopped, or switched off).
#[tauri::command]
pub async fn discord_clear() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let id = CONN.lock().ok().and_then(|g| g.as_ref().map(|c| c.client_id.clone()));
        if let Some(id) = id {
            let _ = send(Value::Null, &id);
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_are_little_endian_op_and_length() {
        let f = encode(FRAME, &json!({ "a": 1 }));
        assert_eq!(&f[0..4], &[1, 0, 0, 0]);
        assert_eq!(&f[4..8], &[7, 0, 0, 0]);
        assert_eq!(&f[8..], br#"{"a":1}"#);
    }

    #[cfg(unix)]
    #[test]
    fn talks_to_a_fake_discord() {
        use std::os::unix::net::UnixListener;
        let dir = std::env::temp_dir().join(format!("wl-discord-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("discord-ipc-0");
        let _ = std::fs::remove_file(&path);
        let listener = UnixListener::bind(&path).unwrap();
        let server = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let (op, hello) = read_frame(&mut s).unwrap();
            assert_eq!(op, HANDSHAKE);
            assert_eq!(hello["client_id"], "123456");
            s.write_all(&encode(FRAME, &json!({ "evt": "READY" }))).unwrap();
            let (_, set) = read_frame(&mut s).unwrap();
            s.write_all(&encode(FRAME, &json!({ "evt": null, "nonce": set["nonce"] }))).unwrap();
            set
        });
        std::env::set_var("XDG_RUNTIME_DIR", &dir);
        send(json!({ "type": 2, "details": "Dreams" }), "123456").unwrap();
        let set = server.join().unwrap();
        assert_eq!(set["cmd"], "SET_ACTIVITY");
        assert_eq!(set["args"]["activity"]["details"], "Dreams");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
