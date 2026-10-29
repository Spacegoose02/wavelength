<p align="center"><img src="brand/hero.png" alt="Wavelength" width="100%"></p>

# Wavelength brand

## Name & idea

**Wavelength** — every source you own, tuned to one signal. A radio-dial metaphor: your Navidrome,
Plex, audiobooks, podcasts and your own AI radio station are all "stations"; Wavelength is the
receiver that finds them.

**Tagline:** *Every source. One signal.*

Write it as **Wavelength** (one word, capital W). Never "WaveLength", "Wave Length" or "WL".

## Personality

Retro-futuristic and warm, not corporate. Equal parts **Plexamp** (big artwork, calm library) and
**Winamp** (the LCD, the spectrum, the skins). It respects people who self-host: no tracking, no
accounts, their servers.

**Voice:** short, plain, a little playful. Say what happened and what to do next.
- ✅ "Couldn't reach deemix — check its URL in Settings."
- ✅ "Too late — that song is already on its way to air."
- ❌ "Error 502: upstream request failed."

## Logo

| Asset | File | Use |
|---|---|---|
| App icon | [`brand/logo.png`](brand/logo.png) (1024²) | Windows/Android icons (generate all sizes with `npx tauri icon docs/brand/logo.png`) |
| Hero banner | [`brand/hero.png`](brand/hero.png) (1280×360) | README, release pages, social |
| TV banner | [`brand/tv-banner.png`](brand/tv-banner.png) (320×180) | Android TV launcher |

The mark is a **symmetric waveform of rounded bars** (an audio level meter) over a **retro
perspective grid** on deep navy. Bars run a vertical gradient **cyan → green → pink**, with a soft
cyan glow. In the app, the sidebar uses a small ring version (conic gradient of the same three colours).

Don't: recolour the bars outside the palette, put the mark on a light background without the navy
tile, stretch it, or add drop shadows.

## Colour — Neon synth (default skin)

| Role | Token | Hex |
|---|---|---|
| Background | `--bg` | `#0a0b14` |
| Surface | `--bg-2` | `#0f1120` |
| Panel | `--panel` | `#151830` |
| Panel (raised) | `--panel-2` | `#1e2244` |
| Line | `--line` | `#2a2f5c` |
| Text | `--text` | `#e8ecff` |
| Muted text | `--muted` | `#8c93c4` |
| **Accent — Cyan** | `--accent` | `#22d3ee` |
| **Signal — Green** | `--accent-3` | `#3dff9a` |
| **Glow — Pink** | `--accent-2` | `#ff4fd8` |

Gradients always flow **cyan → green → pink** (left→right or bottom→top). Primary buttons use
cyan→green; the play button uses cyan→pink. The LCD text is signal green.

## Type

- UI: **Segoe UI Variable** (system UI font on other platforms).
- Display / headings: Segoe UI Variable Display, bold, slightly tight tracking (−0.5 px on big titles).
- LCD & technical: **Cascadia Mono** (Consolas fallback).

No web fonts — the app must work offline and stay small.

## Skins

The brand is the Neon synth default, but the app is skinnable by design (52 skins: Winamp, Plexamp,
Windows 95, MS-DOS, Game Boy Color, C64, Green/Amber CRT, Vaporwave, Synthwave sunset, Arcade, '70s,
iPod Classic, Aqua, Walkman, the Omarchy palettes, Dracula, Monokai, Solarized Dark/Light, OLED black, High contrast, Sakura,
Cyberpunk and the neon set: Outrun, Acid rave, Miami nights, Blacklight UV and Electric; the laser set: Laser grid, Laser show, Red laser, Green laser, Laser harp and Laser tag;
the nuclear set: Reactor core, Meltdown, Radiation hazard, Fallout shelter and Uranium glass; and the holiday skins). Skins change colour and chrome, never layout.
Album art always keeps its real colours.

## Screenshots

[`screenshots/`](screenshots) holds the README images. Retake them with a demo profile and a demo
station — **never with real server names, URLs or listening history**.
