/**
 * 10-band graphic equalizer: band layout and presets. The filters themselves live in the Web Audio
 * graph in `engine.ts`; the user's settings are `eq` in the settings store.
 */

/** Centre frequencies (Hz). The first band is a low shelf, the last a high shelf, the rest peaking. */
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_MIN = -12;
export const EQ_MAX = 12;

export interface EqSettings {
  enabled: boolean;
  /** dB applied before the bands; negative headroom stops boosted bands from clipping */
  preamp: number;
  /** dB per band, same order as EQ_BANDS */
  gains: number[];
  /** preset id, or 'custom' once a slider is moved by hand */
  preset: string;
}

export const EQ_PRESETS: { id: string; label: string; gains: number[] }[] = [
  { id: 'flat', label: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'bass', label: 'Bass boost', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: 'treble', label: 'Treble boost', gains: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
  { id: 'loudness', label: 'Loudness', gains: [5, 4, 2, 0, 0, 0, 0, 1, 3, 4] },
  { id: 'vocal', label: 'Vocal', gains: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
  { id: 'spoken', label: 'Podcasts & books', gains: [-4, -3, -1, 1, 3, 4, 4, 2, 0, -2] },
  { id: 'rock', label: 'Rock', gains: [4, 3, 2, 0, -1, -1, 1, 2, 3, 4] },
  { id: 'pop', label: 'Pop', gains: [-1, 1, 3, 4, 3, 0, -1, -1, 0, 1] },
  { id: 'electronic', label: 'Electronic', gains: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5] },
  { id: 'hiphop', label: 'Hip-hop', gains: [5, 5, 3, 1, -1, -1, 1, 0, 2, 3] },
  { id: 'jazz', label: 'Jazz', gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
  { id: 'classical', label: 'Classical', gains: [4, 3, 2, 0, 0, 0, 0, 2, 3, 4] },
  { id: 'speaker', label: 'Phone speaker', gains: [-6, -3, 0, 2, 2, 1, 1, 2, 2, 1] },
];

export const DEFAULT_EQ: EqSettings = { enabled: false, preamp: 0, gains: EQ_PRESETS[0].gains, preset: 'flat' };

/** Headroom for a set of gains: pull the preamp down by the biggest boost. */
export const autoPreamp = (gains: number[]) => -Math.max(0, ...gains);

export const fmtHz = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : `${hz}`);
