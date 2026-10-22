import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SourceConfig, Station } from '../sources/types';
import type { ChartSource, Genre } from '../sources/charts';
import { DEFAULT_EQ, type EqSettings } from '../player/eq';

export type Skin = 'neon' | 'plexamp' | 'winamp' | 'vaporwave' | 'crt' | 'amber' | 'gameboy' | 'c64' | 'win95' | 'dos' | 'sunset' | 'arcade' | 'seventies'
  | 'tokyonight' | 'catppuccin' | 'gruvbox' | 'nord' | 'everforest' | 'kanagawa' | 'rosepine' | 'ipod' | 'aqua' | 'walkman'
  | 'dracula' | 'monokai' | 'solarized' | 'solarizedlight' | 'oled' | 'contrast' | 'sakura' | 'cyberpunk'
  | 'outrun' | 'lasergrid' | 'acid' | 'miami' | 'blacklight' | 'electric';

/** What the Now Playing artwork slot shows: the cover, or one of the visualizer scenes (components/Scenes.tsx). */
export type NpScene = 'art' | 'radial' | 'scope' | 'stars' | 'mirror' | 'rings';

export const SKINS: { id: Skin; label: string }[] = [
  { id: 'neon', label: 'Neon synth (default)' },
  { id: 'plexamp', label: 'Midnight (Plexamp-inspired)' },
  { id: 'winamp', label: 'Classic (Winamp-inspired)' },
  { id: 'vaporwave', label: 'Vaporwave' },
  { id: 'crt', label: 'Green CRT terminal' },
  { id: 'amber', label: 'Amber CRT' },
  { id: 'gameboy', label: 'Game Boy Color' },
  { id: 'c64', label: 'Commodore 64' },
  { id: 'win95', label: 'Windows 95' },
  { id: 'dos', label: 'MS-DOS (Norton blue)' },
  { id: 'sunset', label: 'Synthwave sunset' },
  { id: 'arcade', label: 'Arcade cabinet' },
  { id: 'seventies', label: "'70s groove" },
  { id: 'ipod', label: 'iPod Classic' },
  { id: 'aqua', label: 'Aqua (Mac OS X)' },
  { id: 'walkman', label: 'Walkman' },
  { id: 'tokyonight', label: 'Tokyo Night (Omarchy)' },
  { id: 'catppuccin', label: 'Catppuccin (Omarchy)' },
  { id: 'gruvbox', label: 'Gruvbox (Omarchy)' },
  { id: 'nord', label: 'Nord (Omarchy)' },
  { id: 'everforest', label: 'Everforest (Omarchy)' },
  { id: 'kanagawa', label: 'Kanagawa (Omarchy)' },
  { id: 'rosepine', label: 'Rosé Pine (Omarchy)' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'monokai', label: 'Monokai' },
  { id: 'solarized', label: 'Solarized Dark' },
  { id: 'solarizedlight', label: 'Solarized Light' },
  { id: 'oled', label: 'OLED black (saves battery)' },
  { id: 'contrast', label: 'High contrast' },
  { id: 'sakura', label: 'Sakura (light)' },
  { id: 'cyberpunk', label: 'Cyberpunk' },
  { id: 'outrun', label: 'Outrun (neon)' },
  { id: 'lasergrid', label: 'Laser grid (neon)' },
  { id: 'acid', label: 'Acid rave (neon)' },
  { id: 'miami', label: 'Miami nights (neon)' },
  { id: 'blacklight', label: 'Blacklight UV (neon)' },
  { id: 'electric', label: 'Electric (neon)' },
];

interface SettingsState {
  sources: SourceConfig[];
  stations: Station[];
  skin: Skin;
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
  setSkin(s: Skin): void;
  setDeemix(d: Partial<SettingsState['deemix']>): void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      sources: [],
      stations: [],
      skin: 'neon',
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
      setSkin: (skin) => set({ skin }),
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
