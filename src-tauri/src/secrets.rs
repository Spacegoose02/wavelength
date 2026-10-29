//! Passwords and tokens kept in the OS keychain instead of the app's own storage (src/lib/secrets.ts):
//! Windows Credential Manager, and on Android the Keystore (values encrypted with a key that never leaves
//! it). Elsewhere `secrets_available` says no and the app keeps them where it always did.

use std::collections::HashMap;
use std::sync::OnceLock;

const SERVICE: &str = "Wavelength";

fn ready() -> bool {
    static READY: OnceLock<bool> = OnceLock::new();
    *READY.get_or_init(|| {
        #[cfg(windows)]
        let store = windows_native_keyring_store::Store::new();
        #[cfg(target_os = "android")]
        let store = android_native_keyring_store::Store::new();
        #[cfg(any(windows, target_os = "android"))]
        return match store {
            Ok(s) => {
                keyring_core::set_default_store(s);
                true
            }
            Err(e) => {
                eprintln!("keychain unavailable: {e}");
                false
            }
        };
        #[cfg(not(any(windows, target_os = "android")))]
        false
    })
}

fn entry(key: &str) -> Result<keyring_core::Entry, String> {
    keyring_core::Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn secrets_available() -> bool {
    ready()
}

/// The values kept under these keys; keys with nothing kept are left out.
#[tauri::command(async)]
pub fn secrets_get(keys: Vec<String>) -> Result<HashMap<String, String>, String> {
    if !ready() {
        return Err("no keychain on this device".into());
    }
    let mut out = HashMap::new();
    for key in keys {
        match entry(&key)?.get_password() {
            Ok(v) => {
                out.insert(key, v);
            }
            Err(keyring_core::Error::NoEntry) => {}
            Err(e) => return Err(format!("{key}: {e}")),
        }
    }
    Ok(out)
}

/// Keep these values; `None` (or an empty value) removes the key.
#[tauri::command(async)]
pub fn secrets_set(values: HashMap<String, Option<String>>) -> Result<(), String> {
    if !ready() {
        return Err("no keychain on this device".into());
    }
    for (key, value) in values {
        let e = entry(&key)?;
        match value.filter(|v| !v.is_empty()) {
            Some(v) => e.set_password(&v).map_err(|err| format!("{key}: {err}"))?,
            None => match e.delete_credential() {
                Ok(()) | Err(keyring_core::Error::NoEntry) => {}
                Err(err) => return Err(format!("{key}: {err}")),
            },
        }
    }
    Ok(())
}
