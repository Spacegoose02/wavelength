# Changelog

## Unreleased
- **Tidy genres** (Hub admins): one genre per kind of music, so "Hip Hop", "Trap" and "Rap/Hip Hop" all become
  **Rap; Hip-Hop**, "Dance Pop" becomes **Pop**, and "EDM", "House" and "Techno" become **Electronic**. New downloads
  get the tidy genre before Navidrome adds them. **Settings → Server → Genres → Review library genres** lists the
  albums already in your library whose genre isn't tidy: apply one, the ones you tick, or all, with **Undo**. Genres
  the Hub doesn't know yet are listed so you can pick what each becomes. The rules can be edited there.
- **Hub:** `/api/admin/genres`, `/api/admin/genres/review`, `/api/admin/genres/apply`, `/api/admin/genres/keep`.
- **Clean versions list:** **Inbox → Clean versions** lists every explicit album the library check found a
  clean version of on Deezer. Preview each one, download it on its own, or tick several (or **Select all**)
  and **Download selected** / **Download all**. Each row shows Queued, Downloading, Downloaded or Failed, and
  albums already in your library or already sent are skipped. **Settings → Users → Kid-safe music** links to it.

## 0.13.1
- **Fixed:** 0.13.0 didn't start on Windows or Android. The notification icon setting in `tauri.conf.json`
  made the notification plugin fail to load; the icon is now set on each notification instead.

## 0.13.0
- **Notifications** (with a Hub): a request that's ready, turned down or failed, something shared with you,
  and (admins) a new request show up as Windows, Android or browser notifications while Wavelength isn't in
  front. On or off per device under **Settings → Account → Notifications**.
- **Hub:** migration 15 (`notifications`) and `GET /api/notifications`.
- **Soulseek** (with a Hub and slskd): a **Soulseek** tab in Downloads searches the network and shows results
  by folder, best first, with format, size and whether there's a wait; **Download** gets the album. Admins can
  fill a request from Soulseek with **Soulseek…** in the Inbox. Set up under **Settings → Downloads**.
- **Hub:** service kind `slskd`, `/api/slskd/*`, and `slskd` on request approvals.
- **Logins in the OS keychain:** on Windows and Android, your Hub sign-in, server passwords and tokens, the
  deemix ARL and the share password are kept in Windows Credential Manager or the Android Keystore instead of
  the app's own storage. Existing ones move there on first start; nothing to do.
- **Edit artist** (Hub admins): rename an artist, or merge two spellings, in every song on all their albums,
  and set a genre for all of them. Every change is listed before saving, and it can be undone.
- **Tag suggestions:** the artist, album artist and genre boxes in the tag editors suggest names already in
  your library.
- **Delete album** (Hub admins): the files go to a hidden trash folder and can be put back from **Settings →
  Server → Deleted albums** for 30 days.
- **Hub:** migration 14 (`trash`), `/api/admin/tags/albums`, `/api/admin/tags/values`,
  `DELETE /api/admin/library/album/:id`, `/api/admin/trash/*`.
- **Containers** (Hub admins, optional): **Settings → Server → Containers** starts, stops and restarts the
  household's other services and shows their logs, through a Docker socket proxy and only for the containers
  you name.
- **Hub:** `WAVELENGTH_DOCKER_URL`, `WAVELENGTH_DOCKER_CONTAINERS`, `/api/admin/docker/*`.
- **Listen together** (with a Hub): start a party from the new button by the volume; everyone who joins
  hears the same song at the same moment on their own device. Guests can add songs, and skip and pause if
  the host allows it.
- **Hub:** `/api/together/*` (in memory, long polling).
- **Devices** (with a Hub): the new button by the volume shows your other open devices and what they're
  playing. Control them, or move playback: **Continue there** sends what's playing here to that device at the
  same spot, **Play here** brings it back. Turn it off per device under Settings → Account.
- **Hub:** `/api/me/remote/*` (in memory, long polling).
- **Rewind** (History → Rewind, with a Hub): your year or month in music, with top artists, songs and
  albums, minutes, streaks and when you listen. Play it, save it as a playlist, or share it as a picture.
- **Hub:** migration 13 (`plays`, filled from existing history), `/api/me/rewind`, `/api/me/rewind/periods`.

## 0.12.0
- **Invite links** (admins): **Settings → Users → Invite someone** makes a one-time link (and QR code) for a
  role. The person opens it, or pastes it in the app under **Settings → Account → I have an invite**, and picks
  their own username and password.
- **Restore a backup** from **Settings → Server**: the Hub checks the file, restarts and swaps it in, and
  keeps the database it replaced.
- **Hub:** migration 12 (`invites`), `/api/admin/invites`, `/invite/:code`, `/auth/invite`,
  `POST /api/admin/restore`. The Hub exits with code 75 to restart after a restore.
- **Tag editor** (admins): **Edit tags** on a Navidrome album fixes its tags in the files, by hand or from a
  Deezer / MusicBrainz match, with **Undo** (and **Settings → Server → Tag edits** for older saves). Navidrome
  rescans afterwards.
- **Hub:** migration 11 (`tag_edits`), `/api/admin/tags/*`, and `WAVELENGTH_NAVIDROME_MUSIC_DIR`.
- **Import a playlist** (Playlists → Import) from a Deezer, Spotify or YouTube Music link, or a CSV, M3U or
  text file. Songs you have become a Wavelength playlist; **Get missing** / **Request missing** handles the rest.
- **Hub:** `POST /api/import/youtube`; `/api/fetch` also reads Spotify's public pages.
- **Your playlists are yours.** Wavelength playlists and play history are now kept per person on the Hub:
  they follow you to every device, and on a shared device everyone sees only their own. Playlists already on
  a device become the first person's to sign in there.
- **Hub:** migration 10 (`user_playlists`, `play_history`) and `/api/me/playlists`, `/api/me/history`.
- **Kids' Navidrome password stays on the Hub.** Kids' devices reach Navidrome through the Hub with a login of
  their own (per device, so signing a device out ends it). The Hub swaps in the real login, refuses account
  changes, and won't stream a kid anything explicit or flagged, even to another app. **Send everyone through
  the Hub** (Settings → Server → Navidrome accounts) does the same for everyone.
- **Explicit / Clean switch** on albums the library has in both versions, and **Settings → Playback →
  Explicit and clean versions** to prefer one (synced; kids always get clean).
- **Hub:** `/nd/:id/rest/:method` relay and `relay` setting on the `navidrome` server kind.
- **Change cover art** (admins). Album and artist pages get **Change cover** / **Change picture**: look the
  art up on Deezer, Apple Music and MusicBrainz's Cover Art Archive (plus fanart.tv with a key), upload a
  picture, or paste an image link. It's kept on the Hub and shows on every device and in the browser, in song
  lists, the player and Now Playing too. **Use the server's picture** undoes it. Your music files aren't
  changed.
- **Hub:** migration 9 (`artwork`), the `/api/artwork`, `/api/art/:file` and `/api/admin/artwork` routes, and
  `WAVELENGTH_FANART_KEY`. Pictures are stored in the data folder under `artwork/`.
- **Everyone gets their own Navidrome account.** Admins add Navidrome and its admin login under **Settings →
  Server → Navidrome accounts**, then **Make account** (or **Use their login**) per person. Their devices get
  their own Navidrome login when they sign in; the admin login never leaves the Hub.
- **Listening now** in Settings → Server: who's playing what, on which device.
- **Hub:** `navidrome` server kind, `/api/admin/services/:id/users/:userId/navidrome-account`,
  `/api/me/playing`, `/api/admin/listening`.
- **"Your song is ready."** Approved requests now go *Downloading* → *Adding to your library* → *Ready*, and
  a ready one lights up the Inbox with a **Play** button that finds it in your library.
- **Navidrome rescans after downloads.** Add a Navidrome admin login under **Settings → Server → Library
  updates** and the Hub starts a scan as soon as downloads finish (also **Scan now**).
- **Hub:** migration 8 (request download tracking), `/api/admin/library` routes.
- **Wavelength in a browser.** Open your Hub's address in any browser to use Wavelength there. It goes
  straight to signing in to that Hub. Deezer, the charts and Release Radar work through the Hub; offline
  downloads still need the app. The Hub's Docker image now includes the web build (build it from the repo
  root: `docker build -f hub/Dockerfile .`).
- **Settings → Server** (admins): Hub version and uptime, free space on the music and data disks, whether the
  music folder is writable, yt-dlp's version, household counts, and **Download backup**.
- **Hub:** `/api/admin/server`, `/api/admin/backup`, `/api/fetch`, and `WAVELENGTH_WEB_DIR`.
- **Library check for explicit music.** **Settings → Users → Kid-safe music → Check my library** looks each
  album up on Deezer and records on the Hub which albums and songs are explicit, so kid profiles and the
  **E** / **C** badges work for files without the explicit tag, and for Plex. Your files aren't changed. It
  skips albums already checked, so it can be stopped and run again for new albums.
- **Get clean version.** An explicit album whose clean version is on Deezer gets a **Get clean version** button
  (**Request clean version** without Autodownload).
- New downloads: tick **Explicit lyrics** under deemix **Settings → Tags** so deemix writes the tag.
- **Hub:** migration 7 (`ratings`) and the `/api/ratings`, `/api/admin/ratings` routes.
- **Kid profiles.** Kids get a shorter menu with bigger buttons (Home, Search, Discover, Albums, Artists,
  Favorites, Radio, Audiobooks, **Ask for music**, Inbox and **Me**), and no Settings.
- **Bedtime and a daily listening limit** per kid, set by an admin under **Settings → Users → Kid profiles**.
  At bedtime or when the day's minutes are used up, the music stops and a "Time for bed" screen covers the
  app. Listening adds up across all the kid's devices.
- **Grown-up PIN.** Set once for the household. It unlocks 30 more minutes on the bedtime screen, and it's
  needed to sign out of a kid profile (**Me → Sign out**).
- **Hub:** migration 6 (`kid_rules`, `listening`, `hub_settings`) and the `/api/me/kid`, `/api/me/listened`,
  `/api/kid/unlock`, `/api/admin/kids` and `/api/admin/kid-pin` routes.
- **Kid-safe music.** On a kid profile, anything marked explicit (from your files' tags through Navidrome, or
  from Deezer) is hidden everywhere: albums, artists, search, playlists, favorites, Discover, Release Radar and
  Deezer browsing, and the player won't play it. Admins get a **Kids** button on every song, album and artist
  to hide something from kids or mark something explicit as fine, and a **Kid-safe music** list under
  **Settings → Users**. Flags are kept on the Hub and apply on every kid's device.
- **E** and **C** badges on explicit and clean songs and albums.
- **Hub:** new `content_flags` table (migration 5) and `/api/flags`, `/api/admin/flags` routes.
- **Request music.** Signed in to a Hub without Autodownload, **Get** becomes **Request** in Downloads, Discover
  and Release Radar, and you can paste a YouTube, SoundCloud or Bandcamp link too. Admins approve in the new
  **Inbox → To approve**: the Hub downloads it with deemix or yt-dlp, or they mark it as already in the library
  or reject it with a reason. You see the answer in **Inbox → My requests**. Admins and people with
  Autodownload still download straight away.
- **Share with each other.** A **Share** button on playlists, albums, artists, radio stations, songs and your
  favorites sends them to one person on your Hub or to everyone, with a note. They show up in **Inbox → Shared
  with you**, where **Play** finds the songs in your own library and **Save as playlist** keeps them.
- **Inbox** in the sidebar (and the phone's Library tab) with a count of new shares, answers and requests to
  approve. See the [user guide](docs/USER-GUIDE.md#requesting-music).
- **Hub:** new `requests`, `shares` and `share_seen` tables (migration 4) and the `/api/requests`,
  `/api/admin/requests`, `/api/people` and `/api/shares` routes. Update the Hub container along with the app.

## 0.11.0
- **In-app updates (Windows and Android).** Wavelength checks GitHub for a newer release on launch and every
  6 hours, shows a banner, and lists it in the new **Settings → Updates** tab with the release notes.
  **Install update** downloads the right file and installs it: on Windows the setup exe runs with a progress bar
  and reopens Wavelength (the portable `Wavelength.exe` is swapped in place); on Android the APK goes to the
  system installer (allow **Install unknown apps** for Wavelength the first time). **Include pre-releases** is
  off by default. The first version with this has to be installed by hand; updates after it don't. See the
  [user guide](docs/USER-GUIDE.md#updates).

## 0.10.0
- **Three more raccoons** in Now Playing: a **country** raccoon (cowboy hat, acoustic guitar, taps his boot),
  a **rapper** raccoon (cap, shades, gold chain, raps into the mic while the speakers pump) and a **rocker**
  raccoon (mohawk, leather jacket, flying-V, headbangs in front of the amps). Switch with the **Switch
  raccoon** button on the raccoon visualizer or in **Settings → Playback → Now Playing visualizer**, which
  also picks the visualizer. Both choices sync through a Wavelength Hub.
- **Raccoons dress for your theme**: hazmat suits and respirators on Nuclear skins, laser visors on Lasers,
  glow sticks on Neon, 8-bit shades on Retro and coder glasses on Editor palettes, on top of the holiday hats.
  See the [user guide](docs/USER-GUIDE.md#raccoons).
- **Server logins on your Hub.** Admins can keep Plex, Audiobookshelf, SUB/WAVE, deemix and yt-dlp logins on
  the Wavelength Hub (Settings → Sources / Downloads → **Move to Hub**), so signed-in devices get them without
  typing them in. Pick who can use each server (everyone, admins only, or chosen people) and give someone
  their own Plex or Audiobookshelf login. Members and kids never get the SUB/WAVE admin login, and download
  logins only go to admins and people with Autodownload. Logins are encrypted on the Hub. Navidrome logins stay
  on each device. See [HUB.md](docs/HUB.md#server-logins).
- **Admin logins stay on the Hub.** SUB/WAVE DJ controls, deemix and yt-dlp now go through the Hub, so no
  device (admins' included) holds the SUB/WAVE admin login, the deemix ARL or a network-share login. The Hub
  runs yt-dlp itself and saves straight into its music folder, so YouTube downloads work from phones and
  Android TV too. Every download is in the Hub's activity log with who queued it.

## 0.9.0
- **Settings has tabs**: Sources, Playback, Downloads, Themes and Discover. **Edit charts** on Discover and
  the Settings link in Downloads open the right tab.
- **Themes tab**: skins grouped (Classic, Retro, Neon, Lasers, Nuclear, Editor palettes, Holidays, Accessibility), a search box,
  and a live preview: point at (or D-pad to) a card and the whole app shows it until you move away.
  **Random daily** picks a different skin every day. See the [user guide](docs/USER-GUIDE.md#skins-and-themes).
- **5 holiday skins**: Halloween, Thanksgiving, Christmas, July 4th and Valentine's Day (light). **Seasonal**
  mode switches to each one in the weeks around the holiday and back to your pick afterwards.
- **5 nuclear skins** (Themes → Nuclear): Reactor core (Cherenkov blue), Meltdown (molten orange), Radiation
  hazard (warning yellow and hazard tape), Fallout shelter (olive drab with a Geiger-green LCD) and Uranium glass
  (UV-green glow). See the [user guide](docs/USER-GUIDE.md#skins-and-themes).
- **5 more laser skins** (Themes → Lasers, which Laser grid has moved into): Laser show (RGB beams), Red laser,
  Green laser, Laser harp (violet light strings) and Laser tag (orange vs. cyan). All ten new skins are in the
  Random daily rotation.
- **10 more glow skins**: Laser grid in magenta, amber, green and violet (Lasers); Nuclear, Radium and Isotope
  (Nuclear); Neon diner, Neon lime and Neon ice (Neon). Reactor core is now labelled Cherenkov (reactor core).
- **DJ raccoon** visualizer in Now Playing: he wears your skin's colours (and a hat on holiday skins), bobs on
  the beat, scratches on sharp hits and yawns when paused. See the [user guide](docs/USER-GUIDE.md#dj-raccoon).
- **Edit your radio stations**: Radio → Your stations → **Edit** to reorder (arrows or drag), hide stations on
  this device, or delete a Navidrome station from the server (Navidrome admin accounts only). Favorites can
  be reordered too. See the [user guide](docs/USER-GUIDE.md#editing-your-radio-stations).
- **Wavelength Hub (Phase 1, server side).** A new optional server, `hub/`, shipped as a Docker image with an
  Unraid template: user accounts with roles (admin, member, kid), sign-in with a Hub password or tinyauth
  single sign-on (through Nginx Proxy Manager), TV-style pairing codes for devices, per-device sign-out,
  synced preferences and an audit log. Admin-only routes are refused for members and kids on the server, not
  just hidden. See [docs/HUB.md](docs/HUB.md) and the roadmap in
  [docs/USERS-AND-ADMIN.md](docs/USERS-AND-ADMIN.md).
- **Sign in to a Wavelength Hub** (Settings → Account): connect, set up a new Hub, sign in with a code and QR
  code (approve it from your phone with tinyauth or your Hub password) or with a password. Your theme, EQ, Now
  Playing scene, radio stations and Discover chart picks then follow you to every device; downloaded music
  keeps playing offline. Link your tinyauth account to a password account (from the app or the browser),
  change your password, and sign out lost devices. Admins get **Settings → Users**: add people, roles,
  Autodownload, passwords, tinyauth usernames, turn accounts off, sign devices out, and recent activity. See the
  [user guide](docs/USER-GUIDE.md#profiles-with-a-wavelength-hub).

## 0.8.0
- **Fix: Dracula, Monokai, Solarized, OLED black, High contrast, Sakura and Cyberpunk didn't work on Windows.**
  A missing closing brace in `styles.css` (lost in a merge) put those skins, and the equalizer's styles, inside
  the phone-width media query, so on a desktop-sized window the skin picker showed blank cards and picking
  them did nothing. They now apply and preview at every window size; the EQ pop-over is also back in place on desktop.
- **6 new neon skins** (Settings → Skin), on Windows, Android phones/tablets and Android TV: Outrun (chrome
  sunset over a laser grid), Laser grid (glowing cyan outlines on black), Acid rave (toxic lime and magenta),
  Miami nights (flamingo pink and teal), Blacklight UV (violet with highlighter yellow) and Electric (arc blue
  and violet). See the [user guide](docs/USER-GUIDE.md#skins).
- **Releases now include the Windows installer and Android APK automatically.** Publishing a release on
  GitHub runs a build that attaches `Wavelength_X.Y.Z_x64-setup.exe`, `Wavelength.exe` and the signed
  `Wavelength-X.Y.Z-android.apk`. See [RELEASING.md](docs/RELEASING.md#automated-builds-github-actions).

## 0.7.0
- **Fix: downloaded songs stopped after a moment on Android.** Offline songs now load fully before playing on
  Android (desktop is unchanged), so they play to the end, seek normally and drive the visualiser.
- **Now Playing visualizers**: tap the artwork in Now Playing to cycle through Halo, Oscilloscope, Starfield,
  Mirror spectrum and Pulse rings (and back to the cover). They react to the music, use your skin's colours, and
  your choice is remembered. See the [user guide](docs/USER-GUIDE.md#now-playing-visualizers).
- **8 new skins** (Settings → Skin): Dracula, Monokai, Solarized Dark, Solarized Light, OLED black (true black for
  OLED phone screens), High contrast (yellow on black, thick outlines, strong focus rings), Sakura (light) and Cyberpunk.
- **Equalizer**: 10 bands with a preamp, 13 presets (including Phone speaker and Podcasts & books) and a live
  response curve. Open it with **EQ** in the player bar or in Now Playing, or in Settings → Equalizer. See the
  [user guide](docs/USER-GUIDE.md#equalizer).

## 0.6.0
- **Browse Deezer by artist, album and playlist** (Downloads → Deezer): search now finds artists and playlists too. Artist pages
  show top songs, the full discography (albums, EPs, singles, compilations) and related artists, with
  **Get discography**. Album and playlist pages show the tracklist with 30-second previews, **Get album** / **Get playlist** and per-track **Get**.
  Artist pages also list public playlists the artist is on.
- **Pick your Discover charts**: Settings → Discover charts (or **Edit charts** on Discover) chooses which
  charts each genre shows and mixes. iHeartRadio, RadioWave and Deezer lists can be added to any genre.
- New [user guide](docs/USER-GUIDE.md) with screenshots for both.

## 0.5.0 — first public release

Everything below, plus project documentation (`docs/`), brand assets and an MIT license.

## 0.4.1
- **Android media session**: steering-wheel, Bluetooth, headset and lock-screen controls; song info and
  artwork on car stereos; media notification; foreground playback service so music keeps going with the screen off.

## 0.4.0
- SUB/WAVE: cancel songs in Up next (✕) and cancel the rest of an album/artist block.
- **Android TV**: launcher banner, D-pad navigation with focus rings, remote media keys, 32-bit ARM build.
- 10 more skins: Tokyo Night, Catppuccin, Gruvbox, Nord, Everforest, Kanagawa, Rosé Pine, iPod Classic, Aqua, Walkman.

## 0.3.x
- Discover rebuilt on live charts: Billboard, Apple Music, Deezer, RadioWave Monitor and iHeartRadio editors; Shazam removed.
- **New releases** with **Release Radar** (new albums from the artists you play).
- Retro skins v2 (colour artwork, accent colours) + Windows 95, MS-DOS, Synthwave sunset, Arcade, '70s groove.
- Android: edge-to-edge insets (tablets, car head units), compact layout for short screens.
- Android 17: local-network permission; clearer connection errors.

## 0.2.0
- Offline downloads for albums and playlists.
- Discover previews (30 s) and Deezer editors' EDM charts.
- SUB/WAVE likes list, compact phone On-air card.
- Retro skins: Vaporwave, Green/Amber CRT, Game Boy, C64.

## 0.1.x
- Unified catalog across Navidrome, Plex and Audiobookshelf; radio; SUB/WAVE tab with admin
  (DJ control, schedule editor, shows, stats); deemix + yt-dlp downloads; History; Favorites;
  Recently added; mixed-source playlists with Navidrome/Plex sync; phone layout; Android APK; Neon synth brand.
