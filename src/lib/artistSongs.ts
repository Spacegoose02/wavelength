import type { HubClient, HubTagSong } from '../sources/hub';
import { sourceFor } from '../sources/registry';
import type { Artist, SourceConfig } from '../sources/types';
import { LibraryServer } from './serverName';

/** A song on one of an artist's albums, with the tags in its file and the Navidrome album it's on. */
export type ArtistSong = HubTagSong & { albumId: string };

/**
 * Every song on an artist's Navidrome albums, with the tags in their files (Edit artist, both the dialog and the
 * song-by-song page). An artist Navidrome lists no albums for (a joined credit like "Lil Baby;Jeremih", or someone
 * only ever featured) gets the albums their songs are on. At most 200 albums.
 */
export async function loadArtistSongs(artist: Artist, sources: SourceConfig[], c: Pick<HubClient, 'tagAlbums'>): Promise<{ songs: ArtistSong[]; titles: Record<string, string>; missing: string[] }> {
  const refs = (artist.refs ?? [artist]).filter((r) => sources.find((s) => s.id === r.sourceId)?.kind === 'navidrome');
  const albums = (await Promise.all(refs.map(async (r) => {
    const src = sourceFor(sources.find((s) => s.id === r.sourceId)!);
    const own = (await src.getArtistAlbums?.(r.id)) ?? [];
    return own.length ? own : ((await src.getAppearsOn?.({ id: r.id, name: artist.name }).catch(() => [])) ?? []);
  }))).flat();
  if (!albums.length) throw new Error(`${LibraryServer()} has no albums for this artist`);
  const r = await c.tagAlbums(albums.map((a) => a.id).slice(0, 200));
  return { songs: r.songs, titles: Object.fromEntries(albums.map((a) => [a.id, a.title])), missing: r.missing };
}
