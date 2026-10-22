# Architecture

Wavelength is a **Tauri 2** app: a React UI running in the system WebView, wrapped in a small Rust
binary. The same codebase builds a Windows desktop app and an Android APK (phone, tablet, TV).

```
┌──────────────────────────────────────────────────────────────────────────┐
│ React UI (src/) — runs in WebView2 (Windows) / Android System WebView    │
│                                                                          │
│  views/ ─▶ store/ (zustand) ─▶ sources/ (MusicSource adapters)           │
│              │                      │                                    │
│              ▼                      ▼                                    │
│        player/engine.ts       lib/http.ts ──────────┐                    │
│        (<audio> + WebAudio)                         │ invoke / plugin    │
├─────────────────────────────────────────────────────┼────────────────────┤
│ Rust shell (src-tauri/src)                          ▼                    │
│  tauri-plugin-http (CORS-free fetch) · ytdlp.rs · share.rs · offline.rs  │
├──────────────────────────────────────────────────────────────────────────┤
│ Android only (src-tauri/gen/android)                                     │
│  MainActivity (insets, permissions) · MediaBridge (MediaSession)          │
│  MediaPlaybackService (foreground "media playback")                      │
└──────────────────────────────────────────────────────────────────────────┘
```

## 1. The UI layer (`src/`)

| Folder | Responsibility |
|---|---|
| `main.tsx` | Boot: enables TV remote navigation and the Android media bridge, renders `<App/>`. |
| `App.tsx` | Layout (sidebar or phone tab bar), keyboard shortcuts, back-button handling, the `View` router switch. |
| `views/` | One file per page. Pages read stores and call source adapters; they don't fetch directly. |
| `components/` | Reusable UI: `PlayerBar` (desktop deck + LCD), `MobileNav` (phone), `NowPlaying`, `Scenes` (Now Playing visualizers), `TrackList` (in `common.tsx`), `AddToPlaylist`, `DownloadButton`, `ReleaseRadar`, `Visualizer`, `ErrorBoundary`. |
| `store/` | Global state (zustand). See §4. |
| `sources/` | Adapters for each backend + chart/radio/download helpers. See [SOURCES.md](SOURCES.md). |
| `player/engine.ts` | The audio engine. See §3. |
| `lib/` | `http.ts` (fetch through Rust), `match.ts` (find "the same song" across servers), `platform.ts` (Android/phone detection), `tvNav.ts` (D-pad), `nativeMedia.ts` (Android media session bridge). |
| `styles.css` | All CSS. Skins are blocks of CSS variables on `:root[data-skin='…']`. |

### Routing

There's no router library. `store/ui.ts` holds a `Route` union (`{ view: 'album', album } | …`) and a
history stack. `go(route)` pushes a browser history entry too, so the **Android back button** and
mouse back button walk back through pages (`App.tsx` listens for `popstate`).

### The source abstraction

`sources/types.ts` defines `MusicSource`. Each adapter (`navidrome.ts`, `plex.ts`,
`audiobookshelf.ts`, `subwave.ts`) implements what its server supports. All optional:

| Method | Used by |
|---|---|
| `test()` | Settings → Test connection |
| `getAlbums / getArtists / getRecentAlbums / getAlbumTracks / getArtistAlbums` | Library, Home, Recently added |
| `search(q)` | Search (fan-out to every source) |
| `getBooks / startBook / syncBook / getPodcasts / getEpisodes` | Audiobooks, Podcasts |
| `getStations` | Radio, SUB/WAVE |
| `getHistory / getRecentlyPlayedAlbums` | History, Release Radar |
| `getFavorites / setFavorite` | Favorites, ♥ buttons |
| `getPlaylists / getPlaylistTracks / createPlaylist / addToPlaylist / removeFromPlaylist / renamePlaylist / deletePlaylist` | Server playlists (two-way sync) |
| `prepare(track)` | **Called right before playback** to refresh tokens/stream URLs or open a listening session. This is why saved playlists keep working months later. |
| `scrobble(track, submission)` | Play counts / "now playing" on Navidrome |
| `rescan()` | Downloads → Rescan library |

`sources/registry.ts` turns a `SourceConfig` into an adapter (cached by config) and owns the
**merge** functions: albums/artists from several servers collapse by a normalised
`artist|title` key (`norm()`), keeping every copy in `refs`. The first source in Settings order wins.

## 2. The Rust layer (`src-tauri/src`)

Small on purpose. The UI does almost everything; Rust only does what a WebView can't.

| File | What it does | Commands |
|---|---|---|
| `lib.rs` | App builder: registers the http plugin, grants the asset-protocol scope for offline files at startup, registers commands. | — |
| `ytdlp.rs` | Runs `yt-dlp` (search + download to a folder, progress events `ytdlp-progress`). Finds `yt-dlp.exe`/`ffmpeg` via winget's folders even when PATH is stale. Desktop only. | `ytdlp_version`, `ytdlp_search`, `ytdlp_download` |
| `share.rs` | Logs into an SMB share (`\\server\share`) with `WNetAddConnection2W` so yt-dlp can write to a NAS; checks the folder is writable. Windows only (no-op elsewhere). | `connect_share` |
| `offline.rs` | Downloads songs/covers into `<app data>/offline/…` for offline playback (temp `.part` file then rename). Deletes them. | `offline_save`, `offline_delete`, `offline_delete_file` |

**Why `tauri-plugin-http`?** Self-hosted servers rarely send CORS headers, and chart sites never do.
`lib/http.ts` routes every request through Rust (no CORS), and falls back to `window.fetch` in a plain
browser (dev preview). The capability file `src-tauri/capabilities/default.json` allows any http(s) URL.

## 3. Playback (`player/engine.ts` + `store/player.ts`)

**Engine.** Two `<audio>` elements:

- `visual` has `crossOrigin="anonymous"` and is routed through Web Audio → an `AnalyserNode` feeds
  the spectrum visualiser.
- `plain` has no CORS. If a host fails CORS, the engine remembers the host and uses `plain` from then
  on (the visualiser falls back to an idle animation). Many radio streams need this.

**Lifecycle** (`loadCurrent` in `store/player.ts`):

1. If the track is **downloaded** (`store/offline.ts`), play the local file via the asset protocol — no network.
2. Else call the source's `prepare(track)` (fresh Navidrome token, Audiobookshelf session, …).
3. `engine.load(url, startAt)`.
4. Scrobble "now playing"; at 50% or 4 min record a play (local history + server scrobble).
5. Audiobooks/podcasts: sync position to Audiobookshelf every 15 s.
6. Radio: poll the station's now-playing endpoint every 15 s (Icecast `status-json.xsl`, SUB/WAVE `/api/now-playing`, …) for the live title and artwork.

**System integration.**
- Desktop: `navigator.mediaSession` (Windows media keys, overlay).
- Android: `lib/nativeMedia.ts` mirrors player state to the native `MediaBridge` (see §5), and receives
  play/pause/next/prev/seek from steering wheels, Bluetooth, the notification and the lock screen via
  `window.__wlMedia(cmd)`.

## 4. State — where things live

All persisted state is **per device** (WebView localStorage). Nothing syncs between devices except
what lives on the servers themselves (server playlists, stars, ABS progress, SUB/WAVE).

| Store / key | Contents | Persisted as |
|---|---|---|
| `store/settings.ts` | Sources (URLs, logins, tokens), saved radio stations, skin, deemix + yt-dlp settings, Discover chart picks (`discoverCharts`) | `tonearm.settings` (versioned; `migrate` handles upgrades) |
| `store/library.ts` | Mixed-source playlists, local play history | `tonearm.library` |
| `store/offline.ts` | Downloaded tracks (path, size), covers, downloaded collections | `tonearm.offline` (files in `<app data>/offline/`) |
| `store/catalog.ts` | Merged albums/artists/books/podcasts loaded at start | memory |
| `store/player.ts` | Queue, index, position, volume, shuffle/repeat, live radio title/art | memory (+ `tonearm.volume`) |
| `store/ui.ts` | Current route, history, overlays | memory |
| `store/serverPlaylists.ts` | Navidrome/Plex playlists | memory |
| `store/downloads.ts` | yt-dlp job progress | memory |
| misc | `tonearm.plexClientId`, `tonearm.releaseRadar` (daily cache), `tonearm.swName` | localStorage |

> ⚠️ **Credentials are stored in plain localStorage.** Fine for a personal device; moving them to the OS
> keychain (e.g. `tauri-plugin-stronghold` / Android Keystore) is on the roadmap.

### Why everything still says "tonearm"

The project started as *Tonearm* and was renamed *Wavelength*. Three things deliberately keep the old name:

- **App identifier `com.tonearm.app`** (tauri.conf.json, Android package). Changing it makes Android/Windows
  treat the app as a different program: updates won't install over the old one and settings are lost.
- **Storage keys `tonearm.*`** — renaming loses everyone's settings.
- **Rust crate `tonearm` / lib `tonearm_lib`** — the Android build loads the library by this name.

Everything user-visible says Wavelength (`productName`, `mainBinaryName`, window title, strings).

## 5. Android specifics (`src-tauri/gen/android`)

Tauri generates this project once; we edit it by hand and commit it.

| File | Why it's customised |
|---|---|
| `app/src/main/AndroidManifest.xml` | Permissions: `ACCESS_LOCAL_NETWORK` (Android 17+ LAN access), `FOREGROUND_SERVICE(_MEDIA_PLAYBACK)`, `POST_NOTIFICATIONS`. Android TV: `leanback`, touchscreen not required, `android:banner`. Registers `MediaPlaybackService` and `MediaButtonReceiver`. `usesCleartextTraffic` (via gradle placeholder) for `http://` LAN servers. |
| `MainActivity.kt` | Edge-to-edge insets (status/nav bars, cutouts) so tablets and car head units don't hide UI; runtime permission requests; attaches `MediaBridge` in `onWebViewCreate`. |
| `MediaBridge.kt` | A `MediaSessionCompat` mirroring the web player. JS → native: `window.WavelengthNative.update(json)`. Native → JS: `window.__wlMedia('next')`. Loads album art for the session/notification. |
| `MediaPlaybackService.kt` | Foreground service type `mediaPlayback` with a MediaStyle notification — keeps audio alive with the screen off and makes Android treat Wavelength as *the* media app. |
| `app/build.gradle.kts` | Release signing from `keystore.properties`; cleartext; `androidx.media` dependency. |
| `app/proguard-wavelength.pro` | Keeps `MediaBridge$Js` methods (called from JavaScript) from being stripped by R8. |
| `res/drawable-xhdpi/tv_banner.png`, `res/values/themes.xml` | TV launcher banner; dark system bars / no white flash. |

## 6. UI conventions

- **Phone layout** is chosen by width (`useIsPhone()`, ≤ 760 px): tab bar + mini player instead of
  sidebar + deck. Tablets and TVs use the desktop layout (with a compact mode for short screens like car units).
- **TV**: `lib/tvNav.ts` turns arrow keys into spatial focus movement on non-touch Android devices;
  `html.tv` adds big focus rings. Hover-only controls also appear on `:focus-within`.
- **Skins**: `data-skin` on `<html>`; each skin overrides the CSS variables (`--bg`, `--panel`, `--accent`,
  `--lcd-*`, `--viz-*`, `--bevel` …) and optionally a few component rules. The list lives in `SKINS`
  (`store/settings.ts`).
