# Architecture

Wavelength is a **Tauri 2** app: a React UI running in the system WebView, wrapped in a small Rust
binary. The same codebase builds a Windows desktop app and an Android APK (phone, tablet, TV).

An optional server, the **Wavelength Hub** (`hub/`, Node + SQLite in Docker), adds accounts, roles and
admin-only controls. It's a control plane only: audio never goes through it. See [HUB.md](HUB.md).

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
| `components/` | Reusable UI: `PlayerBar` (desktop deck + LCD), `MobileNav` (phone), `NowPlaying`, `Scenes` (Now Playing visualizers), `raccoon/` (the SVG raccoon scenes: DJ, country, rapper and rocker, sharing one animation rig and the theme outfits), `Equalizer` (EQ panel + `EqButton` pop-over), `TrackList` (in `common.tsx`), `AddToPlaylist`, `Selection` (Plex-style multi-select on album and artist grids), `DownloadButton`, `ReleaseRadar` (+ `FollowButton`), `Visualizer`, `ErrorBoundary`. |
| `store/` | Global state (zustand). See §4. |
| `sources/` | Adapters for each backend + chart/radio/download helpers. See [SOURCES.md](SOURCES.md). |
| `player/engine.ts` | The audio engine. See §3. |
| `lib/` | `http.ts` (fetch through Rust), `merge.ts` (merge albums or artists by retagging through the Hub), `match.ts` (find "the same song" across servers), `trackLinks.ts` (the library album and artist of a playing song, for Now Playing's links), `platform.ts` (Android/phone detection), `tvNav.ts` (D-pad), `nativeMedia.ts` (Android media session bridge), `seasons.ts` (Seasonal holiday windows, Random daily, `activeSkin`). |
| `styles.css` | All CSS. Skins are blocks of CSS variables on `:root[data-skin='…']`. |

### Routing

There's no router library. `store/ui.ts` holds a `Route` union (`{ view: 'album', album } | …`) and a
history stack. `go(route)` pushes a browser history entry too, so the **Android back button** and
mouse back button walk back through pages (`App.tsx` listens for `popstate`). When Now Playing is open,
`go` reuses the history entry that opening it pushed, so a link out of Now Playing is one Back step from the page
under it.

### The source abstraction

`sources/types.ts` defines `MusicSource`. Each adapter (`navidrome.ts`, `plex.ts`,
`audiobookshelf.ts`, `subwave.ts`) implements what its server supports. All optional:

| Method | Used by |
|---|---|
| `test()` | Settings → Test connection |
| `getAlbums / getArtists / getRecentAlbums / getAlbumTracks / getArtistAlbums` | Library, Home, Recently added |
| `getAppearsOn` (Navidrome) | Artist page → Appears On (`lib/appearsOn.ts`) |
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
| `update.rs` | In-app updates: lists GitHub releases, downloads a release file into `<app cache>/updates` (progress events `update-progress`), runs the Windows installer or swaps the portable exe. See [USER-GUIDE.md](USER-GUIDE.md#updates). | `update_target`, `update_releases`, `update_download`, `update_install` |
| `offline.rs` | Downloads songs/covers into `<app data>/offline/…` for offline playback (temp `.part` file then rename). Deletes them. | `offline_save`, `offline_delete`, `offline_delete_file` |

**Why `tauri-plugin-http`?** Self-hosted servers rarely send CORS headers, and chart sites never do.
`lib/http.ts` routes every request through Rust (no CORS), and falls back to `window.fetch` in a plain
browser (dev preview). The capability file `src-tauri/capabilities/default.json` allows any http(s) URL.

**Content-Security-Policy.** `tauri.conf.json` → `app.security.csp` (and the same policy, minus Tauri's own
schemes, in `hub/src/web.ts` for the browser build). Scripts may only come from the app itself, so text from
the internet (a song title, station name or tag with HTML in it) can never run code and reach the Rust
commands. Pictures, audio and requests may go to any address, because every music server is someone's own.
`devCsp` is off so Vite's hot reload works in `tauri dev`. If a new feature needs another kind of source
(a web font, an iframe, WebAssembly), add it to both policies.

## 3. Playback (`player/engine.ts` + `store/player.ts`)

**Engine.** Three `<audio>` elements:

- Two **decks** have `crossOrigin="anonymous"` and are routed through Web Audio:
  deck → its own `GainNode` (ReplayGain × crossfade) → preamp `GainNode` → 10 `BiquadFilterNode` EQ bands →
  `AnalyserNode` (feeds the spectrum visualiser) → speakers. The EQ (`player/eq.ts` for bands and presets,
  `engine.setEq`) sits before the analyser, so the visualiser shows the equalised sound. When the EQ is off,
  every gain is 0 dB, which leaves the audio unchanged. While one deck plays, the other **preloads** the next
  song (`engine.preload`, started by `prepareAhead` in `store/player.ts` 20 s before the end). When the song
  ends, `engine.load` with that URL just switches decks (gapless); with crossfade on, `engine.crossfade` ramps
  the two deck gains against each other and the store moves to the next song without a reload.
- `plain` has no CORS. If a host fails CORS, the engine remembers the host and uses `plain` from then
  on (the visualiser falls back to an idle animation). Many radio streams need this. Web Audio can't
  read audio from these hosts, so the EQ doesn't affect them either (`engine.eqAvailable()` is false and
  the EQ panel says so), there's no preloading or crossfade, and ReplayGain can only turn them down (through
  the element's volume).

**ReplayGain** (`player/replayGain.ts`): `replayGainFactor` turns a song's tags (`Track.replayGain`, from
OpenSubsonic) and Settings → Playback into a linear gain, capped by the song's peak. `applyLevel` in
`store/player.ts` sets it as each song starts.

**Lifecycle** (`loadCurrent` in `store/player.ts`):

1. If the track is **downloaded** (`store/offline.ts`), play the local file — no network. Desktop streams it
   from the asset protocol; Android loads the whole file into a `blob:` URL first, because the asset protocol
   serves media in ~1 MB ranges that Android's WebView doesn't follow (`offlinePlaybackUrl`).
2. Else call the source's `prepare(track)` (fresh Navidrome token, Audiobookshelf session, …).
3. `engine.load(url, startAt)`.
4. Scrobble "now playing"; at 50% or 4 min record a play (local history + server scrobble).
5. Audiobooks/podcasts: sync position to Audiobookshelf every 15 s.
6. Radio: every 15 s, poll the station's now-playing endpoint (Icecast `status-json.xsl`, SUB/WAVE `/api/now-playing`, …) for the live title and artwork, and when that gives nothing read the ICY title from inside the stream (directly in the apps, through the Hub in a browser; see SOURCES.md → Radio).

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
| `store/settings.ts` | Sources (URLs, logins, tokens), saved radio stations and their order, hidden/ordered server stations (`hiddenStations`, `stationOrder`), skin plus `seasonal`/`randomDaily`, deemix + yt-dlp settings, Discover chart picks (`discoverCharts`), equalizer (`eq`) | `tonearm.settings` (versioned; `migrate` handles upgrades) |
| `store/library.ts` | Mixed-source playlists, local play history | `tonearm.library` |
| `store/offline.ts` | Downloaded tracks (path, size), covers, downloaded collections | `tonearm.offline` (files in `<app data>/offline/`) |
| `store/catalog.ts` | Merged albums/artists/books/podcasts loaded at start | memory |
| `store/player.ts` | Queue, index, position, volume, shuffle/repeat, live radio title/art | memory (+ `tonearm.volume`) |
| `store/ui.ts` | Current route, history, overlays | memory |
| `store/serverPlaylists.ts` | Navidrome/Plex playlists | memory |
| `store/downloads.ts` | yt-dlp job progress | memory |
| `store/hub.ts` | Wavelength Hub address, device token, signed-in profile and permissions | `tonearm.hub` |
| `lib/hubSync.ts` | When each synced setting last changed here, and which are waiting to upload | `tonearm.hubStamps` |
| misc | `tonearm.plexClientId`, `tonearm.releaseRadar` (daily cache), `tonearm.radarMode` (Following / Artists you play), `tonearm.swName` | localStorage |

> **Passwords and tokens** live in the OS keychain on Windows and Android (`src-tauri/src/secrets.rs`,
> `lib/secrets.ts`): Windows Credential Manager and the Android Keystore. In a plain browser they stay in
> localStorage.

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
| `app/src/main/AndroidManifest.xml` | Permissions: `ACCESS_LOCAL_NETWORK` (Android 17+ LAN access), `FOREGROUND_SERVICE(_MEDIA_PLAYBACK)`, `POST_NOTIFICATIONS`, `WAKE_LOCK` (screen-off streaming), `REQUEST_INSTALL_PACKAGES` (in-app updates). Android TV: `leanback`, touchscreen not required, `android:banner`. Registers `MediaPlaybackService` (exported, with the `MediaBrowserService` intent filter, for Android Auto), `MediaButtonReceiver`, `ArtProvider`, `NowPlayingWidget` and the `com.google.android.gms.car.application` entry (`res/xml/automotive_app_desc.xml`). `usesCleartextTraffic` (via gradle placeholder) for `http://` LAN servers. |
| `MainActivity.kt` | Edge-to-edge insets (status/nav bars, cutouts) so tablets and car head units don't hide UI; runtime permission requests; attaches `MediaBridge` and `UpdateBridge` in `onWebViewCreate`. **Background playback:** overrides `setContentView` to wrap wry's WebView in a `PlaybackHost`, and `onPause`. While a track is loaded the WebView is told its window is still visible and is resumed right after wry pauses it, because a paused / hidden WebView suspends the page's `<audio>` (the music used to stop when the screen locked). |
| `UpdateBridge.kt` | In-app updates: `window.WavelengthUpdater.canInstall()` / `allowInstalls()` / `install(path)` hands a downloaded APK (in the cache folder) to the system installer via the `FileProvider`. |
| `MediaBridge.kt` | A `MediaSessionCompat` mirroring the web player. JS → native: `window.WavelengthNative.update(json)`. Native → JS: `window.__wlMedia('next')`. Loads album art for the session/notification. Pauses on `AUDIO_BECOMING_NOISY` (headphones unplugged). Decisions live in `PlaybackPolicy.kt`. For Android Auto: `browse(parent)` asks the page (`window.__wlBrowse` → `WavelengthNative.browseResult`, `src/lib/carBrowse.ts`), play-from-id / search go to the page as `__wlMedia('playId:…')` / `('search:…')`; commands that arrive before the page is listening are held. `openNtfy(url)` opens an `ntfy://` subscribe link. |
| `MediaPlaybackService.kt` | Foreground service type `mediaPlayback` with a MediaStyle notification — keeps audio alive with the screen off and makes Android treat Wavelength as *the* media app. Holds a partial wake lock and a Wi-Fi lock while in the foreground. Stays in the foreground for 60 s after a pause, because the player pauses between every two tracks and Android 12+ won't restart a foreground service from the background. It is also the `MediaBrowserServiceCompat` Android Auto binds to: `onGetRoot` lets only the trusted callers in `CarAccess.kt` browse, `onLoadChildren` / `onSearch` go through `MediaBridge.browse`. |
| `ArtProvider.kt` | `content://com.tonearm.app.art/<n>` cover art for Android Auto (it won't load `http` artwork); only fetches addresses the page listed (`ArtTokens` in `CarAccess.kt`), at most 4 MB, cached in `cacheDir/car-art`. |
| `NowPlayingWidget.kt`, `res/layout/widget_now_playing.xml` | Home-screen widget, updated by `MediaBridge` on song / cover / play-pause changes; its buttons are media-button intents. |
| `PlaybackPolicy.kt` | Plain-Kotlin rules for the above (when to keep the WebView awake, when the service may leave the foreground), unit-tested in `app/src/test` with `CarAccess.kt` (`./gradlew :app:testUniversalDebugUnitTest`, run by `.github/workflows/android.yml`). |
| `app/build.gradle.kts` | Release signing from `keystore.properties`; cleartext; `androidx.media` dependency. |
| `app/proguard-wavelength.pro` | Keeps `MediaBridge$Js` and `UpdateBridge$Js` methods (called from JavaScript) from being stripped by R8. |
| `res/drawable-xhdpi/tv_banner.png`, `res/values/themes.xml` | TV launcher banner; dark system bars / no white flash. |
| `res/drawable/ic_notification.xml` | Small icon for Inbox notifications (tauri-plugin-notification, set per notification in `src/lib/notify.ts`; never under `plugins.notification` in `tauri.conf.json`, which stops the app from starting). |

## 6. UI conventions

- **Phone layout** is chosen by width (`useIsPhone()`, ≤ 760 px): tab bar + mini player instead of
  sidebar + deck. Tablets and TVs use the desktop layout (with a compact mode for short screens like car units).
- **TV**: `lib/tvNav.ts` turns arrow keys into spatial focus movement on non-touch Android devices;
  `html.tv` adds big focus rings. Hover-only controls also appear on `:focus-within`.
- **Skins**: `data-skin` on `<html>`; each skin overrides the CSS variables (`--bg`, `--panel`, `--accent`,
  `--lcd-*`, `--viz-*`, `--bevel` …) and optionally a few component rules. The list lives in `SKINS`
  (`store/settings.ts`), each with a `group` for Settings → Themes. The skin on screen is not always the saved
  one: `App.tsx` shows `useUi.previewSkin` (a hover preview) or else `activeSkin()` from `lib/seasons.ts`,
  which applies Seasonal and Random daily from the device's local date.
