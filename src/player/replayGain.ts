/**
 * ReplayGain: play every song at about the same loudness, from the loudness tags in the files (Navidrome
 * passes them on as OpenSubsonic `replayGain`). "Track" levels each song on its own; "Album" keeps the
 * album's own quiet and loud songs as the artist meant, which suits listening to whole albums.
 */
import type { ReplayGain } from '../sources/types';

export type ReplayGainMode = 'off' | 'track' | 'album';

/** Songs with no tags are turned down this much in Track/Album mode, roughly where tagged songs land. */
export const UNTAGGED_DB = -6;

/**
 * Linear gain for a song: its gain in dB (the mode's, or the other one when that's missing) plus `preampDb`,
 * lowered if needed so the song's peak doesn't go over full scale.
 */
export function replayGainFactor(rg: ReplayGain | undefined, mode: ReplayGainMode, preampDb = 0): number {
  if (mode === 'off') return 1;
  const db = mode === 'album' ? rg?.albumGain ?? rg?.trackGain : rg?.trackGain ?? rg?.albumGain;
  const peak = mode === 'album' ? rg?.albumPeak ?? rg?.trackPeak : rg?.trackPeak ?? rg?.albumPeak;
  let gain = Math.pow(10, ((db ?? UNTAGGED_DB) + preampDb) / 20);
  if (peak && peak > 0 && gain * peak > 1) gain = 1 / peak;
  return gain;
}
