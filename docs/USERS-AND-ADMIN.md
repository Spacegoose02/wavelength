# Users, roles and admin — design and roadmap

Status: **proposal** (October 2026). Nothing here is built yet. This document decides *where* accounts,
roles, keys and admin-only rules live, and orders the planned board cards into phases with effort and
dependencies. It assumes Navidrome stays the main music server.

- [1. Where we are today](#1-where-we-are-today)
- [2. The core decision: add a small server, the Wavelength Hub](#2-the-core-decision-add-a-small-server-the-wavelength-hub)
- [3. Accounts, roles and the auth model](#3-accounts-roles-and-the-auth-model)
- [4. Keys and per-user service accounts](#4-keys-and-per-user-service-accounts)
- [5. How admin-only is enforced](#5-how-admin-only-is-enforced)
- [6. Feature designs (one per board card)](#6-feature-designs-one-per-board-card)
- [7. Extra features worth adding](#7-extra-features-worth-adding)
- [8. Phased roadmap](#8-phased-roadmap)
- [9. Decisions needed from the owner](#9-decisions-needed-from-the-owner)
- [10. Risks and open questions](#10-risks-and-open-questions)

---

## 1. Where we are today

Wavelength is a **client only** (see [ARCHITECTURE.md](ARCHITECTURE.md)). Every device keeps its own
settings in WebView `localStorage` (`tonearm.settings`), including:

- server URLs and logins for Navidrome, Plex, Audiobookshelf and SUB/WAVE,
- the **SUB/WAVE admin user and password**, the **deemix ARL**, yt-dlp SMB credentials,
- skin, EQ, saved radio stations, mixed-source playlists and play history.

Consequences that matter for this roadmap:

| Today | Why it blocks the board |
|---|---|
| There is no notion of a "user" in Wavelength. Whoever types credentials into Settings *is* that account. | No profiles, no roles, no kids profiles. |
| Admin power = holding an admin password. Any device with the SUB/WAVE admin password in Settings can skip songs, edit the schedule, etc. | "Admin-only" can't be enforced by the app: hiding a button still leaves the password readable in `localStorage`. |
| Nothing syncs between devices except what lives on the servers. | No sign-in sync, no per-user settings that follow you. |
| No place to keep shared state (requests, approvals, flags like "not safe for kids"). | Requests, approvals, kid flags and an active-users view all need a shared, always-on store. |

**Conclusion:** a client can hide things, but only a server can *refuse* things. Every card that says
"admin only", "admin approves", "admin links keys" or "admin sees" needs a server-side component.

## 2. The core decision: add a small server, the Wavelength Hub

Add a new, optional, self-hosted service, the **Wavelength Hub**, shipped as one Docker container
next to Navidrome. The app keeps talking to Navidrome, Plex, Audiobookshelf and SUB/WAVE directly for
browsing and streaming. The Hub is the **control plane**, not the data plane: audio never flows through it.

```
                ┌──────────────────────────── Docker host ─────────────────────────────┐
                │                                                                      │
 Wavelength ──▶ │  reverse proxy (Caddy / Traefik / nginx)  ──▶  tinyauth (forward auth)│
  app (any      │        │                                                             │
  device)       │        ├──▶ Wavelength Hub  (users, roles, keys vault, requests,     │
                │        │      settings sync, admin API, job runner)                  │
                │        │         │  admin creds live ONLY here                       │
                │        │         ├──▶ Navidrome native API (create users, libraries) │
                │        │         ├──▶ SUB/WAVE admin routes                          │
                │        │         ├──▶ deemix / slskd / yt-dlp (downloads)            │
                │        │         ├──▶ Audiobookshelf admin API                       │
                │        │         └──▶ /music (read-write mount, for tags + downloads)│
                │        │                                                             │
 streaming ───▶ │        └──▶ Navidrome / Plex / ABS / Icecast (per-user, non-admin)   │
                └──────────────────────────────────────────────────────────────────────┘
```

### What lives where

| Concern | Lives in | Why |
|---|---|---|
| Users, roles, devices, sessions | **Hub** (SQLite) | Must be shared and authoritative. |
| Admin credentials (Navidrome admin, SUB/WAVE admin, deemix ARL, slskd API key, ABS root key, Plex owner token) | **Hub only**, encrypted at rest | A non-admin device must never hold one (see §5). |
| Per-user, non-admin credentials (the user's own Navidrome login, their ABS key) | Hub (source of truth) → handed to that user's devices on sign-in, kept in the OS keychain | Needed for direct streaming; harmless because they only grant that user's own rights. |
| Requests, approvals, kid flags, tag edits, audit log | **Hub** | Shared state. |
| Per-user preferences (skin, EQ, stations, local playlists, history) | Hub (synced) + device cache | Sign-in sync across devices. |
| Device-only preferences (offline downloads, volume, TV focus) | Device | Meaningless on another device. |
| Library, streaming, playlists, stars, scrobbles | **Navidrome** (unchanged) | Keep Navidrome, per the earlier decision. |
| Themes, visualizers, the DJ raccoon | **App only** | Pure UI. |

### Standalone mode stays

Without a Hub, the app works exactly as it does today: one person, every setting on the device, the
device owner is implicitly the admin. A **"Sign in to a Wavelength Hub"** option in Settings switches
the app into Hub mode. This keeps the app useful for single-user setups and makes the Hub something
you add, not something you must run. (Owner decision, §9.)

### Hub technology

- **TypeScript on Node 22** (Fastify) + **SQLite**. Same language as the app, so request/response types
  live in one `shared/` folder used by both. No extra database container.
- Lives in this repo as `hub/` (monorepo), built by CI into `ghcr.io/spacegoose02/wavelength-hub`.
- Config by environment variables; a `docker-compose.example.yml` with Hub + tinyauth + Navidrome + Caddy.
- Secrets encrypted with AES-256-GCM using a key from `WAVELENGTH_SECRET_KEY` (or a Docker secret).
- Realtime (active users, request notifications, listen-together) over one WebSocket per device.
- Background jobs (downloads, scans, auto-download, imports) in an in-process queue persisted in SQLite.

## 3. Accounts, roles and the auth model

### Roles

| Role | Can |
|---|---|
| **Admin** | Everything: manage users, keys, requests, downloads, tags, SUB/WAVE control, server page. |
| **Member** | Listen, own playlists/favorites/settings, request music, SUB/WAVE listener features (requests, likes). |
| **Kid** | Like Member but only the kid-safe library, no explicit tracks, requests need approval (always), no downloads, no SUB/WAVE requests unless allowed. |

Roles are stored in the Hub. Permissions are checked by the Hub on every admin route (§5), and the app
uses the same permission list only to decide what to *show*. A small fixed set of permissions
(`users.manage`, `requests.approve`, `downloads.run`, `library.edit`, `subwave.control`, `server.view`, …)
maps to the roles, so a future "moderator" role is a table row, not a rewrite.

### Sign-in options

1. **tinyauth SSO (recommended primary).** tinyauth is a forward-auth service for Caddy/Traefik/nginx:
   after login it passes `Remote-User`, `Remote-Email`, `Remote-Name` and `Remote-Groups` headers to the
   protected app. Only the Hub's `/auth/sso/*` path is placed behind tinyauth; the Hub trusts those
   headers **only** from the configured proxy address (and a shared header secret), never from the open
   internet.
2. **Local Hub accounts** (username + password, argon2id). Needed for kids without an SSO account, for
   setups without tinyauth, and as an admin break-glass login.
3. Later, generic **OIDC** (Authelia, Authentik, Pocket ID, Keycloak) behind the same
   `IdentityProvider` interface, if wanted.

### How a native app signs in through tinyauth: device pairing

Forward auth is cookie-based and built for browsers, so a native app (and especially a TV) can't simply
"log in" to it. We use a **device-code flow**, the same pattern TVs use for streaming apps:

1. The app calls `POST /auth/device` → Hub returns a short code and a URL, e.g. `https://hub.home/link`.
2. The app shows the code and a QR code. On a phone/desktop it also opens the URL in the browser.
3. The person opens the URL, tinyauth asks them to log in (password, OAuth, TOTP — whatever tinyauth is
   set up with), and the Hub page shows "Sign in *Living room TV* as *alex*?" → **Allow**.
4. The app, polling `POST /auth/device/token`, receives a **device token** (random 256-bit, stored hashed
   in the Hub, stored in the OS keychain on the device).

The same flow works with local accounts (the link page shows a password form instead). Each device token
is listed under the user's profile and in the admin's device list, and can be revoked.

### First admin

The first account created on a fresh Hub becomes admin (shown in the Hub logs once), or
`WAVELENGTH_ADMINS=alex,sam` / a tinyauth group (`WAVELENGTH_ADMIN_GROUP=wavelength-admins`) seeds it.

### Sign-in sync across devices (board card)

Two parts:

- **Account sync:** once signed in, the Hub returns the user's service connections (§4), so a new device
  needs one sign-in instead of re-entering every server. That's the "simple sign-in" the card asks for.
- **Preference sync:** skin, EQ, saved stations, mixed-source playlists, local history and Discover chart
  picks move from `tonearm.settings` into a per-user document on the Hub (last-writer-wins per field,
  with a `updatedAt` per key). The local store stays as an offline cache.

## 4. Keys and per-user service accounts

The board card: *"Keys should go under all users. The admin links keys to their profile, except Navidrome,
so users can have their own Navidrome profile."*

| Service | Model | How the Hub does it |
|---|---|---|
| **Navidrome** | **One Navidrome account per Wavelength user** (non-admin), so plays, stars, playlists and history are personal. | When an admin creates a user, the Hub uses its Navidrome **admin** login on the native API to create the matching Navidrome user with a generated password, stores that password encrypted, and hands it only to that user's devices. Existing Navidrome users can be linked instead of created. Admin users get a Navidrome admin flag only if the owner wants. |
| **Audiobookshelf** | Admin picks **which ABS account** each user is signed into (board card). | Admin chooses from ABS users (Hub reads them with the ABS root key) or creates one; the Hub stores that user's ABS API token and gives it to their devices. Progress then stays per person. |
| **Plex** | Admin assigns a key per user (shared owner token, or a managed user token). | Stored in the Hub, handed to the user's devices. |
| **SUB/WAVE** | Listener features are public; admin features need the admin password. | Station URL (and station password if any) go to everyone. **The admin password never leaves the Hub**; admin calls are proxied (§5). |
| **deemix, yt-dlp, slskd** | Admin-only tools. | Credentials stay in the Hub; downloads run server-side (§6.3). |
| **Charts, Deezer browse, radio directory** | No keys. | Unchanged. |

Keys are added once by the admin under **Admin → Keys**, then **linked** to profiles (all users, a group,
or one user). A user can see *which* services they have but not admin secrets.

On devices, per-user secrets move from `localStorage` into the OS keychain
(`tauri-plugin-stronghold` on desktop, Android Keystore). This was already on the roadmap
(ARCHITECTURE.md §4) and should land in Phase 1.

## 5. How admin-only is enforced

The rule: **a non-admin device never holds a credential that can do an admin action.** UI hiding is a
convenience on top, not the protection.

1. **Admin secrets live only in the Hub.** In Hub mode, Settings no longer stores the SUB/WAVE admin
   password, the deemix ARL, the slskd key or a Navidrome admin password on any device, admin or not.
2. **Admin actions go through Hub routes** under `/api/admin/*`. Each route checks the device token's
   user and permission before doing anything, then calls the service with the stored admin credential.
   Example: `POST /api/admin/subwave/skip` → check `subwave.control` → Hub calls SUB/WAVE `/dj/skip`
   with HTTP Basic. This covers the card *"Users should not have admin controls on SUB/WAVE, only admin."*
3. **Services enforce their own limits too.** Users get non-admin Navidrome accounts, so Navidrome itself
   refuses scans, user changes or radio deletes from them. Kids' Navidrome accounts only see the kids
   library (§6.5).
4. **The app hides what the role can't do** (SUB/WAVE admin tabs, Downloads, the tag editor, the Admin
   section) using the permission list from `GET /api/me`.
5. **Audit log.** Every admin route writes who/what/when; visible on the admin server page.
6. **Tests.** Every `/api/admin/*` route gets a test that a member and a kid token receive `403`.

In the SUB/WAVE adapter (`sources/subwave.ts`), `req(..., { admin: true })` is the one place admin calls
are made today, so Hub mode swaps the transport there: admin requests go to the Hub proxy instead of
SUB/WAVE with Basic auth. Views (`SubWaveAdmin.tsx`) don't change beyond being hidden for non-admins.

## 6. Feature designs (one per board card)

Effort: **S** ≈ a day or two, **M** ≈ up to a week, **L** ≈ 1–2 weeks, **XL** ≈ several weeks.
"Needs Hub" means it can't be done properly without §2.

### 6.1 Profiles and accounts

| Card | Design | Needs Hub | Effort |
|---|---|---|---|
| **Users / profiles** | Profile = display name, avatar (upload or initials), role, linked services, devices. Profile switcher on shared devices (like a TV) with an optional PIN. | Yes | M |
| **tinyauth SSO** | §3, device pairing + forward-auth headers. | Yes | M |
| **Keys under users, own Navidrome profile** | §4. | Yes | L |
| **Account sign-in sync across devices** | §3 "Sign-in sync". | Yes | M |
| **Admin chooses who's signed into Audiobookshelf** | §4, ABS row. | Yes | S (after keys) |
| **Admin sees all active users** | Hub tracks device heartbeats over WebSocket plus each player's now-playing (the app already knows it). Admin page: who's online, on which device, what's playing, since when. Also merges Navidrome `getNowPlaying` for other clients. Admin can sign a device out. | Yes | M |

### 6.2 SUB/WAVE

| Card | Design | Needs Hub | Effort |
|---|---|---|---|
| **No admin controls on SUB/WAVE for non-admins** | §5: Hub proxy for every `admin: true` route, admin tabs hidden for others. Listener features (requests, likes, on-air) unchanged. | Yes | M |

Quick interim step (Phase 0, no Hub): a device-level **"Hide SUB/WAVE admin on this device"** lock with
a PIN. Clearly labelled as a convenience, not security.

### 6.3 Requests and downloads

| Card | Design | Needs Hub | Effort |
|---|---|---|---|
| **Users request music near the preview, admin approves** | A **Request** button next to Preview/Get in Discover, Release Radar, Deezer browse and search results. For non-admins it *replaces* Get. The Hub stores the request (Deezer id/link, who, when, note). Admin gets a badge and an **Admin → Requests** queue: approve (choose bitrate/clean/explicit), reject with a reason, or "already in library" (uses `lib/match.ts`). On approve, the Hub runs the download (deemix first, slskd or yt-dlp as fallback), triggers a Navidrome scan, and notifies the requester with "Your song is ready" and a play button. Kids' requests always need approval; admins can turn on auto-approve for trusted members. | Yes | L |
| **Per-user autodownload setting** | Interpreted as two toggles (owner to confirm, §9): (a) **Auto-download to this device** — new tracks in my favorites / chosen playlists / my approved requests are saved for offline automatically (client side, uses `store/offline.ts`, per device, synced as a preference). (b) **Auto-approve my requests** — per-user flag the admin grants. | (a) No, (b) Yes | M |
| **Connect to slskd** | `sources/slskd.ts` in the Hub: search (`POST /api/v0/searches`, poll results), download from a chosen peer, watch transfer state, move finished files into the library layout, scan Navidrome. Admin-only; appears as a third source in Downloads and as a fallback for requests. API key stays in the Hub. | Yes | M |

Downloads move server-side in Hub mode: deemix already runs as a server; yt-dlp gets a server-side runner
in the Hub container (so Android can use it too — today it's desktop-only). The existing client-side
paths stay for standalone mode.

### 6.4 Library curation

| Card | Design | Needs Hub | Effort |
|---|---|---|---|
| **Admin tag editor for artists, albums and songs, with matching and "mixtape match"** | Navidrome can't write tags over its API, so the Hub mounts the music folder read-write and edits files directly (ID3/Vorbis/MP4 via a tag library), then asks Navidrome to rescan. UI: open any artist/album/song → **Edit info** (admin only): title, artist, album artist, album, track/disc numbers, year, genre, cover art, explicit flag. Bulk edit for a whole album. **Match**: look the album up on MusicBrainz and Deezer, show a side-by-side diff, apply with one click (like MusicBrainz Picard). **Mixtape match**: our reading (to confirm, §9) is grouping loose singles into one album — pick songs, name the mixtape, Hub sets a shared album/album-artist ("Various Artists" or a DJ name), track numbers and a generated cover. Every edit is logged with the old values so it can be undone. | Yes | XL |
| **Users import / create playlists, import from Spotify, Plex and other sources** | Creating playlists already works (Navidrome/Plex two-way sync + mixed-source playlists). Import: paste a Spotify, Deezer, YouTube Music or Apple Music playlist link, or a CSV/M3U file. The Hub (or the app for public links) reads the track list, matches each song against the user's library with `lib/match.ts`, creates the playlist in the user's own Navidrome account, and lists missing songs with one **Request missing** button (feeds §6.3). Plex → Navidrome already exists as "export between servers" and gets surfaced here. Spotify needs API credentials (client credentials for public playlists, or per-user OAuth for private ones) — kept in the Hub. | Partly | L |

### 6.5 Kids and content rating

| Card | Design | Needs Hub | Effort |
|---|---|---|---|
| **Kids profiles** | Role = Kid (§3). Simple, big-button UI option, no Downloads/Settings/admin, optional listening-time limit and bedtime. PIN to leave a kid profile on a shared device. | Yes | M |
| **Mark music not safe for kids** | Admin (and optionally parents) can flag a song, album or artist as not kid-safe. Flags live in the Hub; the app hides flagged items for kids, and the Hub filters search/library results it serves. **Hard enforcement:** Navidrome supports multiple libraries with per-user access, so the recommended setup is a separate **Kids** library folder that kid Navidrome accounts are limited to; "approve for kids" copies or links a file into it. Soft flags alone can be bypassed by anyone with the kid's Navidrome password. | Yes | M |
| **Explicit and clean versions** | Read explicit status from Deezer (`explicit_lyrics`, `explicit_content_lyrics`) when browsing and downloading, and from files/Navidrome (OpenSubsonic `explicitStatus`, `ITUNESADVISORY` tag) in the library. Show an **E** / **C** badge. On Deezer pages and in requests, offer "Get clean version" by finding the matching clean album. Per-user setting: prefer clean / prefer explicit / show both. Kids always get clean. When both versions are in the library, collapse them into one album with a version switch (extends the merge in `sources/registry.ts`). | Partly | L |

### 6.6 Look and feel (app only)

| Card | Design | Needs Hub | Effort |
|---|---|---|---|
| **Themes in their own Settings tab** | Settings gets tabs (Sources, Playback, Downloads, **Themes**, Discover, Admin). Themes tab: the skin grid with live previews, grouped (Classic, Retro, Neon, Editor palettes, Holidays, Accessibility), a search box, and "Random daily". | No | S |
| **More themes: nuclear, retro, gamer, futuristic, holidays** | New skin groups as CSS variable blocks (house style, see CONTRIBUTING.md): Nuclear (radioactive green + hazard yellow, Geiger-style LCD), more Retro (Atari, NES, VHS), Gamer (RGB, carbon fibre), Futuristic (holo glass, sci-fi HUD). **Holidays**: Halloween, Thanksgiving, Christmas, July 4th, Valentine's Day, plus an optional **"Seasonal"** mode that switches automatically in the weeks around each holiday and back afterwards. | No | M |
| **More visualizers or a DJ raccoon** | A new Now Playing scene in `components/Scenes.tsx`: an SVG raccoon DJ behind decks. Fur stays black/grey; clothes (hoodie, cap, headphones) and the decks' lights use the skin's CSS variables (`--accent`, `--viz-*`), so every skin dresses him differently; holiday skins can add a hat. The head bobs on detected beats (energy spikes in the existing `AnalyserNode` low bands), hands scratch on strong transients, and he idles (yawns, adjusts headphones) when paused. Falls back to a gentle idle sway when the audio host blocks Web Audio. Plus 2–3 extra classic visualizers (Milkdrop-style feedback tunnel, VU meters, waveform ribbon). | No | M (raccoon), S each (visualizers) |
| **Removable radios** | Saved stations are already removable (heart). The fixed "Your stations" row (Navidrome internet radio and SUB/WAVE) can't be. Add **Hide** for everyone (a per-user hidden list, synced in Hub mode) and, for admins, **Delete from server** (Navidrome `deleteInternetRadioStation`, which Navidrome restricts to admins). Plus drag to reorder. | Hide: No. Delete: Yes (admin) | S |

### 6.7 Admin server controls and Docker

| Card | Design | Needs Hub | Effort |
|---|---|---|---|
| **Admin server controls page** | **Admin → Server**: health and version for every service (Navidrome scan status, last scan, track count; SUB/WAVE on-air + listeners; deemix login state + queue; slskd connection; ABS; Hub disk usage), buttons for rescan / restart download queue / clear failed jobs, the audit log, Hub backup download, and links into each service's own web UI. | Yes | M |
| **Optional Docker for admin device control and saving data/keys** | The Hub *is* that container: it saves data and keys (SQLite volume + encrypted secrets) and controls devices (see sessions, sign devices out, send "stop" / "play" commands to a device over its WebSocket). **Optional and off by default:** controlling other containers (restart Navidrome, update images) through the Docker socket. Mounting `/var/run/docker.sock` gives root on the host, so if enabled it goes through a socket proxy (e.g. `tecnativa/docker-socket-proxy`) limited to list/restart for named containers. | Yes | M (+S for Docker control) |

## 7. Extra features worth adding

High value and they fit naturally on top of the Hub:

1. **Remote control and handoff ("cast to")** — from your phone, control what's playing on the TV or desktop,
   or move playback between devices ("continue on living room TV"). Uses the same WebSocket as active users. **M**
2. **Listen together** — a shared session: everyone hears the same queue in sync, anyone (or only the host)
   can add songs. Great for parties and road trips. **L**
3. **Synced lyrics** — LRCLIB (free, no key) or embedded LRC; karaoke-style highlighting in Now Playing, a
   big-text TV mode, and kids get lyrics only on clean tracks. App only. **S–M**
4. **Request notifications and an inbox** — "your request was approved/ready", "new release from an artist you
   follow"; Android notifications through the existing foreground service. **S** (after requests)
5. **Wavelength Rewind** — a yearly/monthly personal stats page (top artists, hours listened, first play of
   your favourite song), shareable as an image. Per-user history makes this possible. **M**
6. **Invite links with QR codes** — admin creates an invite (role, services, expiry); the new user scans it on
   their phone or TV and is signed in. Pairs with device pairing. **S**
7. **Sleep timer and alarm** — stop after N minutes / end of track or chapter; wake to a playlist or station.
   App only. **S**
8. **Collaborative household playlists** — shared playlists any member can add to, with "added by" avatars. **M**
9. **Hub backup and restore** — one-click export of users, settings, requests and flags; restore on a new
   server. **S**

## 8. Phased roadmap

```
Phase 0  App-only quick wins ────────────────┐ (can run in parallel with everything)
Phase 1  Hub foundation ─────────┬───────────┴─────────────────────────────────────
Phase 2  Keys + admin-only ──────┤
Phase 3  Requests + downloads ───┤ (needs 2)
Phase 4  Kids + content rating ──┤ (needs 2; clean versions benefit from 3)
Phase 5  Library curation ───────┤ (needs 3 for "request missing")
Phase 6  Server page + extras ───┘ (needs 2; grows each phase)
```

### Phase 0 — App-only quick wins (no Hub) · ~2–3 weeks total, any order

| Item | Effort |
|---|---|
| Themes tab in Settings (and tabs for Settings generally) | S |
| New theme packs: Nuclear, Retro, Gamer, Futuristic | M |
| Holiday themes + automatic Seasonal mode | M |
| DJ raccoon scene + 2–3 more visualizers | M |
| Hide server radio stations, reorder stations | S |
| Explicit badges from Deezer data in Discover/Deezer browse | S |
| Sleep timer, synced lyrics (extras) | S–M |
| Device-level PIN lock for SUB/WAVE admin and Downloads (stopgap, labelled as such) | S |

### Phase 1 — Hub foundation · ~3–4 weeks · **recommended first**

Everything else in the users/admin column depends on this.

1. `hub/` service skeleton: Fastify, SQLite with migrations, config, Dockerfile, CI image, compose example.
2. Users, roles, permissions, device tokens, audit log.
3. Sign-in: local accounts + tinyauth forward-auth + device pairing (code + QR), first-admin bootstrap.
4. App: "Sign in to a Wavelength Hub" in Settings, `GET /api/me` drives what's shown, token in the OS
   keychain (move existing credentials there too), sign out / switch profile.
5. Preference sync (skin, EQ, stations, local playlists, history, Discover picks).
6. Admin → Users: create, invite, change role, disable, see devices, sign a device out.
7. Docs: `docs/HUB.md` (install, tinyauth + Caddy/Traefik examples), ARCHITECTURE/SOURCES updates, user guide.

Exit criteria: two people sign in on different devices, each keeps their own settings, and a member's
token gets `403` from every admin route.

### Phase 2 — Keys and admin-only enforcement · ~2–3 weeks

Keys vault, link keys to profiles, Navidrome user provisioning, ABS account assignment, Plex keys,
SUB/WAVE admin proxy (admin controls for admins only), active users view. **Cards closed:** keys under
users, own Navidrome profile, no SUB/WAVE admin for non-admins, admin picks ABS sign-in, admin sees active
users, sign-in sync (account part).

### Phase 3 — Requests and downloads · ~3 weeks

Request button + approval queue, server-side deemix/yt-dlp runner, slskd source, notifications,
auto-download settings. **Cards closed:** request music, per-user autodownload, connect to slskd.

### Phase 4 — Kids and content rating · ~2–3 weeks

Kid role and UI, Kids Navidrome library, not-safe flags, explicit/clean detection, clean-version lookup
and version switch. **Cards closed:** kids profiles, mark not safe for kids, explicit and clean versions.

### Phase 5 — Library curation and imports · ~4–5 weeks

Tag editor with MusicBrainz/Deezer match and mixtape builder, undo log; playlist import from
Spotify/Deezer/YouTube Music/CSV/M3U with "request missing". **Cards closed:** tag editor + mixtape match,
import playlists.

### Phase 6 — Admin server page, device control and extras · ~2–3 weeks + ongoing

Server controls page, optional Docker control via socket proxy, remote control/handoff, listen together,
Rewind, invites, backups. **Cards closed:** admin server page, Docker control.

### Card → phase index

| Board card | Phase |
|---|---|
| Users / profiles | 1 |
| tinyauth SSO sign-in | 1 |
| Account sign-in sync across devices | 1 (prefs) + 2 (accounts) |
| Keys under users, own Navidrome profile | 2 |
| No SUB/WAVE admin controls for users | 2 (stopgap PIN in 0) |
| Admin chooses who's signed into Audiobookshelf | 2 |
| Admin sees all active users | 2 |
| Request music near the preview, admin approves | 3 |
| Per-user autodownload setting | 3 |
| Connect to slskd | 3 |
| Kids profiles | 4 |
| Mark music not safe for kids | 4 |
| Explicit and non-explicit versions | 4 (badges in 0) |
| Admin tag editor + mixtape match | 5 |
| Import / create playlists from Spotify/Plex/other | 5 |
| Admin server controls page | 6 |
| Docker for admin device control and saving data/keys | 1 (container) + 6 (control) |
| Removable radios | 0 (hide) + 2 (admin delete) |
| More themes (nuclear, retro, gamer, futuristic, holidays) | 0 |
| Themes in their own Settings tab | 0 |
| More visualizers / DJ raccoon | 0 |

## 9. Decisions needed from the owner

1. **Add the Wavelength Hub server?** Recommended: yes. Without it, admin-only can only be a PIN on each device.
2. **Keep standalone (no-Hub) mode?** Recommended: yes, so the app keeps working for single-user setups.
3. **Sign-in methods.** Recommended: tinyauth SSO as the main path plus local Hub accounts (kids,
   break-glass). Is tinyauth already running in front of your other services, and which proxy (Caddy, Traefik, nginx)?
4. **Hub needs read-write access to the music folder** (tag editing, server-side downloads, slskd). Is the
   Hub going on the same host/NAS as Navidrome?
5. **What "autodownload" means:** auto-save to the device for offline, auto-approve requests, or both (our reading: both, as two toggles).
6. **What "mixtape match" means:** grouping singles into a mixtape album (our reading), or matching tags
   against an online database, or both.
7. **Kids filtering strength:** a separate Kids library in Navidrome (hard, recommended) or flags only (soft, simpler, bypassable).
8. **Docker socket control:** leave off (recommended) or allow restarts through a locked-down socket proxy.

## 10. Risks and open questions

- **Navidrome API coverage.** User creation, library assignment and radio deletion use Navidrome's native
  API, which is not a stable public contract. Pin a tested Navidrome version range and cover these calls with
  integration tests against a Navidrome container in CI.
- **tinyauth with native apps.** Forward auth is browser-oriented; the device-pairing flow avoids putting API
  traffic behind it. Header trust must be locked to the proxy, or anyone could send `Remote-User: admin`.
- **Spotify API access** for new apps has been narrowed over time. Public playlist reading should keep working;
  if not, fall back to CSV exports (Exportify) and link parsing.
- **Tag writing is destructive.** Keep an undo log of old values, edit a temp copy then rename (same pattern as
  `offline.rs`), and never edit while a download job writes the same folder.
- **Migration.** Existing users' `tonearm.settings` must survive: signing in to a Hub offers to upload the
  device's current settings as the user's profile, and storage keys keep the `tonearm.` prefix.
- **Scope.** The Hub is a second product to maintain. Keeping it a control plane (no streaming, no transcoding)
  keeps it small.
