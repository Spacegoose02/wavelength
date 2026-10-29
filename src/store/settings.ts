import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SourceConfig, Station } from '../sources/types';
import type { ChartSource, Genre } from '../sources/charts';
import { DEFAULT_EQ, type EqSettings } from '../player/eq';

export type Skin = 'neon' | 'plexamp' | 'winamp' | 'vaporwave' | 'crt' | 'amber' | 'gameboy' | 'c64' | 'win95' | 'dos' | 'sunset' | 'arcade' | 'seventies'
  | 'tokyonight' | 'catppuccin' | 'gruvbox' | 'nord' | 'everforest' | 'kanagawa' | 'rosepine' | 'ipod' | 'aqua' | 'walkman'
  | 'dracula' | 'monokai' | 'solarized' | 'solarizedlight' | 'oled' | 'contrast' | 'sakura' | 'cyberpunk'
  | 'outrun' | 'lasergrid' | 'acid' | 'miami' | 'blacklight' | 'electric'
  | 'lasershow' | 'laserred' | 'lasergreen' | 'laserharp' | 'lasertag'
  | 'reactor' | 'meltdown' | 'hazard' | 'fallout' | 'uranium'
  | 'halloween' | 'thanksgiving' | 'christmas' | 'july4' | 'valentine';

/** What the Now Playing artwork slot shows: the cover, or one of the visualizer scenes (components/Scenes.tsx). */
export type NpScene = 'art' | 'radial' | 'scope' | 'stars' | 'mirror' | 'rings' | 'raccoon';

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
  { id: 'lasergrid', label: 'Laser grid (neon)', group: 'Lasers' },
  { id: 'lasershow', label: 'Laser show', group: 'Lasers' },
  { id: 'laserred', label: 'Red laser', group: 'Lasers' },
  { id: 'lasergreen', label: 'Green laser', group: 'Lasers' },
  { id: 'laserharp', label: 'Laser harp', group: 'Lasers' },
  { id: 'lasertag', label: 'Laser tag', group: 'Lasers' },
  { id: 'reactor', label: 'Reactor core', group: 'Nuclear' },
  { id: 'meltdown', label: 'Meltdown', group: 'Nuclear' },
  { id: 'hazard', label: 'Radiation hazard', group: 'Nuclear' },
  { id: 'fallout', label: 'Fallout shelter', group: 'Nuclear' },
  { id: 'uranium', label: 'Uranium glass', group: 'Nuclear' },
  { id: 'halloween', label: 'Halloween', group: 'Holidays' },
  { id: 'thanksgiving', label: 'Thanksgiving', group: 'Holidays' },
  { id: 'christmas', label: 'Christmas', group: 'Holidays' },
  { id: 'july4', label: 'July 4th', group: 'Holidays' },
  { id: 'valentine', label: "Valentine's Day", group: 'Holidays' },
];

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
  deemix: { url: string; arl: string; bitrate: number };
  ytdlp: { outDir: string; format: string; bin: string; shareUser: string; sharePass: string };
  /** Discover: which charts each genre uses. A genre that isn't listed uses the built-in defaults. */
  discoverCharts: Partial<Record<Genre, ChartSource[]>>;
  npScene: NpScene;
  setNpScene(s: NpScene): void;
  eq: EqSettings;
  setEq(e: Partial<EqSettings>): void;
  /** Pass undefined to put a genre back on the defaults. */
  setDiscoverCharts(g: Genre, charts: ChartSource[] | undefined): void;
  setYtdlp(d: Partial<SettingsState['ytdlp']>): void;
  upsertSource(s: SourceConfig): void;
  removeSource(id: string): void;
  moveSource(id: string, dir: -1 | 1): void;
  toggleStation(s: Station): void;
  /** Move a saved (favorite) station up or down the list. */
  moveStation(id: string, dir: -1 | 1): void;
  setStationHidden(key: string, hidden: boolean): void;
  setStationOrder(keys: string[]): void;
  setSkin(s: Skin): void;
  setThemeMode(m: Partial<Pick<SettingsState, 'seasonal' | 'randomDaily'>>): void;
  setDeemix(d: Partial<SettingsState['deemix']>): void;
}

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
      deemix: { url: 'http://localhost:6595', arl: '', bitrate: 9 },
      ytdlp: { outDir: '', format: 'opus', bin: '', shareUser: '', sharePass: '' },
      discoverCharts: {},
      npScene: 'art',
      setNpScene: (npScene) => set({ npScene }),
      eq: DEFAULT_EQ,
      setEq: (e) => set((st) => ({ eq: { ...st.eq, ...e } })),
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
      setSkin: (skin) => set({ skin }),
      setThemeMode: (m) => set(m),
      setDeemix: (d) => set((st) => ({ deemix: { ...st.deemix, ...d } })),
    }),
    {
      name: 'tonearm.settings',
      // v1: Wavelength rebrand — move the old default skin onto the new Neon default once
      version: 1,
      migrate: (saved, version) => {
        const s = (saved ?? {}) as Partial<SettingsState>;
        if (version < 1 && (!s.skin || s.skin === 'plexamp')) s.skin = 'neon';
        return s as SettingsState;
      },
      // fill in defaults for settings added after someone's first run
      merge: (saved, current) => {
        const s = (saved ?? {}) as Partial<SettingsState>;
        return { ...current, ...s, ytdlp: { ...current.ytdlp, ...s.ytdlp } };
      },
    },
  ),
);

export const enabledSources = () => useSettings.getState().sources.filter((s) => s.enabled);
