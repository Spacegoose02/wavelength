# Wavelength documentation

Welcome. This folder is written for the next person who owns Wavelength — enough to find your way
around in an afternoon, fix bugs without archaeology, and add features in the house style.

## Read in this order

1. **[ARCHITECTURE.md](ARCHITECTURE.md)** — the mental model: three layers (React UI, Rust shell,
   Android native), how playback works, where every piece of state lives.
2. **[DEVELOPMENT.md](DEVELOPMENT.md)** — get it running on your machine (desktop and Android).
3. **[SOURCES.md](SOURCES.md)** — the external servers and APIs, with endpoints and gotchas.
4. **[CONTRIBUTING.md](CONTRIBUTING.md)** — recipes: add a source, a chart, a page, a skin, a Rust command.
5. **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** — read this before debugging anything; most problems
   have already been met once.
6. **[USER-GUIDE.md](USER-GUIDE.md)** — how features look and work for a listener, with screenshots
   (Deezer artist/album/playlist browsing, choosing Discover charts).
7. **[RELEASING.md](RELEASING.md)** — ship a new version.
8. **[BRAND.md](BRAND.md)** — the look and the voice.
9. **[USERS-AND-ADMIN.md](USERS-AND-ADMIN.md)** — design: user profiles, roles, admin-only features,
   the Wavelength Hub server, and the phased roadmap for the planned board cards.
10. **[HUB.md](HUB.md)** — the Wavelength Hub server: install on Unraid, Nginx Proxy Manager + tinyauth,
   settings, API, developing it.

## The 60-second tour

```
src/                React + TypeScript UI (Vite). Almost all features live here.
  sources/          One adapter per backend (Navidrome, Plex, …) + charts, radio, downloads
  store/            zustand stores: settings, player, catalog, library, offline, ui …
  player/engine.ts  The audio engine (two <audio> elements + Web Audio visualiser)
  views/            Pages (Discover, SubWave, Playlists, Settings, …)
  components/       Shared UI (player bar, track list, buttons)
  lib/              http, matching, platform detection, TV remote, Android media bridge
  styles.css        All styling + all 37 skins (CSS variables per [data-skin])
src-tauri/          Rust shell (Tauri 2): http plugin, yt-dlp, SMB login, offline files
hub/                Wavelength Hub (Node + SQLite, Docker): accounts, roles, sign-in, admin-only API
  gen/android/      The Android project (Kotlin): media session, playback service, TV, permissions
docs/               You are here. brand/ = logo & banners, screenshots/ = README and user-guide images
```

## Ground rules that keep it maintainable

- **Every backend implements the same `MusicSource` interface** (`src/sources/types.ts`). Views never
  talk to a server directly — they call the interface. New backends slot in without touching pages.
- **Optional capabilities are optional methods.** `getPlaylists?`, `setFavorite?`, `prepare?` … a
  view checks `if (src.method)` before showing the button.
- **Never trust a remote shape.** SubWave and the chart scrapers normalise everything they read
  (`swTrack()`, `txt()`, `list()` in `sources/subwave.ts`). Pages render normalised data only.
- **Every page sits inside an `ErrorBoundary`.** One broken view must never blank the app.
- **Freshness over completeness for charts.** A chart that can't prove it's recent is dropped, not shown.
- **Persisted keys start with `tonearm.`** — the project's original name. Don't rename them; it would
  wipe every user's settings. Same for the app identifier `com.tonearm.app` (see ARCHITECTURE.md).
