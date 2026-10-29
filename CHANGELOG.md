# Changelog

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
