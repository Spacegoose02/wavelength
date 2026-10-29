# User guide

How to use newer features: browsing Deezer by artist, album and playlist in **Downloads**, choosing which
charts **Discover** shows (both 0.6.0), the **Now Playing visualizers** (including the DJ raccoon), the **equalizer**,
**skins and the Themes tab** (holiday themes, Seasonal and Random daily), **editing your radio stations** and
**profiles with a Wavelength Hub** (signing in, settings sync, managing people). For how they're built, see the
developer notes at the end of each section and [SOURCES.md](SOURCES.md).

---

## Browse Deezer by artist, album and playlist

**Where:** Downloads → **Deezer** tab. You need a deemix server URL in Settings → Downloads → deemix.

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

## Now Playing visualizers

Open **Now Playing** (tap the song in the player bar) and **tap the artwork** to switch to the next
visualizer. A label shows each one's name as you go. Keep tapping to cycle through them all and back
to the artwork. Wavelength remembers your pick for next time.

<img src="screenshots/now-playing-scenes.png" alt="The six Now Playing views: artwork, Halo, Oscilloscope, Starfield, Mirror spectrum, Pulse rings" width="80%">

| Visualizer | What it does |
|---|---|
| Artwork | The album cover (the default) |
| Halo | The cover in a circle, with a ring of spectrum bars around it that pulses with the bass |
| Oscilloscope | The live waveform, glowing, with short trails |
| Starfield | Stars fly toward you, faster on louder bass, with an extra push on each beat |
| Mirror spectrum | Spectrum bars mirrored top and bottom, bass in the middle and highs at the edges |
| Pulse rings | A ring ripples out from the cover on every beat |
| DJ raccoon | A raccoon DJ behind two decks (see below) |

Colours come from your skin's visualizer colours, so each skin gives them a different look.

Some radio stations and servers don't let the app read their audio (no CORS headers). On those, the
visualizers still move, but they follow a calm made-up pattern instead of the real music. The small
spectrum under the title does the same.

> **Developer notes.** The visualizers are in `src/components/Scenes.tsx`. `NowPlayingStage` replaces the
> cover in `NowPlaying.tsx`, and the current choice is `npScene` in the settings store. Each scene is a
> `Draw` function that gets a `Frame` (frequency bins, waveform, bass/mid/treble levels, a `beat` flag,
> the skin's `--viz-*` colours and the cover image) and draws on one square canvas every animation frame.
> To add one, write a `Draw`, add its id to `NpScene` (`store/settings.ts`), and add it to `SCENES` and `DRAW`.
> The audio reading (analyser → `freq`, `wave`, `bass`/`mid`/`treble`, `beat`, `transient`, or the calm
> made-up signal) is `createAudioReader()` in `src/player/analysis.ts`, shared by every scene.

### DJ raccoon

The last visualizer is a raccoon DJ. His fur is always raccoon grey, but his hoodie, headphones, record
labels and the deck lights take your skin's colours, so every skin dresses him differently. Holiday skins
give him a hat: a witch hat for Halloween, a pilgrim hat for Thanksgiving, a Santa hat for Christmas, an
Uncle Sam hat for July 4th and heart boppers for Valentine's Day.

<img src="screenshots/raccoon-dj.png" alt="The DJ raccoon in five skins: Neon synth, Christmas (Santa hat), July 4th (Uncle Sam hat), Thanksgiving (pilgrim hat) and Valentine's Day (heart boppers)" width="100%">

- **Playing:** his head bobs on each beat, his right hand scratches the record on sharp hits (claps,
  snares), his left hand rides the mixer, the mixer meters follow the bass, mids and highs, and the records spin.
- **Paused:** he sways slowly, blinks, yawns now and then and adjusts his headphones.
- **Streams the app can't read** (no CORS, see above): he sways gently to a made-up rhythm instead.

> **Developer notes.** `src/components/RaccoonDJ.tsx`. Unlike the other scenes he's an inline SVG, not a
> canvas drawing, so the drawing stays editable. Every frame writes `transform`/`opacity` straight onto
> named parts (`data-part="head"`, `arm-r`, …), with no React re-render. Colours are CSS in `styles.css`
> (`.raccoon .hoodie { fill: var(--accent) }`, …). Hats are all in the SVG and hidden; one rule per holiday
> skin shows the right one (`:root[data-skin='halloween'] .raccoon .hat-witch`). To give a new skin a
> hat, add a `<g className="hat hat-…">` and a matching rule.
## Equalizer

A 10-band equalizer with presets. There are three ways to open it:

- **Desktop:** the **EQ** button in the player bar, next to the queue button.
- **Now Playing** (phone and desktop): the **EQ** chip under the song title.
- **Settings → Playback**.

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

## Skins and themes

**Settings → Themes** changes the app's colours and chrome. Tap a card to switch; the choice is saved on this
device and applies straight away. The visualizers and the LCD follow the skin's colours too.
Every skin works on Windows, Android phones and tablets, and Android TV.

<img src="screenshots/themes.png" alt="Settings, Themes tab: Seasonal and Random daily switches, a search box, and the Holidays group with Halloween marked in season" width="80%">

- **Groups.** Skins are grouped as Classic, Retro, Neon, Lasers, Nuclear, Editor palettes, Holidays and Accessibility.
- **Search.** Type in the box to filter by name or group (for example "neon", "laser", "nuclear" or "light").
- **Live preview.** Point at a card (or move to it with the D-pad on TV) and the whole app shows that skin
  until you move away. Tap it to keep it.
- **Seasonal.** In the weeks around each holiday, the app switches to that holiday's skin by itself, then
  goes back to your pick afterwards. Your pick isn't changed. The windows are:

  | Holiday skin | When Seasonal shows it |
  | --- | --- |
  | Valentine's Day (rose and blush, a light skin) | Feb 7 – Feb 14 |
  | July 4th (navy, red and white, with fireworks) | Jun 28 – Jul 5 |
  | Halloween (pumpkin orange and witchy purple) | Oct 15 – Oct 31 |
  | Thanksgiving (harvest gold, cranberry, warm wood) | 10 days before US Thanksgiving to the day after |
  | Christmas (pine green, berry red, gold, a little snow) | Dec 1 – Dec 26 |

- **Random daily.** A different skin every day (holiday skins are left out). Picking a card by hand
  turns Random daily off. If Seasonal is on too, a holiday wins.
- The note under the switches says which skin you're seeing today and why.

You can also pick a holiday skin by hand at any time of year.

<img src="screenshots/neon-skins.png" alt="Skin picker with the neon skins, Blacklight UV selected" width="80%">

**Neon skins.** For a brighter, glowing look, try one of these alongside the default Neon synth, Vaporwave,
Synthwave sunset and Cyberpunk:

| Skin | Look |
| --- | --- |
| **Outrun** | Hot pink and orange chrome-sunset gradients over a faint purple laser grid. |
| **Laser grid** | Black with a cyan grid; cards, buttons and icons are glowing cyan outlines. |
| **Acid rave** | Toxic lime green with UV magenta, rounded and loud. |
| **Miami nights** | Flamingo pink and teal neon-sign glow on deep purple. |
| **Blacklight UV** | Deep violet with highlighter yellow and pink, like a blacklight poster. |
| **Electric** | Arc-welder blue and violet with a white-hot glow. |
| **Neon diner** | Cherry red and teal, like a roadside diner sign. |
| **Neon lime** | Electric lime and orange on charcoal. |
| **Neon ice** | Cold white-blue tubes on navy. |

<img src="screenshots/nuclear-laser-skins.png" alt="Settings, Themes tab: the Neon, Lasers and Nuclear groups, Laser grid magenta selected" width="80%">

**Laser skins.** Under **Lasers**, next to Laser grid:

| Skin | Look |
| --- | --- |
| **Laser grid magenta / amber / green / violet** | Laser grid's glowing outlines on a black grid, in hot magenta, amber, phosphor green or ultraviolet. |
| **Laser show** | Blue, green and magenta beams fanning up through haze; rainbow buttons and progress bar. |
| **Red laser** | Crimson outlines and diagonal beams on black, square corners, like targeting sights. |
| **Green laser** | A green beam cutting through fog, with lime highlights. |
| **Laser harp** | Vertical violet and blue light strings over deep indigo, rounded and soft. |
| **Laser tag** | A blacklit arena: team orange against team cyan. |

**Nuclear skins.** Under **Nuclear**:

| Skin | Look |
| --- | --- |
| **Cherenkov (reactor core)** | Cherenkov blue glowing up from the bottom of the screen, like a cooling pool. |
| **Meltdown** | A molten core: white-hot through orange to scorched red. |
| **Radiation hazard** | Warning yellow on black, square and bold, with hazard-tape stripes on the player bar. |
| **Fallout shelter** | Olive drab, civil-defence yellow and rust, with a green Geiger-counter LCD. |
| **Uranium glass** | Vaseline-glass green fluorescing under UV, with big round corners. |
| **Nuclear** | Toxic green and hazard yellow glow. |
| **Radium** | Glow-in-the-dark watch-dial green on black. |
| **Isotope** | Plutonium violet with a hazard-yellow edge on cards and the player bar. |

All of these are part of the **Random daily** rotation. They aren't holiday skins, so **Seasonal** never picks them.

**Other skins worth knowing.** **OLED black** uses true black so OLED phone screens switch those pixels off,
which saves battery. **High contrast** is yellow on black with thick outlines and strong focus rings, for low
vision or bright sunlight. **Sakura**, **Solarized Light** and **Valentine's Day** are light skins.

> **Developer notes.** A skin is a `:root[data-skin='…']` block of CSS variables in `src/styles.css` plus a
> `.skin-card.<id> .skin-preview` rule for its picker card, and an entry in `SKINS` (`store/settings.ts`)
> with its `group` (one of `SKIN_GROUPS`). Recipe: [CONTRIBUTING.md](CONTRIBUTING.md#add-a-skin). Skin rules
> must sit at the top level of `styles.css`; one inside a `@media (max-width: 760px)` block only applies at
> phone width, which is what broke seven skins on Windows in 0.7.0.
>
> The saved `skin` is what the user picked. What's on screen is worked out in `App.tsx`:
> `useUi.previewSkin` (hover preview, never saved) if set, else `activeSkin()` from `src/lib/seasons.ts`,
> which applies Seasonal (`seasonal`, holiday windows in `SEASONS`) and Random daily (`randomDaily`,
> a hash of the local date). `App` re-checks every 10 minutes while either mode is on, so it rolls over at
> midnight. Everything uses the device's local date; nothing needs a server.

## Settings tabs

Settings is split into tabs: **Account** (Wavelength Hub sign-in), **Users** (Hub admins only), **Sources** (servers), **Playback** (equalizer), **Downloads** (deemix and
yt-dlp), **Themes** and **Discover** (charts). Links elsewhere open the right tab: **Edit charts** on
Discover opens Discover, and the Settings link in Downloads opens Downloads.

> **Developer notes.** `src/views/Settings.tsx`, one component per tab. The route can name a tab:
> `go({ view: 'settings', tab: 'themes' })` (`SettingsTab` in `store/ui.ts`).

## Editing your radio stations

**Radio → Your stations** lists the stations on your Navidrome and SUB/WAVE servers. Tap **Edit** next to
the heading to change them:

<img src="screenshots/radio-edit.png" alt="Radio, Your stations in edit mode: move arrows, Hide and Delete on each station, and a hidden station with a Show button" width="80%">

- **Reorder** with the ◀ ▶ arrows, or drag a station onto another on desktop.
- **Hide** removes a station from the row on this device only. Hidden stations are listed under the row
  while editing, each with **Show** to bring it back.
- **Delete** (Navidrome stations only) removes the station from the Navidrome server for everyone. Navidrome
  only lets admin accounts do this; if your account isn't an admin you'll get an error, and you can hide it instead.
- Tap **Done** when you're finished.

Your **Favorites** (stations you hearted, and streams you added by URL) have ▲ ▼ arrows to reorder them,
and the heart removes one.

> **Developer notes.** `src/views/Radio.tsx`. Hidden stations and the order are `hiddenStations` and
> `stationOrder` in the settings store, keyed `<sourceId>:<stationId>` because ids are only unique per
> server. Stations the order doesn't know yet go at the end. Delete calls `deleteStation` on the source
> (`deleteInternetRadioStation` in `sources/navidrome.ts`); Navidrome enforces the admin check. When the
> Wavelength Hub arrives (see [USERS-AND-ADMIN.md](USERS-AND-ADMIN.md)) the hidden list and order are
> meant to sync per user; today they're per device.

## Profiles with a Wavelength Hub

If your household runs a [Wavelength Hub](HUB.md), everyone gets their own profile. Without one, nothing
changes: Wavelength works on its own, as before.

### Signing in

**Settings → Account**: type the Hub's address (e.g. `https://hub.example.com`) and press **Connect**.

- **Sign in with a code** is the easy way, and the only comfortable one on a TV. Wavelength shows a code and
  a QR code. Scan it with your phone (or open the address shown and type the code), sign in there with single
  sign-on (tinyauth) or your Hub password, and press **Allow**. The TV signs itself in a moment later.
- **Sign in with a password** signs in with your Hub username and password directly.
- On a brand-new Hub, the Account tab offers **Set up this Hub** instead: that creates the first admin (you).

<p align="center"><img src="screenshots/hub-sign-in.png" alt="Signing in with a code and QR code" width="80%"></p>

### What follows you between devices

Once you're signed in, your **theme** (and Seasonal / Random daily), **equalizer**, **Now Playing scene**,
**radio stations** (favorites, hidden and order) and **Discover chart picks** sync to your profile. Change the
skin on the TV and your phone has it next time it checks in (at start, when the window gets focus, and every
few minutes; **Sync now** does it at once). Each setting syncs on its own, so changing the EQ on one device and
the skin on another never overwrite each other. Changes made with no connection are kept and sent later.

Server logins (Sources), download settings and downloaded music stay on each device. **Downloaded music always
plays**, signed in or not, with or without the Hub.

<p align="center"><img src="screenshots/hub-account.png" alt="Settings → Account when signed in" width="80%"></p>

### Linking single sign-on to your account

If you've been signing in with a Hub password and want to use tinyauth instead, link the two once. Either:

- **From the app:** Settings → Account → **Link single sign-on**. Open the link it shows (or scan its QR code)
  in a browser, sign in to tinyauth, press **Link**, then press **Done** in the app.
- **From the browser:** start **Sign in with a code** and choose single sign-on. If tinyauth knows you but no
  Wavelength account is linked yet, the page asks for your Wavelength username and Hub password once, links
  them, and carries on signing in the device.

After that, single sign-on is enough; your Hub password keeps working too. **Unlink** is in the same place
(only if you have a Hub password, so you can't lock yourself out).

### Your devices

Settings → Account lists every device signed in to your profile. **Sign out** next to one (a lost phone, an old
TV) and it's signed out at once.

### Managing people (admins)

Admins get a **Users** tab:

- **Add someone**: username, display name, role, and a Hub password and/or their tinyauth username.
- **Role**: Admin, Member or Kid. Changes apply straight away, no re-login.
- **Autodownload** (members only): lets them download without your approval once requests arrive. Kids can never have it.
- **Set password**, **SSO** (link or unlink their tinyauth username), **Turn off** (signs out all their devices), **Delete**.
- **Signed-in devices**: everyone's devices, with **Sign out**.
- **Activity**: recent sign-ins and admin changes.

The Hub refuses every one of these actions from a non-admin, so hiding the tab isn't what protects them.

<p align="center"><img src="screenshots/hub-users.png" alt="Settings → Users" width="80%"></p>

> **Developer notes.** `src/views/HubSettings.tsx` (Account and Users tabs), `src/sources/hub.ts` (typed API
> client), `src/store/hub.ts` (signed-in profile, persisted as `tonearm.hub`; `useCan(perm)` is true for
> everything when no Hub is signed in), `src/lib/hubSync.ts` (settings sync: per-key last-writer-wins with
> change times in `tonearm.hubStamps`, pushed 2 s after a change). Add a setting to sync by adding its
> `useSettings` key to `SYNCED`. The Hub side is documented in [HUB.md](HUB.md).
