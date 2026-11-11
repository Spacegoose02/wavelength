/**
 * Wavelength playlists in folders and pinned (Settings `playlistFolders`, `pinnedPlaylists`, synced to the Hub
 * profile like other settings). The sidebar and the Playlists page both show them through `groupPlaylists`.
 */
/** `made`: the order they were made in, as the sidebar has always listed them */
export type PlaylistSort = 'made' | 'recent' | 'name' | 'size';

interface P {
  id: string;
  name: string;
  updatedAt: number;
  tracks: unknown[];
}

export function sortPlaylists<T extends P>(list: T[], by: PlaylistSort): T[] {
  const out = [...list];
  if (by === 'name') out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  else if (by === 'size') out.sort((a, b) => b.tracks.length - a.tracks.length);
  else if (by === 'recent') out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export interface Grouped<T> {
  pinned: T[];
  loose: T[];
  folders: { name: string; playlists: T[] }[];
}

/** Pinned first (in pin order), then playlists in no folder, then each folder (by name). */
export function groupPlaylists<T extends P>(list: T[], folders: Record<string, string>, pinned: string[], by: PlaylistSort = 'recent'): Grouped<T> {
  const byId = new Map(list.map((p) => [p.id, p]));
  const pins = pinned.flatMap((id) => byId.get(id) ?? []);
  const pinnedSet = new Set(pins.map((p) => p.id));
  const rest = sortPlaylists(list.filter((p) => !pinnedSet.has(p.id)), by);
  const named = new Map<string, T[]>();
  const loose: T[] = [];
  for (const p of rest) {
    const f = folders[p.id];
    if (!f) loose.push(p);
    else named.set(f, [...(named.get(f) ?? []), p]);
  }
  return {
    pinned: pins,
    loose,
    folders: [...named].sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' })).map(([name, playlists]) => ({ name, playlists })),
  };
}

/** Folder names in use, for the "Move to folder" list. */
export const folderNames = (folders: Record<string, string>) => [...new Set(Object.values(folders))].sort((a, b) => a.localeCompare(b));
