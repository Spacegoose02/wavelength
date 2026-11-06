mod cast;
#[cfg(desktop)]
mod desktop;
mod discord;
mod hifi;
mod offline;
mod secrets;
mod share;
mod update;
mod ytdlp;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // tray, global hotkeys and the mini player (desktop.rs)
    #[cfg(desktop)]
    let builder = builder.plugin(desktop::plugin());
    builder
        // HTTP from Rust side: bypasses CORS on self-hosted servers (Plex, ABS, deemix, ...)
        .plugin(tauri_plugin_http::init())
        // Inbox notifications from the Hub (src/lib/notify.ts)
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // let the player read downloaded songs; granted with the real resolved path
            // (the config glob alone doesn't match reliably on Windows)
            offline::allow_offline_dir(app.handle());
            update::clean_up(app.handle());
            #[cfg(desktop)]
            desktop::setup(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ytdlp::ytdlp_version, ytdlp::ytdlp_search, ytdlp::ytdlp_download, share::connect_share,
            offline::offline_save, offline::offline_delete, offline::offline_delete_file,
            update::update_target, update::update_releases, update::update_download, update::update_install,
            secrets::secrets_available, secrets::secrets_get, secrets::secrets_set,
            cast::cast_discover, cast::cast_load, cast::cast_command, cast::cast_status, cast::cast_disconnect,
            discord::discord_set, discord::discord_clear,
            hifi::hifi_available, hifi::hifi_load, hifi::hifi_command, hifi::hifi_status,
            #[cfg(desktop)] desktop::hotkeys_set, #[cfg(desktop)] desktop::tray_close_to,
            #[cfg(desktop)] desktop::mini_toggle, #[cfg(desktop)] desktop::main_show])
        .run(tauri::generate_context!())
        .expect("error while running Wavelength");
}
