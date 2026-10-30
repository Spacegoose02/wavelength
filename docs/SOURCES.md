# Sources & integrations

Every external system Wavelength talks to, how, and what bites. All HTTP goes through
`lib/http.ts` → Rust (`tauri-plugin-http`), so CORS never matters inside the app.

## Library servers

### Navidrome — `src/sources/navidrome.ts`
- **Protocol**: Subsonic REST (`/rest/<method>?u=&t=&s=&v=1.16.1&c=Wavelength&f=json`). Token auth: `t = md5(password + salt)`, fresh salt per URL.
- **Also uses Navidrome's native API** for per-track play history: `POST /auth/login` → JWT, then `GET /api/song?_sort=play_date&_order=DESC` with header `x-nd-authorization: Bearer …`. Subsonic has no track-level history.
- Albums (`getAlbumList2`, paged by 500), artists, search (`search3`), internet radio, stars (`star`/`unstar`/`getStarred2`), playlists (`getPlaylists`, `createPlaylist`, `updatePlaylist` with repeated `songIdToAdd`/`songIndexToRemove`), scrobble, `startScan`.
- `prepare()` regenerates the stream URL (the token is salted per URL) — saved playlists depend on this.
- Cover art: `getCoverArt?id=<albumId or songId>`.

### Plex (and Plexamp) — `src/sources/plex.ts`
- Auth: `X-Plex-Token` header + a persistent `X-Plex-Client-Identifier` (`tonearm.plexClientId`). JSON via `Accept: application/json`.
- Music libraries = sections with `type === 'artist'`. Albums `type=9`, artists `type=8`, tracks via `/library/metadata/<id>/children`.
- Streams play the original file: `<server><Media[0].Part[0].key>?X-Plex-Token=…`.
- Playlists (what Plexamp shows): `GET /playlists?playlistType=audio`; create/add need a URI
  `server://<machineIdentifier>/com.plexapp.plugins.library/library/metadata/<ids,comma>`. Removing an
  entry needs its `playlistItemID`, not the track id.
- Artwork: `/photo/:/transcode?width=500&height=500&url=<thumb>`.

### Audiobookshelf — `src/sources/audiobookshelf.ts`
- Auth: `Authorization: Bearer <API key>`. Book and podcast libraries are kept separate (`mediaType`).
- Playback opens a **session**: `POST /api/items/<id>/play` (books) or `/play/<episodeId>` (podcasts) with `forceDirectPlay`. Audio files come back in `audioTracks[]` (`contentUrl` + `?token=`), multi-file books carry `startOffset`.
- Progress: `POST /api/session/<id>/sync { currentTime, timeListened }` every 15 s. Resume point = session `currentTime`.
- Progress per item/episode: `GET /api/me` → `mediaProgress[]`.

## SUB/WAVE AI radio — `src/sources/subwave.ts`, `views/SubWave*.tsx`
Project: <https://github.com/perminder-klair/subwave>. Ports: web `:7700` (API mounted at `/api` behind Caddy), controller `:7701`, Icecast `:7702`.

- Public: `GET /now-playing`, `/state` (current/upcoming/history), `/schedule`, `/personas`, `POST /request` + `GET /request/:id`, `POST /like`, `/cover/:id`.
- Admin (HTTP Basic `ADMIN_USER`/`ADMIN_PASS`): `/dj/skip`, `/dj/say`, `/dj/skill`, `/dj/search`, `/dj/queue-track`, `/dj/queue-block`, `DELETE /dj/queue/:trackId`, `DELETE /dj/queue/block/:blockId`, `/jingles`, `/sfx`, `PUT /schedule`, `POST/DELETE /shows`, `POST/DELETE /schedule/override`, `GET /settings` (full show objects), `/stats`, `/listeners/connections`, `/likes`, `/likes/index`.
- **Quirks** (all handled):
  - now-playing has `timestamp` (unix *seconds*) and `duration` but no `startedAt`; `/state` items have ISO `startedAt`. `swTrack()` normalises both.
  - Queue items are identified by `subsonic_id` (the `trackId` the cancel route expects). Block members carry `block: { id, label, index, size }`.
  - Saving a show **replaces** it — `upsertShow()` first loads the full object from `GET /settings` and merges, so fields the UI doesn't show (genres, playlists…) survive.
  - Titles often include track numbers (`"06 - Song"`); stripped for display.
  - Fields sometimes arrive as objects (`{ name }`) where text is expected — `txt()` copes.
- When something looks wrong, read the routes in the SUB/WAVE repo (`controller/src/routes/*.ts`, `broadcast/queue.ts`) rather than guessing.

## Radio — `src/sources/radio.ts`
- Directory: radio-browser.info (`/json/stations/search`, `/topclick`). Free, no key.
- Now playing: tries the station's Icecast `/status-json.xsl`; understands AzuraCast and simple `{title, artist}` shapes; SUB/WAVE has its own endpoint.

## Downloads

### deemix — `src/sources/deemix.ts`
- Talks to the deemix web server (default `:6595`). `POST /api/addToQueue { url, bitrate }` (9 = FLAC, 3 = MP3 320, 1 = MP3 128), `GET /api/getQueue`, `GET /api/connect`.
- **deemix keeps login per session** — a fresh Wavelength connection is logged out. If `addToQueue` returns `NotLoggedIn`, Wavelength calls `POST /api/loginArl { arl }` with the ARL from Settings and retries.
- deemix answers HTTP 200 with `{ result: false, errid }` on failure — always check `result`.
- Search and browsing use Deezer's public API, no login: `/search/artist`, `/search/album`, `/search/playlist`, `/search` for results;
  `/artist/<id>` + `/top` + `/albums` + `/related` + `/playlists` for artist pages (`getDeezerArtist`); `/album/<id>` for album pages
  (`getDeezerAlbum`); `/playlist/<id>` for playlist pages (`getDeezerPlaylist`) — its embedded tracklist is cut short on big
  playlists, so the rest is paged from `/playlist/<id>/tracks?index=&limit=` (capped at 2,000). Private playlists return `{ error }`. Unknown ids come back as HTTP 200 with `{ error }` — check it. The album endpoint's embedded
  tracklist has no `album` object or `track_position`, so both are filled in from the album.
- Any deezer.com link works in `addToQueue`: song, album, playlist, or **artist** (deemix queues the whole discography).
- UI: `views/DeezerBrowse.tsx` (pages) inside the Deezer tab of `views/Downloads.tsx`. User-facing walkthrough: [USER-GUIDE.md](USER-GUIDE.md).

### yt-dlp (desktop only) — `src-tauri/src/ytdlp.rs`, `src/sources/ytdlp.ts`
- Backup when a song isn't on Deezer. Search = `yt-dlp -J --flat-playlist ytsearch25:<q>`; also accepts any URL yt-dlp supports.
- Download: `-x --audio-format <opus|m4a|mp3|flac> --embed-metadata --embed-thumbnail`, saved as `Artist/Album/Title.ext` (album defaults to "Singles") so Navidrome files it properly.
- Finds `yt-dlp.exe` in winget's Links folder and **ffmpeg in winget's Packages folder** (it isn't on PATH until a new login).
- SMB shares: `connect_share` logs in with the stored username/password before downloading.

## Discover charts — `src/sources/charts.ts`
Each source returns `Chart { entries, asOf }`. `getMix(genre, sources)` combines sources with Borda-style scoring
(songs on more charts, ranked higher, float up). **Every chart passes a freshness check** — if a source
can't prove it updated recently (21 days by default; RadioWave 35, iHeart R&B Hits 45), it's dropped.

| Source | How | Genres | Notes |
|---|---|---|---|
| Billboard | Scrape `billboard.com/charts/<slug>/` (DOMParser, `h3#title-of-a-story`), "Week of" date | Hot 100, Pop, Country, Rock | Rap, R&B/Hip-Hop, Dance and Latin pages are stale — not used |
| Apple Music | RSS `rss.marketingtools.apple.com/.../most-played/100/songs.json` (moved from `rss.applemarketingtools.com` in Oct 2026), filtered by genre name | all but EDM | One shared fetch for all genres; the service has outages (504) |
| Deezer | `api.deezer.com/chart/0/tracks` | Top overall | Deezer's **genre** charts are frozen — don't use them |
| Deezer editors | `api.deezer.com/playlist/<id>`; fresh = newest `time_add`. Ids in `DEEZER_PLAYLISTS`: Radar Weekly `1282495565` (new releases, Fridays), Fresh Rap `6682665064` (daily), Fresh Pop `2228601362`, Fresh R&B `2021225582`, Metal Radar `1050179021`, Electronic Hits `1902101402`, New Dance `2249258602`, Global Dance Hits `706093725` | New, Rap, Pop, R&B, Rock, EDM | Includes 30 s `preview` URLs. To add one: the number at the end of a deezer.com playlist link, owned by a "Deezer … Editor" account |
| Spotify editors | Spotify's public embed page `open.spotify.com/embed/playlist/<id>` (`__NEXT_DATA__`, read by `src/lib/spotifyEmbed.ts`, shared with playlist import). New Music Friday `37i9dQZF1DX4JAvHpjipBk` | New | No dates on the page, so it's treated as live (Spotify replaces it every Friday). Spotify's Web API stopped serving its own editorial playlists to new apps in Nov 2024, so the API isn't an option; the embed page needs no login |
| RadioWave Monitor | Scrape `radiowavemonitor.com/pub_charts/r100_<n>.aspx` (1 Alt Rock, 4 Pop/Top 40, 6 Hot Country, 8 Big Rock, 9 Rhythmic) | several | ~2-week publishing lag; titles are UPPERCASE → title-cased |
| iHeartRadio editors | `us.api.iheart.com/api/v3/collection/user/312064750/collection/<id>` + `api/v3/catalog/tracks/<ids>`; freshness = `lastUpdated` | many | Playlist ids are in the `IHEART` map. To add one: take the id at the end of an iheart.com playlist URL |
| ~~Shazam~~ | — | — | Removed |
| Beatport, Traxsource | — | — | Cloudflare / 403 — apps can't read them. Don't scrape around bot checks. |

**Which charts a genre uses** is the user's choice: Settings → Discover stores `discoverCharts` (genre → ids)
in the settings store. `sourcesFor(genre, custom)` returns that pick, or the built-in `BY_GENRE` list. `chartsFor(genre)`
is what the picker offers: everything, except Billboard/Apple under genres they don't publish (`BILLBOARD`, `APPLE`).

**Where the pages come from.** Every chart page is read through `chartFetch()` (`src/lib/http.ts`). Signed in
to a Hub, that asks the Hub's chart cache (`GET /api/discover/fetch`, `hub/src/discover.ts`): one copy for
every device, refreshed by the Hub every 30 minutes while people use it, and the last good copy when the
source fails (Deezer's `200 {"error": "Quota limit exceeded"}` counts as a failure). Without a Hub, or with a
Hub older than this, it fetches directly as before. On top of that the app keeps each chart for 30 minutes
(**Refresh** skips that) and keeps the last copy that loaded, shown with a note when fetching again fails.

Previews: Deezer 30 s clips (`preview` on Deezer entries, or `deezerLookup()` on demand for others).

### Release Radar — `src/sources/releaseRadar.ts`, `hub/src/radar.ts`
**Artists you play** (any device, no Hub): your top ~60 artists (Navidrome play counts + stars + local
history) → Deezer artist search → albums released in the last 42 days. Cached per day (`tonearm.releaseRadar`).

**Following** (Hub): the Hub calls `GET /artist/:id/albums?limit=50` for each followed artist every 12 hours,
one at a time, and `GET /artist/:id/related?limit=20` + `GET /search/artist?q=` for suggestions. Deezer's
`200 {"error": …}` answers count as failures. Details in [RELEASE-RADAR.md](RELEASE-RADAR.md).

## Matching the same song across services — `src/lib/match.ts`
`findTrackOnSource()` searches a library for `artist + title`, compares normalised titles (dropping
`(feat…)`, `[Remaster]`, track numbers) and the **primary** artist (`"A Featuring B & C"` → `A`). Used for
"in your library?" in Discover, exporting playlists between servers, and queueing Plex tracks to SUB/WAVE.
