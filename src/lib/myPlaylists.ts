import { sourceFor } from '../sources/registry';
import type { Track } from '../sources/types';
import { useLibrary } from '../store/library';
import { useServerPlaylists } from '../store/serverPlaylists';
import { enabledSources } from '../store/settings';

/**
 * Everyone's own playlists in one list, for DJ Trash Panda (lib/dj.ts `list_playlists`, DJ mode's "From your
 * playlists"): the Wavelength playlists on this device plus the ones on their Navidrome / Plex.
 */

export interface MyPlaylist {
  /** `local:<id>` or `<sourceId>:<id>`. */
  key: string;
  name: string;
  songs?: number;
  where: 'Wavelength' | string;
}

export async function myPlaylists(): Promise<MyPlaylist[]> {
  const sp = useServerPlaylists.getState();
  if (!Object.keys(sp.bySource).length && !sp.loading) await sp.load().catch(() => undefined);
  const local = useLibrary.getState().playlists.map((p) => ({ key: `local:${p.id}`, name: p.name, songs: p.tracks.length, where: 'Wavelength' }));
  const names = new Map(enabledSources().map((s) => [s.id, s.name]));
  const server = Object.entries(useServerPlaylists.getState().bySource).flatMap(([sourceId, list]) =>
    list.map((p) => ({ key: `${sourceId}:${p.id}`, name: p.name, ...(p.trackCount !== undefined && { songs: p.trackCount }), where: names.get(sourceId) ?? 'your server' })),
  );
  return [...local, ...server];
}

export async function playlistTracks(key: string): Promise<Track[]> {
  const i = key.indexOf(':');
  const where = key.slice(0, i);
  const id = key.slice(i + 1);
  if (where === 'local') return useLibrary.getState().playlists.find((p) => p.id === id)?.tracks ?? [];
  const cfg = enabledSources().find((s) => s.id === where);
  return (cfg && (await sourceFor(cfg).getPlaylistTracks?.(id))) || [];
}
