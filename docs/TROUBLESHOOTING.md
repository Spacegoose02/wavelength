# Troubleshooting

Real problems we've hit, what caused them, and the fix. Search this page for the error text first.

## Development

| Symptom | Cause | Fix |
|---|---|---|
| `tauri dev` crashes: `EBUSY: resource busy or locked, watch '…\target\…\tonearm_lib.dll'` | Vite's file watcher scanned `src-tauri/target` while Rust held a lock | Already fixed: `vite.config.ts` ignores `**/src-tauri/**`. If it returns, check that setting. |
| Blank/black window, or "This page hit an error: X is not defined" right after editing | Hot reload loaded a file mid-edit (e.g. a component used before its import was saved) | **Ctrl+R** / the **Reload app** button. Not a code bug if a fresh load works. |
| `Port 1420 is already in use` | Another `tauri dev` (or a stale Vite) is running | Close it, or find the process on port 1420. |
| `cargo` error: `failed searching for potential workspace … invalid potential workspace manifest C:\code\Cargo.toml` | A stray (empty) `Cargo.toml` in a parent folder | Delete it. Cargo walks up the tree looking for workspaces. |
| Rust build: `link.exe not found` / MSVC errors | Visual Studio C++ Build Tools missing | Install the VCTools workload (see DEVELOPMENT.md). |
| A request works in the app but not in the browser preview | CORS — the browser can't call that server | Expected. Test server features in the app. |

## Android build

| Symptom | Cause | Fix |
|---|---|---|
| `Failed to create a symbolic link from …libtonearm_lib.so` | Windows Developer Mode off | Settings → System → For developers → Developer Mode on |
| Gradle: `java.io.IOException: Unable to establish loopback connection` | Java's Unix-socket pipe fails under an 8.3 short TEMP path (`C:\Users\ABCDEF~1\…`) | Set `TEMP`, `TMP` and `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\gradletmp` (see DEVELOPMENT.md) |
| `sdkmanager --licenses` ignores piped "y" | Newer sdkmanager reads the console directly | Run it interactively, or write the license hash files in `$ANDROID_HOME/licenses/` |
| APK won't install over the old one ("package conflicts") | Signed with a different key, or `versionCode` not higher | Sign with the original `wavelength-release.jks`; bump `version` in `tauri.conf.json` |
| Feature works in debug but not release | R8 stripped something called from JS/reflection | Add a keep rule in `app/proguard-wavelength.pro`; inspect with `apkanalyzer dex packages` |

## Connecting to servers

| Symptom | Cause | Fix |
|---|---|---|
| Android: **"error sending request for url"** on every source; works on another phone | Android 17+ blocks local-network access without `ACCESS_LOCAL_NETWORK`; this also hits HTTPS domains that resolve to a LAN IP (split DNS) | Allow Wavelength's **Nearby devices / Local network** permission. Also check the device's **Private DNS** isn't bypassing your router's DNS. |
| Android: `http://` server unreachable | Cleartext blocked | Already allowed (`usesCleartextTraffic` true in `build.gradle.kts`) — check that wasn't reverted |
| Plex: works then 401s | Token changed / signed out | Copy a new X-Plex-Token |
| Audiobookshelf podcasts won't play | Podcasts need an episode play session (`/play/<episodeId>`) | Handled in `prepare()`; check ABS logs for the session error |
| SUB/WAVE tab: blank or errors | API URL wrong (no `/api` behind Caddy, or controller on `:7701`) | Settings → SUB/WAVE → set "API URL" explicitly; admin tabs need ADMIN_USER/ADMIN_PASS |
| SUB/WAVE: no song time | now-playing has `timestamp` (seconds), not `startedAt` | Handled by `swTrack()`; if SUB/WAVE renames fields, update it there |
| SUB/WAVE: "Too late — already on its way to air" on cancel | The song was already handed to Liquidsoap and is playing | Expected; only songs still in the queue can be cancelled |

## Playback

| Symptom | Cause | Fix |
|---|---|---|
| Visualiser flat / idle animation for one server | That host doesn't send CORS headers, so Web Audio can't read it | Expected fallback (`engine.ts` switches to the plain `<audio>`); audio still plays |
| Downloaded songs won't play (`403` from `asset.localhost`, MediaError 4) | Asset-protocol scope didn't match the offline folder | Fixed by granting the folder at startup (`offline::allow_offline_dir`) and native path separators in `safe_rel` |
| Downloaded songs play for a moment then stop (Android only) | Tauri's asset protocol answers each Range request with at most ~1 MB (`206 Partial Content`), and Android's WebView never asks for the next range of an intercepted response | Fixed (unreleased): on Android, `offlinePlaybackUrl` (`store/offline.ts`) reads the whole file with one non-range request and plays it from a `blob:` URL. Desktop still streams from `asset.localhost`. |
| Equalizer has no effect on one server or radio station | That host doesn't send CORS headers, so the app plays it through the plain `<audio>` element, which bypasses Web Audio | Expected. The EQ panel shows a note while such a stream plays. Enabling CORS on the server (e.g. a reverse-proxy `Access-Control-Allow-Origin` header) makes the EQ and visualiser work on it |
| Radio shows only the station name, no song | The station sends no now-playing page and no ICY title in its stream (common for DJ mix / "sessions" stations); or, in a browser, no Hub is signed in | Sign in to a Hub in the browser. Check the stream: `curl -s -H 'Icy-MetaData: 1' -D - -o /dev/null --max-time 3 <stream>` should list `icy-metaint`; no header means no titles to read |
| Steering wheel / Bluetooth buttons do nothing (Android) | No native media session | Fixed in 0.4.1 (`MediaBridge.kt`). If a head unit still ignores it, check its own key-mapping settings and that something has played once (sessions become active on play) |
| Music stops as soon as the screen locks (Android) | Wry pauses the WebView when the activity pauses, and Android tells it the window is hidden; a paused / hidden WebView suspends `<audio>` | Fixed (unreleased): `MainActivity` keeps the WebView awake while a track is loaded (`PlaybackHost`, `onPause`). If it comes back after a Tauri/wry upgrade, check that wry still calls `setContentView(webView)` and that `MainActivity.setContentView` still wraps it |
| Music stops at the end of a song with the screen off, or a few minutes in (Android) | The phone's battery saver froze or killed the app, or the foreground service dropped out between tracks | `MediaPlaybackService` now stays in the foreground through track changes and holds wake + Wi-Fi locks. On Samsung, Xiaomi, Huawei, OnePlus and similar, also set Wavelength's battery use to **Unrestricted** (Settings → Apps → Wavelength → Battery) and remove it from "Sleeping apps" / "Deep sleeping apps"; see [dontkillmyapp.com](https://dontkillmyapp.com). Make sure the playback notification is allowed; swiping it away pauses the music |

## Discover / downloads

| Symptom | Cause | Fix |
|---|---|---|
| Old songs in a genre chart | Source stopped updating (Deezer genre charts, several Billboard genre pages) | Freshness guard drops stale charts; if one slips through, check its date and remove it from `BY_GENRE` |
| A genre shows different charts than expected | It was customised in Settings → Discover (genre chip has a •) | **Reset to defaults** for that genre |
| Deezer artist/album page says "no such artist/album" | Deezer removed or merged the id | Search again; Deezer answers 200 with `{ error }` for dead ids |
| "Skipped: Apple Music timed out / 504" | Apple's RSS service is down | Nothing to do; Mix uses the rest |
| "Skipped: 403 … rss.applemarketingtools.com" | Apple moved the feed to `rss.marketingtools.apple.com`; an older app or Hub refuses the redirect | Update both the app and the Hub |
| A chart shows 0 rows / "layout changed" | Site HTML changed (Billboard, RadioWave scrapers) | Update the parser in `charts.ts`; test against the live page |
| Everything goes to yt-dlp instead of deemix | deemix not logged in (per-session login) | Settings → Downloads → deemix → ARL; **Test deemix** reports whether it's logged in |
| yt-dlp: "ffmpeg not found" | ffmpeg not on PATH for the running app | `ytdlp.rs::find_ffmpeg_dir` checks winget's Packages folder; install with `winget install yt-dlp.FFmpeg` |
| yt-dlp to a NAS share fails | Not logged into the SMB share | Settings → Downloads → yt-dlp → network share username/password → **Test folder** |

## In-app updates

| Symptom | Cause | Fix |
|---|---|---|
| No Updates check in a dev build | `update_target` returns `none` for debug builds, so `npm run tauri dev` never offers updates | Test with a release build (Actions → Test builds) |
| "GitHub returned 403" on Check now | GitHub's API limit (60 requests an hour per IP, shared by everything on that network) | Wait an hour; automatic checks are every 6 hours so they rarely hit it |
| A new release isn't offered | Files not attached yet (Actions takes 15–25 min), it's a pre-release, or the tag isn't plain `vX.Y.Z` | Wait for the builds, tick **Include pre-releases**, or fix the tag |
| Android: "App not installed" after the prompt | APK signed with a different key than the installed app | Only release-signed APKs update; see RELEASING.md → signing |
| Android: button stays on "Allow installs from Wavelength" | **Install unknown apps** not switched on for Wavelength (some TVs hide it) | Turn it on in Android settings → Apps → Special access, or install the APK by hand |
| Portable exe: "can't replace …\\Wavelength.exe" | The exe sits in a folder you can't write to (e.g. Program Files) | Move it to a writable folder, or use the setup exe |
