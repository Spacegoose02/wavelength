# User guide

How to use newer features: browsing Deezer by artist, album and playlist in **Downloads**, choosing which
charts **Discover** shows (both 0.6.0), and the **equalizer**. For how they're built, see the developer notes at the
end of each section and [SOURCES.md](SOURCES.md).

---

## Browse Deezer by artist, album and playlist

**Where:** Downloads → **Deezer** tab. You need a deemix server URL in Settings → deemix.

Before this, the Deezer tab only listed albums and songs that matched your search. Now you can open
an artist, an album or a playlist and browse the way you would in a streaming app, then send exactly
what you want to deemix.

### 1. Search

Type an artist, album, playlist or song. Results come in four groups: **artists** first, then
**albums** (singles and EPs are tagged), then **playlists**, then **songs**.

<p align="center">
  <img src="screenshots/deezer-search.png" alt="Deezer search results: artists with fan counts and a Browse button, then albums and songs with Get buttons" width="88%">
</p>

- **Browse** (or clicking an artist's name) opens the artist page.
- Clicking an album or a playlist opens its page.
- On a song row, the artist name and album name are links too.
- **Get** sends that album or song to deemix straight away, as before.

### 2. Artist page

<p align="center">
  <img src="screenshots/deezer-artist.png" alt="Artist page: photo, fan count, release count, Get discography button and the artist's top songs" width="88%">
</p>

- **Top songs**: the artist's 10 most played songs on Deezer. ▶ plays a 30-second preview and
  **Get** downloads that song.
- **Get discography** sends every release by the artist to deemix. You'll be asked to confirm,
  since that can be a lot of music.

Scroll down for the whole discography, newest first, split into **Albums**, **EPs**, **Singles**
and **Compilations**. Each cover opens the album page, and each has its own **Get** button.
Below that, **Playlists with …** shows public playlists the artist is on, and **Fans also like**
lists related artists so you can keep exploring.

<p align="center">
  <img src="screenshots/deezer-discography.png" alt="Discography grid: albums with year and a Get button under each, then EPs" width="88%">
</p>

### 3. Album page

<p align="center">
  <img src="screenshots/deezer-album.png" alt="Album page: cover, year, track count, length and label, a Get album button and a numbered tracklist with preview and Get buttons" width="88%">
</p>

- **Get album** downloads the whole album.
- Or pick songs one by one: each track has ▶ (30-second preview) and **Get**.
- The artist name under the title goes back to the artist page.

### 4. Playlist page

Search for a mood, genre or playlist name (for example *Electronic Hits*) and the matching public
playlists show up, tagged **playlist**, with who made them and how many songs they have.

<p align="center">
  <img src="screenshots/deezer-search-playlists.png" alt="Search results with playlists tagged PLAYLIST, showing the creator and track count, each with a Get button" width="88%">
</p>

<p align="center">
  <img src="screenshots/deezer-playlist.png" alt="Playlist page: cover, creator, track count, total length, fans, description, a Get playlist button and the song list" width="88%">
</p>

- **Get playlist** sends every song in the playlist to deemix (you'll be asked first if it has more
  than 50 songs). With its default settings, deemix saves them in a folder named after the playlist.
- Or pick songs one by one with ▶ (preview) and **Get**. Each song's artist and album are links.
- Long playlists load in full, up to 2,000 songs.
- Only public playlists can be found; private ones (including your own private Deezer playlists)
  aren't visible to the public API.

### Getting around

- The bar above every page shows where you are, e.g. **Results / Tame Impala / Currents**.
  **Back** goes one step back and **Results** jumps back to your search.
- Typing a new search always takes you back to the results.
- The **deemix queue** on the right keeps updating while you browse, so you can see downloads finish.
- Everything works with a TV remote: titles, links and buttons are all focusable.

> **Developer notes.** Deezer's public API, no login: `GET /artist/<id>`, `/artist/<id>/top`,
> `/artist/<id>/albums`, `/artist/<id>/related`, `/artist/<id>/playlists`, `/album/<id>` and
> `/playlist/<id>` (+ `/playlist/<id>/tracks` paging), wrapped by `getDeezerArtist()`, `getDeezerAlbum()` and
> `getDeezerPlaylist()` in `src/sources/deemix.ts`. The pages live in `src/views/DeezerBrowse.tsx`, and the
> Deezer tab in `src/views/Downloads.tsx` keeps a small stack of opened pages. **Get** on any row
> sends that item's deezer.com link to deemix's `addToQueue`. deemix accepts playlist and artist links
> too (an artist link queues the whole discography).

---

## Choose which charts Discover uses

**Where:** Settings → **Discover charts**, or the **Edit charts** button at the top of Discover.

Each Discover genre (Top overall, Pop, Country …) shows a tab per chart and a **Mix** that combines
them. You can now choose those charts for each genre yourself.

<p align="center">
  <img src="screenshots/discover-charts-settings.png" alt="Settings, Discover charts: genre chips, then checkboxes grouped by Billboard, Apple Music, Deezer, Deezer editors, RadioWave and iHeartRadio, with the defaults marked" width="88%">
</p>

1. Pick a genre from the chips. A genre you've changed has a • after its name.
2. Tick or untick charts. Charts that genre uses out of the box are marked **default**.
3. Discover updates right away: the new charts appear as tabs, and the Mix is rebuilt from them.
4. **Reset to defaults** puts that genre back the way it shipped.

What you can add:

- **iHeartRadio, RadioWave, Deezer editors' playlists and the Deezer global chart** are single fixed
  lists, so you can add them to any genre. In the screenshot, iHeartRadio's *Pop Top 40* has been
  added to Country.
- **Billboard and Apple Music** only appear under genres they actually publish (for example, Billboard
  has no current rap chart).
- Every genre keeps at least one chart, so the last ticked box can't be cleared.

Charts are still checked for freshness: one that hasn't updated recently is skipped with a note,
whether you picked it or not.

> **Developer notes.** Choices are stored as `discoverCharts` (genre → chart ids) in the settings
> store (`tonearm.settings`). A genre with no entry uses the built-in `BY_GENRE` list.
> `sourcesFor(genre, custom)` in `src/sources/charts.ts` resolves what a genre uses, `chartsFor(genre)`
> says which charts are allowed for it, and `getMix(genre, sources)` mixes whatever list it's given.
> A new chart added to `CHART_LABELS` and `FETCHERS` shows up in the picker automatically.

---

## Equalizer

A 10-band equalizer with presets. There are three ways to open it:

- **Desktop:** the **EQ** button in the player bar, next to the queue button.
- **Now Playing** (phone and desktop): the **EQ** chip under the song title.
- **Settings → Equalizer**.

<img src="screenshots/equalizer.png" alt="Equalizer pop-over with the Bass boost preset" width="60%">

- **Presets.** Tap one to apply it: Flat, Bass boost, Treble boost, Loudness, Vocal, Podcasts & books,
  Rock, Pop, Electronic, Hip-hop, Jazz, Classical and Phone speaker. Picking a preset also turns the EQ on
  and lowers the preamp by the preset's biggest boost, so loud songs don't distort.
- **Sliders.** Each band goes from −12 to +12 dB, and moving one switches the preset to **Custom**.
  Double-click a slider to set it back to 0. **Pre** (preamp) changes the overall level before the bands.
- **Curve.** The green line shows the combined effect across 20 Hz to 20 kHz.
- **On/off.** The checkbox switches the EQ off without losing your settings. **Reset** goes back to Flat.

The EQ applies to everything Wavelength plays: music, radio, podcasts, audiobooks and downloaded songs.
Your settings are saved on this device.

**Phone speaker** is worth trying on Android. It cuts the deep bass a phone speaker can't play anyway
and lifts the mids, so music sounds louder and clearer.

**One limit.** Some radio stations and servers don't let the app process their audio (no CORS headers).
The EQ can't change those streams, and the panel shows a note while one is playing. The same streams
also show the idle visualiser animation.

> **Developer notes.** The bands and presets are in `src/player/eq.ts`, and the filter chain is in
> `ensureGraph()` in `src/player/engine.ts` (preamp → 31 Hz low shelf → 8 peaking bands, Q 1.41 → 16 kHz
> high shelf → analyser). Settings are stored as `eq` in the settings store. `store/player.ts` subscribes
> to them and calls `engine.setEq`, which ramps each gain over about 20 ms so dragging a slider doesn't click.
> The curve comes from `BiquadFilterNode.getFrequencyResponse` on a throwaway `OfflineAudioContext`. To
> add a preset, add an entry to `EQ_PRESETS` (10 gains, low to high).
