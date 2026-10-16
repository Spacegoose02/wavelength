# Adding features

Recipes for the common changes. Each lists the exact files to touch, in order. Run `npx tsc` after
every recipe; for anything visual, check desktop, phone width (≤ 760 px) and a light skin (iPod).

## Add a new server type (a "source")

1. **Types** — `src/sources/types.ts`: add the kind to `SourceKind`, `SOURCE_COLORS` and `SOURCE_LABELS`.
2. **Adapter** — `src/sources/<name>.ts`: `export class FooSource implements MusicSource`. Implement
   `test()` plus whichever optional methods the server supports. Map server objects to the shared
   `Track` / `Album` / `Artist` shapes **once**, in private mapper functions (see `navidrome.ts`).
   Use `getJson`/`http` from `lib/http.ts` — never `window.fetch`.
3. **Registry** — `src/sources/registry.ts`: add a `case` in `create()`.
4. **Settings form** — `src/views/Settings.tsx`: add an entry to `HINTS` (example URL, which fields to
   show — `username`, `password`, `token`, … — help text, optional per-kind `labels`).
5. If playback needs a fresh URL or a session, implement `prepare(track)`.

Everything else (Search, Library merge, playlists, favorites) lights up automatically from the
optional methods you implemented.

## Add a chart to Discover

All in `src/sources/charts.ts`:

1. Add an id to the `ChartSource` union and to `CHART_LABELS`, `CHART_SHORT` (1–2 letter badge), `CHART_COLORS`.
2. Write a fetcher returning `Chart { entries, asOf }`. **Call `assertFresh(source, date)`** with the
   date the chart claims — never ship a chart that can't prove it's current.
   - iHeartRadio editorial playlist? Just add `{ myId: '<id from the iheart.com URL>' }` to `IHEART`
     and `myId: iheart('myId')` to `FETCHERS`.
   - Deezer editorial playlist? Add to `DEEZER_PLAYLISTS` and use `deezerPlaylist('myId')`.
3. Register it in `FETCHERS` and list it under genres in `BY_GENRE` (the defaults). It also appears in
   Settings → Discover charts automatically. If it only serves some genres, teach `chartsFor()` that,
   the way Billboard and Apple are handled.
4. Validate against the live site before committing (titles, artists, rank 1, row count, date).

New genre: add to `Genre` and `GENRES`, then give it an entry in `BY_GENRE` (and `APPLE` if Apple's
genre names cover it).

## Add a page

1. `src/store/ui.ts`: add `{ view: 'mypage', …params }` to `Route`.
2. `src/views/MyPage.tsx`: export the component. Wrap the content in `<div className="page">` and use
   `<header className="page-head"><h1>…</h1></header>` for consistent spacing.
3. `src/App.tsx`: add a `case` in `View`, and an entry in `NAV` (sidebar) if it's top-level.
4. Phone: `src/components/MobileNav.tsx` — add it to `LibraryHub` items, and to the Library tab's
   `also` list so the tab stays highlighted.

## Add a skin

1. `src/store/settings.ts`: add the id to `Skin` and a `{ id, label }` to `SKINS`.
2. `src/styles.css`: a `:root[data-skin='myskin'] { … }` block defining at least
   `--bg --bg-2 --panel --panel-2 --line --text --muted --accent --accent-ink --lcd-bg --lcd-text --lcd-dim --viz-low --viz-mid --viz-high --viz-peak --bevel --bevel-in` and `color-scheme`.
3. Optional component overrides (`.btn.primary`, `.nav.on`, `.chip.on`, `.tabs button.on`, `.deck`).
4. A picker preview: `.skin-card.myskin .skin-preview { … }` and its `span`s (three bars).
5. Check: album art keeps its real colours, text contrast on `--panel`, the LCD, phone layout.

## Add a native (Rust) command

1. Write `#[tauri::command] pub async fn my_cmd(…) -> Result<T, String>` in a module under `src-tauri/src/`.
   Long or blocking work goes in `tauri::async_runtime::spawn_blocking`.
2. Register it in `generate_handler![…]` in `lib.rs`.
3. Call from TS with `invoke('my_cmd', { … })` (`@tauri-apps/api/core`), guarded by `isTauri`.
4. Platform-specific code: `#[cfg(windows)]` / `#[cfg(target_os = "android")]` with a no-op fallback.

## Add an Android-native feature

- Kotlin lives in `src-tauri/gen/android/app/src/main/java/com/tonearm/app/`. Attach to the WebView in
  `MainActivity.onWebViewCreate` (that's how `MediaBridge` does it).
- JS ↔ Kotlin: `webView.addJavascriptInterface(obj, "Name")` + `@JavascriptInterface` methods; Kotlin → JS
  with `webView.evaluateJavascript(…)` on the main thread.
- **Add a keep rule** in `app/proguard-wavelength.pro` for anything called only from JS, or R8 strips it in release builds.
- New permissions go in `AndroidManifest.xml`; runtime ones are requested in `MainActivity.requestLocalNetworkAccess()`.
- After building, inspect the APK (`aapt2 dump badging`, `apkanalyzer dex packages`) to confirm.

## Before you open a PR

- `npx tsc` clean; `cargo check` clean if you touched Rust.
- Tried it in the app (`npm run tauri dev`), not just the browser preview.
- Nothing personal in code, comments, screenshots or test data (server URLs, tokens, names).
- Updated the docs page that describes what you changed, and `CHANGELOG.md`.
