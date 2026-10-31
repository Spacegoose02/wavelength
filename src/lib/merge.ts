import { sourceFor } from '../sources/registry';
import type { HubTags, HubTagSong } from '../sources/hub';
import type { Album, Artist } from '../sources/types';
import { hubClient } from '../store/hub';
import { useSettings } from '../store/settings';

/**
 * Merging albums and artists, the way Plex does it (docs/USER-GUIDE.md "Selecting several albums or artists"):
 * tick two or more, and the FIRST one ticked is the one the others merge into. Navidrome builds albums and
 * artists from the tags in the files, so a merge is a tag edit through the Hub (hub/src/routes/tags.ts):
 *
 * - **Albums:** every song on the other albums gets the target's Album, Album artist and Year tags, so
 *   Navidrome files them all under the target on its next scan. Files don't move and the audio isn't touched.
 * - **Artists:** every song by the others is renamed to the target's name in its Artist and Album artist tags,
 *   also where they're credited with someone else ("Other feat. X"), like Edit artist does.
 *
 * Either way it's one Save, so Settings → Server → Tag edits can undo the whole merge in one go.
 */

type Song = HubTagSong & { albumId: string };
export interface MergeChange { song: Song; tags: HubTags }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `from` → `to` in a tag. The whole value always; with `credits`, also where the artist is named with others
 * ("A feat. B", "A & B", "A; B"). A spot that already says `to` (renaming "Beatles" to "The Beatles") stays.
 */
export function renameArtist(value: string | undefined, from: string, to: string, credits: boolean): string | undefined {
  if (!value || !from.trim()) return value;
  if (value.trim().toLowerCase() === from.trim().toLowerCase()) return to;
  if (!credits) return value;
  const k = to.toLowerCase().indexOf(from.toLowerCase());
  return value.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc(from.trim())}(?![\\p{L}\\p{N}])`, 'giu'), (m, at: number) =>
    k >= 0 && value.slice(at - k, at - k + to.length) === to ? m : to);
}

/** The value most of these songs have for a tag (the first one on a tie), or undefined when none have it. */
function usual(songs: HubTagSong[], key: keyof HubTags): string | undefined {
  const counts = new Map<string, number>();
  for (const s of songs) {
    const v = s.tags[key]?.trim();
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | undefined, n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

/** The album the others merge into, as its own songs' tags say: Album, Album artist (or Artist), Year. */
export function albumTarget(targetSongs: HubTagSong[], fallback: Pick<Album, 'title' | 'artist' | 'year'>) {
  return {
    album: usual(targetSongs, 'album') ?? fallback.title,
    albumArtist: usual(targetSongs, 'albumArtist') ?? usual(targetSongs, 'artist') ?? fallback.artist,
    year: usual(targetSongs, 'year') ?? (fallback.year ? String(fallback.year) : undefined),
  };
}

/** What changes on the other albums' songs: only the tags that differ from the target's. */
export function planAlbumMerge(target: ReturnType<typeof albumTarget>, songs: Song[]): MergeChange[] {
  return songs.flatMap((song) => {
    const tags: HubTags = {};
    if ((song.tags.album ?? '') !== target.album) tags.album = target.album;
    if ((song.tags.albumArtist ?? '') !== target.albumArtist) tags.albumArtist = target.albumArtist;
    if (target.year && (song.tags.year ?? '') !== target.year) tags.year = target.year;
    return Object.keys(tags).length ? [{ song, tags }] : [];
  });
}

/** Every other artist's name → the target's, in Artist and Album artist, also in shared credits. */
export function planArtistMerge(target: string, others: string[], songs: Song[]): MergeChange[] {
  return songs.flatMap((song) => {
    let artist = song.tags.artist, albumArtist = song.tags.albumArtist;
    for (const from of others) {
      if (from.trim().toLowerCase() === target.trim().toLowerCase()) continue;
      artist = renameArtist(artist, from, target, true);
      albumArtist = renameArtist(albumArtist, from, target, true);
    }
    const tags: HubTags = {};
    if (artist !== song.tags.artist) tags.artist = artist;
    if (albumArtist !== song.tags.albumArtist) tags.albumArtist = albumArtist;
    return Object.keys(tags).length ? [{ song, tags }] : [];
  });
}

const kindOf = (sourceId: string) => useSettings.getState().sources.find((s) => s.id === sourceId)?.kind;
/** The copies of an album or artist the Hub can retag: the ones on Navidrome. */
export const navidromeRefs = <T extends Album | Artist>(x: T): T[] => ((x.refs ?? [x]) as T[]).filter((r) => kindOf(r.sourceId) === 'navidrome');

export interface MergePlan {
  /** Shown before saving, e.g. "Underground Luxury – B.o.B" or "B.o.B". */
  into: string;
  label: string;
  changes: MergeChange[];
  /** Files the Hub couldn't find in its music folder; they're left out. */
  missing: string[];
}

async function songsOf(albumIds: string[]) {
  const ids = [...new Set(albumIds)];
  if (!ids.length) return { songs: [] as Song[], missing: [] as string[] };
  if (ids.length > 200) throw new Error('That’s more than 200 albums; merge fewer at once');
  return hubClient()!.tagAlbums(ids);
}

/** Read the files and work out the merge. `albums[0]` is the target. Nothing is written yet. */
export async function planAlbums(albums: Album[]): Promise<MergePlan> {
  if (albums.length < 2) throw new Error('Pick at least two albums: the first one is the one the others merge into');
  const [first, ...rest] = albums;
  const targetIds = navidromeRefs(first).map((r) => r.id);
  if (!targetIds.length) throw new Error(`${first.title} isn’t on a Navidrome server, so the Hub can’t merge into it`);
  // a copy that is also one of the target's (the same album ticked twice) stays as it is
  const otherIds = rest.flatMap((a) => navidromeRefs(a).map((r) => r.id)).filter((id) => !targetIds.includes(id));
  if (!otherIds.length) throw new Error('None of the other albums are on a Navidrome server the Hub can retag');
  const [t, o] = await Promise.all([songsOf(targetIds), songsOf(otherIds)]);
  if (!t.songs.length) throw new Error(`The Hub can’t find ${first.title}’s files in its music folder`);
  const target = albumTarget(t.songs, first);
  return {
    into: `${target.album} – ${target.albumArtist}`,
    label: `Merge ${rest.length} album${rest.length === 1 ? '' : 's'} into ${target.album}`,
    changes: planAlbumMerge(target, o.songs),
    missing: o.missing,
  };
}

/** Read the files and work out the merge. `artists[0]` is the target. Nothing is written yet. */
export async function planArtists(artists: Artist[]): Promise<MergePlan> {
  if (artists.length < 2) throw new Error('Pick at least two artists: the first one is the one the others merge into');
  const [first, ...rest] = artists;
  const refs = rest.flatMap((a) => navidromeRefs(a));
  if (!refs.length) throw new Error('None of the other artists are on a Navidrome server the Hub can retag');
  const sources = useSettings.getState().sources;
  const albums = (await Promise.all(refs.map(async (r) => {
    const cfg = sources.find((s) => s.id === r.sourceId)!;
    return (await sourceFor(cfg).getArtistAlbums?.(r.id)) ?? [];
  }))).flat();
  const { songs, missing } = await songsOf(albums.map((a) => a.id));
  return {
    into: first.name,
    label: `Merge ${rest.map((a) => a.name).join(', ').slice(0, 120)} into ${first.name}`,
    changes: planArtistMerge(first.name, rest.map((a) => a.name), songs),
    missing,
  };
}

/** Write a plan as one Save (one undo). Navidrome is asked to rescan by the Hub. */
export async function applyMerge(plan: MergePlan) {
  if (!plan.changes.length) return { batch: null, changed: [] as string[], failed: [] as { path: string; error: string }[] };
  return hubClient()!.saveTags(plan.label, plan.changes.map((c) => ({ path: c.song.path, tags: c.tags })));
}
