import { create } from 'zustand';
import type { ReplayGainMode } from '../player/replayGain';
import { createJSONStorage, persist } from 'zustand/middleware';
import { secretStorage } from '../lib/secrets';
import type { SourceConfig, Station } from '../sources/types';
import type { ChartSource, Genre } from '../sources/charts';
import { DEFAULT_EQ, type EqSettings } from '../player/eq';
import type { SmartPlaylist } from '../lib/smartPlaylists';
import type { DontPlay } from '../../hub/src/api/dontPlay';
import type { MotionPref } from '../lib/motion';
import { cleanTune, DEFAULT_TUNE, type MouthTune } from '../player/voice';
import type { StreamQuality } from '../lib/streamQuality';

export type Skin = 'neon' | 'plexamp' | 'winamp' | 'vaporwave' | 'crt' | 'amber' | 'gameboy' | 'c64' | 'win95' | 'dos' | 'sunset' | 'arcade' | 'seventies'
  | 'tokyonight' | 'catppuccin' | 'gruvbox' | 'nord' | 'everforest' | 'kanagawa' | 'rosepine' | 'ipod' | 'aqua' | 'walkman'
  | 'dracula' | 'monokai' | 'solarized' | 'solarizedlight' | 'oled' | 'contrast' | 'sakura' | 'cyberpunk'
  | 'outrun' | 'lasergrid' | 'acid' | 'miami' | 'blacklight' | 'electric'
  | 'lasershow' | 'laserred' | 'lasergreen' | 'laserharp' | 'lasertag'
  | 'reactor' | 'meltdown' | 'hazard' | 'fallout' | 'uranium'
  | 'gridmagenta' | 'gridamber' | 'gridgreen' | 'gridviolet' | 'nuclear' | 'radium' | 'isotope' | 'diner' | 'lime' | 'ice'
  | 'halloween' | 'thanksgiving' | 'christmas' | 'july4' | 'valentine';

/** What the Now Playing artwork slot shows: the cover, or one of the visualizer scenes (components/Scenes.tsx). */
export type NpScene = 'art' | 'radial' | 'scope' | 'stars' | 'mirror' | 'rings' | 'raccoon';

/** Who plays in the critter scene (`npScene: 'raccoon'`, named before there were other critters): components/critters/species.tsx. */
export type Species = 'raccoon' | 'shark' | 'alien' | 'grey' | 'bear-black' | 'bear-brown' | 'moose' | 'turtle' | 'elephant' | 'tiger' | 'lion' | 'panda' | 'owl' | 'trex' | 'monkey' | 'flamingo' | 'gorilla'
  | 'penguin' | 'fox' | 'axolotl' | 'sloth' | 'octopus' | 'dragon' | 'frog' | 'bunny' | 'red-panda' | 'turkey';

/** Boy or girl critters (Settings → Playback → Critters). */
export type CritterLook = 'boy' | 'girl';

/** What the critter plays: components/critters/Critter.tsx (`ACTS`). Any species can play any act. */
export type Act = 'dj' | 'country' | 'rapper' | 'rocker' | 'drums' | 'theremin' | 'synth' | 'accordion' | 'drive' | 'reactor' | 'bongo' | 'piano' | 'marimba' | 'violin' | 'acoustic' | 'surf' | 'singer';

/** Acts that were retired (0.37), and the act that took each one's place, for a pick saved before. */
export const RETIRED_ACTS: Record<string, Act> = { sax: 'surf', harp: 'acoustic', tuba: 'singer' };

/** The single critter pick from 0.17.7–0.17.8 (`raccoon` setting), as a species and an act. */
export function critterFromOldPick(old: unknown): { critter: Species; act: Act } {
  switch (old) {
    case 'country': case 'rapper': case 'rocker': return { critter: 'raccoon', act: old };
    case 'shark': return { critter: 'shark', act: 'drums' };
    case 'alien': return { critter: 'alien', act: 'theremin' };
    case 'grey': return { critter: 'grey', act: 'synth' };
    case 'bear-black': case 'bear-brown': return { critter: old, act: 'accordion' };
    default: return { critter: 'raccoon', act: 'dj' };
  }
}

/** Headings in Settings → Themes, in display order. */
export const SKIN_GROUPS = ['Classic', 'Retro', 'Neon', 'Lasers', 'Nuclear', 'Editor palettes', 'Holidays', 'Accessibility'] as const;
export type SkinGroup = (typeof SKIN_GROUPS)[number];

export const SKINS: { id: Skin; label: string; group: SkinGroup }[] = [
  { id: 'neon', label: 'Neon synth (default)', group: 'Classic' },
  { id: 'plexamp', label: 'Midnight (Plexamp-inspired)', group: 'Classic' },
  { id: 'winamp', label: 'Classic (Winamp-inspired)', group: 'Classic' },
  { id: 'vaporwave', label: 'Vaporwave', group: 'Retro' },
  { id: 'crt', label: 'Green CRT terminal', group: 'Retro' },
  { id: 'amber', label: 'Amber CRT', group: 'Retro' },
  { id: 'gameboy', label: 'Game Boy Color', group: 'Retro' },
  { id: 'c64', label: 'Commodore 64', group: 'Retro' },
  { id: 'win95', label: 'Windows 95', group: 'Retro' },
  { id: 'dos', label: 'MS-DOS (Norton blue)', group: 'Retro' },
  { id: 'sunset', label: 'Synthwave sunset', group: 'Retro' },
  { id: 'arcade', label: 'Arcade cabinet', group: 'Retro' },
  { id: 'seventies', label: "'70s groove", group: 'Retro' },
  { id: 'ipod', label: 'iPod Classic', group: 'Classic' },
  { id: 'aqua', label: 'Aqua (Mac OS X)', group: 'Classic' },
  { id: 'walkman', label: 'Walkman', group: 'Classic' },
  { id: 'tokyonight', label: 'Tokyo Night (Omarchy)', group: 'Editor palettes' },
  { id: 'catppuccin', label: 'Catppuccin (Omarchy)', group: 'Editor palettes' },
  { id: 'gruvbox', label: 'Gruvbox (Omarchy)', group: 'Editor palettes' },
  { id: 'nord', label: 'Nord (Omarchy)', group: 'Editor palettes' },
  { id: 'everforest', label: 'Everforest (Omarchy)', group: 'Editor palettes' },
  { id: 'kanagawa', label: 'Kanagawa (Omarchy)', group: 'Editor palettes' },
  { id: 'rosepine', label: 'Rosé Pine (Omarchy)', group: 'Editor palettes' },
  { id: 'dracula', label: 'Dracula', group: 'Editor palettes' },
  { id: 'monokai', label: 'Monokai', group: 'Editor palettes' },
  { id: 'solarized', label: 'Solarized Dark', group: 'Editor palettes' },
  { id: 'solarizedlight', label: 'Solarized Light', group: 'Editor palettes' },
  { id: 'oled', label: 'OLED black (saves battery)', group: 'Accessibility' },
  { id: 'contrast', label: 'High contrast', group: 'Accessibility' },
  { id: 'sakura', label: 'Sakura (light)', group: 'Classic' },
  { id: 'cyberpunk', label: 'Cyberpunk', group: 'Neon' },
  { id: 'outrun', label: 'Outrun (neon)', group: 'Neon' },
  { id: 'acid', label: 'Acid rave (neon)', group: 'Neon' },
  { id: 'miami', label: 'Miami nights (neon)', group: 'Neon' },
  { id: 'blacklight', label: 'Blacklight UV (neon)', group: 'Neon' },
  { id: 'electric', label: 'Electric (neon)', group: 'Neon' },
  { id: 'diner', label: 'Neon diner', group: 'Neon' },
  { id: 'lime', label: 'Neon lime', group: 'Neon' },
  { id: 'ice', label: 'Neon ice', group: 'Neon' },
  { id: 'lasergrid', label: 'Laser grid (neon)', group: 'Lasers' },
  { id: 'gridmagenta', label: 'Laser grid magenta', group: 'Lasers' },
  { id: 'gridamber', label: 'Laser grid amber', group: 'Lasers' },
  { id: 'gridgreen', label: 'Laser grid green', group: 'Lasers' },
  { id: 'gridviolet', label: 'Laser grid violet', group: 'Lasers' },
  { id: 'lasershow', label: 'Laser show', group: 'Lasers' },
  { id: 'laserred', label: 'Red laser', group: 'Lasers' },
  { id: 'lasergreen', label: 'Green laser', group: 'Lasers' },
  { id: 'laserharp', label: 'Laser harp', group: 'Lasers' },
  { id: 'lasertag', label: 'Laser tag', group: 'Lasers' },
  { id: 'reactor', label: 'Cherenkov (reactor core)', group: 'Nuclear' },
  { id: 'meltdown', label: 'Meltdown', group: 'Nuclear' },
  { id: 'hazard', label: 'Radiation hazard', group: 'Nuclear' },
  { id: 'fallout', label: 'Fallout shelter', group: 'Nuclear' },
  { id: 'uranium', label: 'Uranium glass', group: 'Nuclear' },
  { id: 'nuclear', label: 'Nuclear', group: 'Nuclear' },
  { id: 'radium', label: 'Radium', group: 'Nuclear' },
  { id: 'isotope', label: 'Isotope', group: 'Nuclear' },
  { id: 'halloween', label: 'Halloween', group: 'Holidays' },
  { id: 'thanksgiving', label: 'Thanksgiving', group: 'Holidays' },
  { id: 'christmas', label: 'Christmas', group: 'Holidays' },
  { id: 'july4', label: 'July 4th', group: 'Holidays' },
  { id: 'valentine', label: "Valentine's Day", group: 'Holidays' },
];

/** CSS slug for a skin's group (`data-skin-group` on <html>): classic, retro, neon, lasers, nuclear, editor, holidays, accessibility. */
export const skinGroup = (skin: Skin) => (SKINS.find((s) => s.id === skin)?.group ?? 'Classic').split(' ')[0].toLowerCase();

interface SettingsState {
  sources: SourceConfig[];
  stations: Station[];
  /** The skin the user picked. What's on screen can differ: see `activeSkin` in lib/seasons.ts. */
  skin: Skin;
  /** Switch to the holiday skin in the weeks around each holiday, then back to `skin`. */
  seasonal: boolean;
  /** A different (non-holiday) skin each day. */
  randomDaily: boolean;
  /** Radio → Your stations: `${sourceId}:${id}` keys hidden on this device. */
  hiddenStations: string[];
  /** Radio → Your stations: `${sourceId}:${id}` keys in the order the user arranged them. Unknown ones go last. */
  stationOrder: string[];
  /** Radio → Your stations: show them in genre groups (lib/stationLabel.ts) instead of one list in `stationOrder`. */
  stationGroups: boolean;
  deemix: { url: string; arl: string; bitrate: number };
  ytdlp: { outDir: string; format: string; bin: string; shareUser: string; sharePass: string; /** Folder inside the Hub's music folder, when the Hub runs yt-dlp. */ hubFolder: string };
  /** Discover: which charts each genre uses. A genre that isn't listed uses the built-in defaults. */
  discoverCharts: Partial<Record<Genre, ChartSource[]>>;
  /** Discover: songs marked "Not interested" (sources/charts.ts songKey), newest last, at most 500. */
  discoverHidden: string[];
  setDiscoverHidden(key: string, hidden: boolean): void;
  npScene: NpScene;
  setNpScene(s: NpScene): void;
  /** the critter scene's pick: who plays (`critter`) and what (`act`) */
  critter: Species;
  setCritter(c: Species): void;
  act: Act;
  setAct(a: Act): void;
  /** Boy or girl critters: the girl look adds lashes and a bow in the skin's accent colour (critters/faces.tsx). */
  critterLook: CritterLook;
  setCritterLook(l: CritterLook): void;
  eq: EqSettings;
  setEq(e: Partial<EqSettings>): void;
  /** The critter mouth tuner (components/MouthTuner.tsx, player/voice.ts). Synced. */
  mouthTune: MouthTune;
  setMouthTune(t: Partial<MouthTune> | null): void;
  /** Lyrics offsets for single songs, seconds, by `sourceId:trackId` (player/singing.ts `offsetKey`). Synced. */
  mouthOffsets: Record<string, number>;
  setMouthOffset(key: string, seconds: number): void;
  /** Discord status on this computer (lib/discord.ts). Not synced: the app ID is, the switch isn't. */
  discord: { on: boolean; appId: string };
  /** Desktop extras (lib/desktop.ts), per computer: Ctrl+Alt hotkeys, and closing the window to the tray. */
  desktop: { hotkeys: boolean; closeToTray: boolean };
  setDesktop(p: Partial<SettingsState['desktop']>): void;
  setDiscord(p: Partial<SettingsState['discord']>): void;
  /** The talking DJ (lib/djVoice.ts): a spoken link between songs. Synced, except the device voice (and whether to use it) is per device. */
  djVoice: DjVoiceSettings;
  setDjVoice(p: Partial<DjVoiceSettings>): void;
  /** Settings → Playback: ReplayGain (player/replayGain.ts) and crossfade between songs (seconds, 0 = off). */
  playback: { replayGain: ReplayGainMode; replayGainPreamp: number; crossfade: number; /** player/automix.ts */ automix?: boolean };
  setPlayback(p: Partial<SettingsState['playback']>): void;
  /** Albums the library has as both an explicit and a clean version: show both, or only the preferred one (lib/versions.ts). */
  versions: 'both' | 'clean' | 'explicit';
  setVersions(v: SettingsState['versions']): void;
  /** "Don't play this" (lib/dontPlay.ts): left out of radio, mixes, DJ mode and Smart Shuffle; synced. */
  dontPlay: DontPlay;
  setDontPlay(d: DontPlay): void;
  /** Reduce motion (lib/motion.ts): follow the system, always, or never. Synced. */
  motion: MotionPref;
  setMotion(m: MotionPref): void;
  /** Smart Shuffle (lib/smartShuffle.ts): shuffle with songs you might like mixed in. */
  smartShuffle: boolean;
  setSmartShuffle(on: boolean): void;
  /** Wavelength playlists in folders (playlist id → folder name) and pinned to the top of the sidebar; synced. */
  playlistFolders: Record<string, string>;
  pinnedPlaylists: string[];
  setPlaylistFolder(id: string, folder: string | undefined): void;
  togglePinnedPlaylist(id: string): void;
  /** Navidrome / Plex servers whose own playlists are hidden (Playlists → "Hide"), e.g. once copied to Wavelength; synced. */
  hiddenPlaylistSources: string[];
  setPlaylistSourceHidden(sourceId: string, hidden: boolean): void;
  /** Playlists → Smart playlists (lib/smartPlaylists.ts): the rules, synced. */
  smartPlaylists: SmartPlaylist[];
  saveSmartPlaylist(p: SmartPlaylist): void;
  removeSmartPlaylist(id: string): void;
  /** This device shows up under Devices on your other devices, which can control it (lib/remote.ts). Not synced. */
  remoteControl: boolean;
  setRemoteControl(v: boolean): void;
  /** House activity (lib/houseActivity.ts): show the house what I'm playing. null: the default (grown-ups yes, kids no). Synced. */
  shareListening: boolean | null;
  setShareListening(v: boolean): void;
  /** Show Inbox news from the Hub as system notifications (lib/notify.ts). Per device, not synced. */
  notifications: boolean;
  setNotifications(v: boolean): void;
  /** Settings → Downloads → Smart offline (lib/smartOffline.ts). Per device, not synced. */
  smartOffline: SmartOfflineSettings;
  setSmartOffline(p: Partial<SmartOfflineSettings>): void;
  /** Settings → Downloads → Dead zones (lib/deadZone.ts). Per device, not synced. */
  deadZone: DeadZoneSettings;
  setDeadZone(p: Partial<DeadZoneSettings>): void;
  /** Settings → Playback → Pick up where you left off (lib/resume.ts). Per device, not synced. */
  resume: boolean;
  setResume(on: boolean): void;
  /** Settings → Playback → Streaming quality (lib/streamQuality.ts), on Wi-Fi and on mobile data. Per device, not synced. */
  streamQuality: { wifi: StreamQuality; mobile: StreamQuality };
  setStreamQuality(p: Partial<SettingsState['streamQuality']>): void;
  /** Settings → Updates (lib/updates.ts). Per device, not synced through the Hub. */
  updates: { auto: boolean; prerelease: boolean };
  setUpdates(u: Partial<SettingsState['updates']>): void;
  /** Pass undefined to put a genre back on the defaults. */
  setDiscoverCharts(g: Genre, charts: ChartSource[] | undefined): void;
  setYtdlp(d: Partial<SettingsState['ytdlp']>): void;
  upsertSource(s: SourceConfig): void;
  removeSource(id: string): void;
  moveSource(id: string, dir: -1 | 1): void;
  toggleStation(s: Station): void;
  /** Change a saved (favorite) station: its name, stream link, genre, home page or logo (Radio → Favorites → Edit). */
  updateSavedStation(id: string, patch: Partial<Pick<Station, 'name' | 'streamUrl' | 'homepage' | 'favicon' | 'genre'>>): void;
  /** Move a saved (favorite) station up or down the list. */
  moveStation(id: string, dir: -1 | 1): void;
  setStationHidden(key: string, hidden: boolean): void;
  setStationOrder(keys: string[]): void;
  setStationGroups(on: boolean): void;
  setSkin(s: Skin): void;
  setThemeMode(m: Partial<Pick<SettingsState, 'seasonal' | 'randomDaily'>>): void;
  setDeemix(d: Partial<SettingsState['deemix']>): void;
}

/** Smart offline's settings (lib/smartOffline.ts), kept here so the store doesn't import that module. */
export interface SmartOfflineSettings {
  enabled: boolean;
  favorites: boolean;
  /** songs played in the last N days; 0 = off */
  recentDays: number;
  /** Made for you mixes and Blend (lib/homeMixes.ts registers them) */
  mixes: boolean;
  /** largest total for smart offline's songs, MB */
  capMb: number;
  /** only on Wi-Fi (where the device can tell; Windows always counts as Wi-Fi) */
  wifiOnly: boolean;
  /** last finished run, ms */
  lastRun?: number;
}

/** The dead zone cushion's settings (lib/deadZone.ts): saved music that keeps playing when the signal goes. */
export interface DeadZoneSettings {
  enabled: boolean;
  /** how many minutes of music to keep ready: the queue ahead, and as much again of songs like the one playing */
  minutes: number;
  /** keep songs like the one playing too, not only the queue ahead */
  similar: boolean;
  /** only fetch on Wi-Fi (off by default: on the road is where dead zones are) */
  wifiOnly: boolean;
}
export const DEFAULT_DEAD_ZONE: DeadZoneSettings = { enabled: true, minutes: 20, similar: true, wifiOnly: false };

export interface DjVoiceSettings {
  on: boolean;
  /** Talk before every Nth song. */
  every: number;
  style: 'chill' | 'hype' | 'trivia';
  /** What the DJ calls you; empty = no name. */
  name: string;
  /** speechSynthesis voice name on this device; empty = the system's default. */
  voice: string;
  rate: number;
  /** The Hub's voice to use (Kokoro or OpenAI, hub/src/dj/voice.ts); empty = the admin's pick. */
  hubVoice: string;
  /** Use this device's voice even when the Hub has one. */
  useDevice: boolean;
  /** How loud the DJ is next to the music: 1 = the music's volume, up to 2.5 (Hub voices; this device's voice is ducked under instead). */
  loudness: number;
}
export const DEFAULT_DJ_VOICE: DjVoiceSettings = { on: false, every: 3, style: 'chill', name: '', voice: '', rate: 1, hubVoice: '', useDevice: false, loudness: 1.6 };

export const DEFAULT_SMART_OFFLINE: SmartOfflineSettings = { enabled: false, favorites: true, recentDays: 30, mixes: true, capMb: 4000, wifiOnly: true };

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      sources: [],
      stations: [],
      skin: 'neon',
      seasonal: false,
      randomDaily: false,
      hiddenStations: [],
      stationOrder: [],
      stationGroups: true,
      deemix: { url: 'http://localhost:6595', arl: '', bitrate: 9 },
      ytdlp: { outDir: '', format: 'opus', bin: '', shareUser: '', sharePass: '', hubFolder: 'yt-dlp' },
      discoverCharts: {},
      discoverHidden: [],
      setDiscoverHidden: (key, hidden) =>
        set((st) => {
          const rest = st.discoverHidden.filter((k) => k !== key);
          return { discoverHidden: hidden ? [...rest, key].slice(-500) : rest };
        }),
      npScene: 'art',
      setNpScene: (npScene) => set({ npScene }),
      critter: 'raccoon',
      setCritter: (critter) => set({ critter }),
      act: 'dj',
      setAct: (act) => set({ act }),
      critterLook: 'boy',
      setCritterLook: (critterLook) => set({ critterLook }),
      eq: DEFAULT_EQ,
      setEq: (e) => set((st) => ({ eq: { ...st.eq, ...e } })),
      smartOffline: DEFAULT_SMART_OFFLINE,
      setSmartOffline: (p) => set((st) => ({ smartOffline: { ...st.smartOffline, ...p } })),
      resume: true,
      setResume: (resume) => set({ resume }),
      streamQuality: { wifi: 'original', mobile: 'original' },
      setStreamQuality: (p) => set((st) => ({ streamQuality: { ...st.streamQuality, ...p } })),
      deadZone: DEFAULT_DEAD_ZONE,
      setDeadZone: (p) => set((st) => ({ deadZone: { ...st.deadZone, ...p } })),
      mouthTune: DEFAULT_TUNE,
      setMouthTune: (t) => set((st) => ({ mouthTune: t === null ? DEFAULT_TUNE : cleanTune({ ...st.mouthTune, ...t }) })),
      mouthOffsets: {},
      setMouthOffset: (key, seconds) =>
        set((st) => {
          const next = { ...st.mouthOffsets };
          delete next[key];
          if (Math.abs(seconds) >= 0.01) next[key] = Math.round(seconds * 100) / 100;
          // newest last; keep the 300 newest so the synced value stays small
          const keys = Object.keys(next);
          for (const k of keys.slice(0, Math.max(0, keys.length - 300))) delete next[k];
          return { mouthOffsets: next };
        }),
      discord: { on: false, appId: '' },
      desktop: { hotkeys: true, closeToTray: false },
      setDesktop: (p) => set((st) => ({ desktop: { ...st.desktop, ...p } })),
      setDiscord: (p) => set((st) => ({ discord: { ...st.discord, ...p } })),
      djVoice: DEFAULT_DJ_VOICE,
      setDjVoice: (p) => set((st) => ({ djVoice: { ...st.djVoice, ...p } })),
      playback: { replayGain: 'off', replayGainPreamp: 0, crossfade: 0 },
      setPlayback: (p) => set((st) => ({ playback: { ...st.playback, ...p } })),
      versions: 'both',
      setVersions: (versions) => set({ versions }),
      dontPlay: { artists: [], songs: [] },
      setDontPlay: (dontPlay) => set({ dontPlay }),
      motion: 'system',
      setMotion: (motion) => set({ motion }),
      smartShuffle: false,
      setSmartShuffle: (smartShuffle) => set({ smartShuffle }),
      playlistFolders: {},
      pinnedPlaylists: [],
      setPlaylistFolder: (id, folder) =>
        set((st) => {
          const next = { ...st.playlistFolders };
          const name = folder?.trim();
          if (name) next[id] = name.slice(0, 60);
          else delete next[id];
          return { playlistFolders: next };
        }),
      togglePinnedPlaylist: (id) =>
        set((st) => ({ pinnedPlaylists: st.pinnedPlaylists.includes(id) ? st.pinnedPlaylists.filter((x) => x !== id) : [id, ...st.pinnedPlaylists] })),
      hiddenPlaylistSources: [],
      setPlaylistSourceHidden: (sourceId, hidden) =>
        set((st) => ({ hiddenPlaylistSources: hidden ? [...new Set([...st.hiddenPlaylistSources, sourceId])] : st.hiddenPlaylistSources.filter((x) => x !== sourceId) })),
      smartPlaylists: [],
      saveSmartPlaylist: (p) => set((st) => ({ smartPlaylists: st.smartPlaylists.some((x) => x.id === p.id) ? st.smartPlaylists.map((x) => (x.id === p.id ? p : x)) : [...st.smartPlaylists, p] })),
      removeSmartPlaylist: (id) => set((st) => ({ smartPlaylists: st.smartPlaylists.filter((x) => x.id !== id) })),
      remoteControl: true,
      shareListening: null,
      setShareListening: (shareListening) => set({ shareListening }),
      setRemoteControl: (remoteControl) => set({ remoteControl }),
      notifications: true,
      setNotifications: (notifications) => set({ notifications }),
      updates: { auto: true, prerelease: false },
      setUpdates: (u) => set((st) => ({ updates: { ...st.updates, ...u } })),
      setDiscoverCharts: (g, charts) =>
        set((st) => {
          const discoverCharts = { ...st.discoverCharts };
          if (charts?.length) discoverCharts[g] = charts;
          else delete discoverCharts[g];
          return { discoverCharts };
        }),
      setYtdlp: (d) => set((st) => ({ ytdlp: { ...st.ytdlp, ...d } })),
      upsertSource: (s) =>
        set((st) => {
          const i = st.sources.findIndex((x) => x.id === s.id);
          const sources = [...st.sources];
          if (i >= 0) sources[i] = s;
          else sources.push(s);
          return { sources };
        }),
      removeSource: (id) => set((st) => ({ sources: st.sources.filter((s) => s.id !== id) })),
      moveSource: (id, dir) =>
        set((st) => {
          const i = st.sources.findIndex((s) => s.id === id);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= st.sources.length) return st;
          const sources = [...st.sources];
          [sources[i], sources[j]] = [sources[j], sources[i]];
          return { sources };
        }),
      toggleStation: (s) =>
        set((st) =>
          st.stations.some((x) => x.id === s.id)
            ? { stations: st.stations.filter((x) => x.id !== s.id) }
            : { stations: [...st.stations, s] },
        ),
      updateSavedStation: (id, patch) => set((st) => ({ stations: st.stations.map((s) => (s.id === id ? { ...s, ...patch } : s)) })),
      moveStation: (id, dir) =>
        set((st) => {
          const i = st.stations.findIndex((s) => s.id === id);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= st.stations.length) return st;
          const stations = [...st.stations];
          [stations[i], stations[j]] = [stations[j], stations[i]];
          return { stations };
        }),
      setStationHidden: (key, hidden) =>
        set((st) => ({ hiddenStations: hidden ? [...new Set([...st.hiddenStations, key])] : st.hiddenStations.filter((k) => k !== key) })),
      setStationOrder: (stationOrder) => set({ stationOrder }),
      setStationGroups: (stationGroups) => set({ stationGroups }),
      setSkin: (skin) => set({ skin }),
      setThemeMode: (m) => set(m),
      setDeemix: (d) => set((st) => ({ deemix: { ...st.deemix, ...d } })),
    }),
    {
      name: 'tonearm.settings',
      // server passwords and tokens, the deemix ARL and the share password live in the OS keychain (lib/secrets.ts)
      storage: createJSONStorage(() =>
        secretStorage<Partial<SettingsState>>({
          strip: (st) => {
            const secrets: Record<string, string> = {};
            const sources = st.sources?.map((x) => {
              const { password, token, ...rest } = x;
              if (password) secrets[`source.${x.id}.password`] = password;
              if (token) secrets[`source.${x.id}.token`] = token;
              return rest;
            });
            if (st.deemix?.arl) secrets['deemix.arl'] = st.deemix.arl;
            if (st.ytdlp?.sharePass) secrets['ytdlp.sharePass'] = st.ytdlp.sharePass;
            return {
              state: { ...st, sources, ...(st.deemix && { deemix: { ...st.deemix, arl: '' } }), ...(st.ytdlp && { ytdlp: { ...st.ytdlp, sharePass: '' } }) },
              secrets,
            };
          },
          fill: (st, get) => ({
            ...st,
            sources: st.sources?.map((x) => {
              const password = get(`source.${x.id}.password`), token = get(`source.${x.id}.token`);
              return { ...x, ...(password && { password }), ...(token && { token }) };
            }),
            ...(st.deemix && { deemix: { ...st.deemix, arl: get('deemix.arl') || st.deemix.arl } }),
            ...(st.ytdlp && { ytdlp: { ...st.ytdlp, sharePass: get('ytdlp.sharePass') || st.ytdlp.sharePass } }),
          }),
          owns: (k) => k.startsWith('source.') || k === 'deemix.arl' || k === 'ytdlp.sharePass',
        }),
      ),
      // v1: Wavelength rebrand — move the old default skin onto the new Neon default once
      // v2: the one `raccoon` pick becomes a species (`critter`) and an `act`
      version: 2,
      migrate: (saved, version) => {
        const s = (saved ?? {}) as Partial<SettingsState> & { raccoon?: unknown };
        if (version < 1 && (!s.skin || s.skin === 'plexamp')) s.skin = 'neon';
        if (version < 2 && s.raccoon !== undefined) {
          Object.assign(s, critterFromOldPick(s.raccoon));
          delete s.raccoon;
        }
        return s as SettingsState;
      },
      // fill in defaults for settings added after someone's first run
      merge: (saved, current) => {
        const s = (saved ?? {}) as Partial<SettingsState>;
        return { ...current, ...s, ...(s.act && RETIRED_ACTS[s.act] && { act: RETIRED_ACTS[s.act] }), ytdlp: { ...current.ytdlp, ...s.ytdlp }, updates: { ...current.updates, ...s.updates }, smartOffline: { ...current.smartOffline, ...s.smartOffline }, deadZone: { ...current.deadZone, ...s.deadZone }, streamQuality: { ...current.streamQuality, ...s.streamQuality }, mouthTune: cleanTune(s.mouthTune) };
      },
    },
  ),
);

export const enabledSources = () => useSettings.getState().sources.filter((s) => s.enabled);
