# Changelog

## Unreleased
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
