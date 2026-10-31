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
   Settings → Discover automatically. If it only serves some genres, teach `chartsFor()` that,
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

1. `src/store/settings.ts`: add the id to `Skin` and a `{ id, label, group }` to `SKINS`. `group` is one of
   `SKIN_GROUPS` and decides the heading it appears under in Settings → Themes.
2. `src/styles.css`: a `:root[data-skin='myskin'] { … }` block defining at least
   `--bg --bg-2 --panel --panel-2 --line --text --muted --accent --accent-ink --lcd-bg --lcd-text --lcd-dim --viz-low --viz-mid --viz-high --viz-peak --bevel --bevel-in` and `color-scheme`.
3. Optional component overrides (`.btn.primary`, `.nav.on`, `.chip.on`, `.tabs button.on`, `.deck`).
4. A picker preview: `.skin-card.myskin .skin-preview { … }` and its `span`s (three bars).
5. Check: album art keeps its real colours, text contrast on `--panel`, the LCD, phone layout.
6. Put the rules at the top level of `styles.css` (not inside a `@media` block), then check the picker card
   and the skin itself at desktop width as well as phone width. A rule stuck inside the phone media query looks
   fine on Android and does nothing on Windows.

## Add a holiday skin

1. Add the skin as above, with `group: 'Holidays'`.
2. `src/lib/seasons.ts`: add the id to `HolidaySkin` and an entry to `SEASONS` with a `label`, a readable
   `window` and `includes(date)`. Use the `between()` helper for fixed dates; see `thanksgiving()` for a
   holiday that moves. Keep windows from overlapping: the first match wins.
3. Give the critters a hat (optional): a `<g className="hat hat-myhat">` with the other hats in `Head`
   in `components/critters/parts.tsx` (every critter shares it), and
   `:root[data-skin='myholiday'] .critter .hat-myhat { display: inline; }` in the critter rules at the end
   of `styles.css`.
4. Update the window table in the [user guide](USER-GUIDE.md#skins-and-themes).

## Add a Now Playing visualizer

- **Canvas scene** (most of them): write a `Draw` in `components/Scenes.tsx`, add its id to `NpScene`
  (`store/settings.ts`) and to `SCENES` and `DRAW`. It gets bass/mid/treble, beats and the skin colours.
- **SVG or DOM scene** (like the critters): its own component, rendered by `NowPlayingStage` for its id.
  Call `createAudioReader()` from `player/analysis.ts` inside a `requestAnimationFrame` loop and write
  attributes directly instead of setting React state every frame.
- Both must keep moving with no readable audio (paused, or a stream without CORS): the reader gives a calm
  made-up signal with `live: false`.

## Add a critter, an act or an outfit

The critters live in `components/critters/`. A critter on screen is a **species** (raccoon, shark, alien,
grey alien, black or brown bear) playing an **act** (DJ, Country, Rapper, Rocker, Drummer, Theremin, Synth,
Accordion), and any species can play any act. See the [user guide's developer notes](USER-GUIDE.md#critters)
for how the pieces fit.

Everything is drawn on one skeleton so faces, acts, the rig and the outfits all fit together: head centred on
200,178 (about 160 wide, 130 tall, top near y 112 where the hats sit), eyes on y 166, mouth around y 212,
shoulders at 138,268 and 262,268, tail root at 268,292, and `TORSO` for the top.

- **A critter (species):** in `species.tsx`,
  1. Write a `MyFace` component: everything from ears to mouth, with `data-part="eyes"` centred on y 166,
     `data-part="smile"` and `data-part="yawn"` (an open mouth around y 212 to 232, starting
     `transform="scale(1 0)"`; the rig opens it to sing and yawn). Features that stick out (fins,
     antennae) go in the face too; hats are drawn over them.
  2. Optionally a `MyTail` with `data-part="tail"`, rooted at 268,292 (the rig wags it), and a `MyLower` drawn
     instead of every act's trousers and shoes for a critter without legs (the shark's tail end). It needs a
     `data-part="boot"`, which the country act taps.
  3. Fit it, if it isn't the usual round head on the usual body: `build` narrows the body (the aliens are
     0.78 to 0.82), `fit` resizes the shared hats, headphones and hoods (`w`, `lift`) and stretches glasses
     over bigger eyes (`eyes`), and `shadow` is the ellipse the head casts under the chin. Check it in a hat,
     shades and the nuclear hood.
  4. Add an entry to `SPECIES` and its id to `Species` (`store/settings.ts`).
  5. In `styles.css`, `.species-<id> { --skin: …; --skin-dark: …; --belly: …; }` (hands, thumbs, bare arms
     and legs; `--belly` for necklines) and its
     face colours beside the others. Face colours stay fixed on every skin.
  6. A colour variant (like the black and brown bears) is another `SPECIES` entry with the same face and
     different CSS variables on its `.species-<id>`.
  7. Check it in every act, singing as well as still, (they all show it), and add a row to the critter table in the
     [user guide](USER-GUIDE.md#critters).
- **An act:** copy the nearest one (`Drums.tsx`, say) to `components/critters/MyAct.tsx`, then:
  1. Take `ActProps` (`{ species, still }`) and wrap the scene in `CritterFrame` with `kind="myact"` (the
     `critter-myact` class for its colours) and `species={species.id}`.
  2. Draw behind to front: background, `{Tail && <Tail />}`, legs inside `<Legs species={species}>` (so a
     legless critter swaps in its own), `<Body species={species}>` (`TORSO` clothes, then `BodyOutfits`; it
     narrows for slim critters and adds the chin shadow, so don't draw your own), `<Head species={species}
     hat={…} eyewear={…} />` with the act's headwear (`className="own-hat"`, and `data-part="adjust"` to
     have it set straight when paused; glasses `className="own-eyewear"`), then the instrument and arms (`Arm`, classes `sleeve` and `hand`, can hold a prop).
  3. Call `useCritterRig(root, frame, { still })` with a `frame` callback for its hands and props. Write
     attributes straight onto `data-part` elements; don't set React state per frame. Keep it moving with
     `a.live` false (made-up signal) and calm when `idle`. Mouths sing on their own; pass `talk: false`
     only if the act covers the mouth.
  4. Colours: `.critter-myact …` rules at the end of `styles.css`. Clothes, instruments and lights use
     `--accent` / `--viz-*`; use `var(--skin)` for bare arms (`.critter-myact .sleeve`).
  5. Add its id to `Act` (`store/settings.ts`) and an entry to `ACTS` (`Critter.tsx`). That's all the
     wiring: **Switch act** and the Settings cards read the list. Add a row to the act table in the
     [user guide](USER-GUIDE.md#critters).
- **An outfit for a skin group:** a `<g className="outfit outfit-mygroup">` in `Head` and/or `BodyOutfits`
  (`parts.tsx`) and a `:root[data-skin-group='mygroup'] .critter .outfit-mygroup` line in the "skin-group
  outfits" rule. The group slug is the first word of the group name, lower-case (`skinGroup()` in
  `store/settings.ts`). If it replaces headwear or glasses, hide `.own-hat` / `.own-eyewear` for that group.
  Check it on every species: they share the skeleton, but faces differ.

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
