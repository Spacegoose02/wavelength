mod offline;
mod share;
mod ytdlp;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // HTTP from Rust side: bypasses CORS on self-hosted servers (Plex, ABS, deemix, ...)
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            // let the player read downloaded songs; granted with the real resolved path
            // (the config glob alone doesn't match reliably on Windows)
            offline::allow_offline_dir(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ytdlp::ytdlp_version, ytdlp::ytdlp_search, ytdlp::ytdlp_download, share::connect_share,
            offline::offline_save, offline::offline_delete, offline::offline_delete_file])
        .run(tauri::generate_context!())
        .expect("error while running Wavelength");
}
