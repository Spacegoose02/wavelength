import type { ServerPlaylist, Track } from '../sources/types';

/**
 * Playlists → a Navidrome / Plex section → "Copy all to Wavelength": every playlist on that server becomes a
 * Wavelength playlist (synced through the Hub, mixable with any source), so the server's own can then be hidden.
 * One already copied (a Wavelength playlist with the same name) is left alone, so running it twice is safe.
 */

export interface CopyResult {
  copied: string[];
  /** a Wavelength playlist with that name already exists */
  skipped: string[];
  failed: { name: string; error: string }[];
  /** songs the server listed in a playlist but couldn't send (the Hub without Navidrome leaves out files it can't find) */
  missing: number;
}

export async function copyAllPlaylists(
  playlists: ServerPlaylist[],
  existingNames: string[],
  tracksOf: (id: string) => Promise<Track[]>,
  create: (name: string, tracks: Track[]) => void,
  progress?: (done: number, total: number, name: string) => void,
): Promise<CopyResult> {
  const have = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const out: CopyResult = { copied: [], skipped: [], failed: [], missing: 0 };
  for (const [i, p] of playlists.entries()) {
    progress?.(i, playlists.length, p.name);
    const key = p.name.trim().toLowerCase();
    if (have.has(key)) {
      out.skipped.push(p.name);
      continue;
    }
    try {
      const tracks = await tracksOf(p.id);
      create(p.name, tracks);
      have.add(key);
      out.copied.push(p.name);
      if (p.trackCount !== undefined && p.trackCount > tracks.length) out.missing += p.trackCount - tracks.length;
    } catch (e) {
      out.failed.push({ name: p.name, error: String((e as Error).message ?? e) });
    }
  }
  progress?.(playlists.length, playlists.length, '');
  return out;
}

/** "Copied 12 playlists · 3 already in Wavelength · 4 songs the server couldn't find were left out" */
export function copySummary(r: CopyResult): string {
  const parts = [`Copied ${r.copied.length} playlist${r.copied.length === 1 ? '' : 's'}`];
  if (r.skipped.length) parts.push(`${r.skipped.length} already in Wavelength`);
  if (r.missing) parts.push(`${r.missing} song${r.missing === 1 ? '' : 's'} the server couldn’t find ${r.missing === 1 ? 'was' : 'were'} left out`);
  if (r.failed.length) parts.push(`couldn’t copy ${r.failed.map((f) => `${f.name} (${f.error})`).join(', ')}`);
  return parts.join(' · ');
}
