import { norm } from '../sources/registry';
import type { PlexSmartRules, ServerPlaylist, Track } from '../sources/types';
import { cleanTitle, primaryArtist } from './match';

/**
 * Playlists → a Navidrome / Plex section → "Sync to Wavelength": makes Wavelength match the server's playlists, so
 * the server's own can then be hidden. Run it as often as you like:
 *
 * - A playlist Wavelength doesn't have yet (by name) is copied with its songs.
 * - A playlist Wavelength already has (same name) gets the songs it's missing, added at the end. A song counts as
 *   there when it's the same track or the same title and artist (the Navidrome copy of a Plex song, say).
 * - A Plex smart playlist becomes a Wavelength smart playlist with the same rules (lib/plexSmart.ts), so it keeps
 *   up with the library instead of freezing today's songs. One Wavelength already has as a smart playlist (same
 *   name) is left alone; if its rules can't be read, the songs are synced like a regular playlist instead.
 */

export interface WavelengthPlaylist { id: string; name: string; tracks: Track[] }

export interface SyncDeps {
  tracksOf: (id: string) => Promise<Track[]>;
  /** Plex: a smart playlist's rules; missing for servers without smart playlists. */
  smartOf?: (id: string) => Promise<PlexSmartRules>;
  /** returns the new playlist's id */
  create: (name: string, tracks: Track[]) => string;
  add: (id: string, tracks: Track[]) => void;
  saveSmart: (name: string, rules: PlexSmartRules) => void;
  progress?: (done: number, total: number, name: string) => void;
}

export interface CopyResult {
  copied: string[];
  /** same-named playlists that got songs they were missing */
  merged: { name: string; added: number }[];
  /** same-named playlists that already had every song */
  upToDate: string[];
  /** smart playlists made with their rules */
  smart: string[];
  /** smart playlists Wavelength already has */
  smartSkipped: string[];
  /** a smart playlist whose regular copy from an earlier "Copy all" is still in Wavelength */
  staleCopies: string[];
  /** Plex rules Wavelength has no field for, by playlist */
  dropped: { name: string; rules: string[] }[];
  failed: { name: string; error: string }[];
  /** songs the server listed in a playlist but couldn't send (the Hub without Navidrome leaves out files it can't find) */
  missing: number;
}

const nameKey = (n: string) => n.trim().toLowerCase();
const songKeys = (t: Track) => [`${t.sourceId}:${t.id}`, `${norm(primaryArtist(t.artist ?? ''))}|${cleanTitle(t.title ?? '')}`];

/** The songs of `incoming` that `have` doesn't already hold (by track or by title and artist), once each. */
export function missingSongs(have: Track[], incoming: Track[]): Track[] {
  const seen = new Set(have.flatMap(songKeys));
  const out: Track[] = [];
  for (const t of incoming) {
    const keys = songKeys(t);
    if (keys.some((k) => seen.has(k))) continue;
    for (const k of keys) seen.add(k);
    out.push(t);
  }
  return out;
}

export async function syncPlaylists(
  playlists: ServerPlaylist[],
  existing: WavelengthPlaylist[],
  existingSmart: string[],
  deps: SyncDeps,
): Promise<CopyResult> {
  const byName = new Map(existing.map((p) => [nameKey(p.name), p]));
  const smartNames = new Set(existingSmart.map(nameKey));
  const out: CopyResult = { copied: [], merged: [], upToDate: [], smart: [], smartSkipped: [], staleCopies: [], dropped: [], failed: [], missing: 0 };
  for (const [i, p] of playlists.entries()) {
    deps.progress?.(i, playlists.length, p.name);
    const key = nameKey(p.name);
    try {
      if (p.smart && deps.smartOf) {
        if (smartNames.has(key)) {
          out.smartSkipped.push(p.name);
          continue;
        }
        let rulesError = '';
        const rules = await deps.smartOf(p.id).catch((e) => void (rulesError = String((e as Error).message ?? e)));
        if (rules) {
          deps.saveSmart(p.name, rules);
          smartNames.add(key);
          out.smart.push(p.name);
          if (rules.dropped.length) out.dropped.push({ name: p.name, rules: rules.dropped });
          if (byName.has(key)) out.staleCopies.push(p.name);
          continue;
        }
        // rules unreadable: sync its songs instead
        const tracks = await deps.tracksOf(p.id).catch((e) => {
          throw new Error(`${String((e as Error).message ?? e)}; its rules: ${rulesError}`);
        });
        syncSongs(p, tracks);
        continue;
      }
      syncSongs(p, await deps.tracksOf(p.id));
    } catch (e) {
      out.failed.push({ name: p.name, error: String((e as Error).message ?? e) });
    }
  }
  deps.progress?.(playlists.length, playlists.length, '');
  return out;

  function syncSongs(p: ServerPlaylist, tracks: Track[]) {
    const key = nameKey(p.name);
    if (p.trackCount !== undefined && p.trackCount > tracks.length) out.missing += p.trackCount - tracks.length;
    const mine = byName.get(key);
    if (!mine) {
      byName.set(key, { id: deps.create(p.name, tracks), name: p.name, tracks });
      out.copied.push(p.name);
      return;
    }
    const add = missingSongs(mine.tracks, tracks);
    if (!add.length) {
      out.upToDate.push(p.name);
      return;
    }
    deps.add(mine.id, add);
    mine.tracks = [...mine.tracks, ...add];
    out.merged.push({ name: p.name, added: add.length });
  }
}

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

export interface SyncSummary {
  /** One short line: "Copied 2 playlists · added 14 missing songs to 3 you had · 32 smart playlists · 15 up to date" */
  headline: string;
  /** What needs a look, one short line each, grouped (shown under "Details"). */
  details: string[];
}

const list = (names: string[], max = 8) => (names.length > max ? `${names.slice(0, max).join(', ')} and ${names.length - max} more` : names.join(', '));

/** Why a playlist couldn't be synced, in words, so the same problem on 80 playlists reads as one line. */
export function failureWords(error: string): string {
  if (/quota|exceeded/i.test(error)) return 'Wavelength ran out of room to save them';
  const plex = error.match(/(\d{3}) from Plex/);
  if (plex) return `Plex answered with an error (${plex[1]})`;
  return error.length > 80 ? `${error.slice(0, 79)}…` : error;
}

export function copySummary(r: CopyResult): SyncSummary {
  const parts: string[] = [];
  if (r.copied.length) parts.push(`Copied ${n(r.copied.length, 'playlist')}`);
  if (r.merged.length) {
    const songs = r.merged.reduce((s, m) => s + m.added, 0);
    parts.push(`added ${n(songs, 'missing song')} to ${n(r.merged.length, 'playlist')} you had`);
  }
  if (r.smart.length) parts.push(`made ${n(r.smart.length, 'smart playlist')}`);
  const same = r.upToDate.length + r.smartSkipped.length;
  if (same) parts.push(`${same} already up to date`);
  if (r.failed.length) parts.push(`${r.failed.length} couldn’t be synced`);
  if (!parts.length) parts.push('Nothing to sync');
  parts[0] = parts[0][0].toUpperCase() + parts[0].slice(1);

  const details: string[] = [];
  const byError = new Map<string, string[]>();
  for (const f of r.failed) byError.set(failureWords(f.error), [...(byError.get(failureWords(f.error)) ?? []), f.name]);
  for (const [why, names] of byError) details.push(`Couldn’t sync ${n(names.length, 'playlist')}: ${why}. ${list(names)}`);
  if (r.missing) details.push(`${n(r.missing, 'song')} the server couldn’t find ${r.missing === 1 ? 'was' : 'were'} left out.`);
  // the same left-out rule on many playlists reads as one line
  const byRule = new Map<string, string[]>();
  for (const d of r.dropped) for (const rule of new Set(d.rules)) byRule.set(rule, [...(byRule.get(rule) ?? []), d.name]);
  for (const [rule, names] of byRule) details.push(`Plex rule Wavelength doesn’t have, left out: “${rule}” in ${list(names, 5)}`);
  if (r.staleCopies.length) details.push(`Your earlier regular ${r.staleCopies.length === 1 ? 'copy' : 'copies'} of ${list(r.staleCopies)} ${r.staleCopies.length === 1 ? 'is' : 'are'} still there; delete ${r.staleCopies.length === 1 ? 'it' : 'them'} if you like.`);
  return { headline: parts.join(' · '), details };
}
