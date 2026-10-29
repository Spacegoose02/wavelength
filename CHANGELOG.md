# Changelog

## Unreleased
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
