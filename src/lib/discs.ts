/**
 * "Disc 1", "Disc 2" headings on an album's song list, like Plex. Only an album whose songs span more than one
 * disc gets them; a song with no disc number counts as disc 1.
 */

const discOf = (t: { discNumber?: number }) => t.discNumber ?? 1;

/** True when the songs are on more than one disc. */
export function hasDiscs(tracks: { discNumber?: number }[]): boolean {
  return tracks.some((t) => discOf(t) !== discOf(tracks[0]));
}

/**
 * The disc to head row `i` with: its disc number when it starts a new disc (or is the first row), else undefined.
 * `prev` is the row shown before it, which can be further up when rows in between are hidden.
 */
export function discHeading(t: { discNumber?: number }, prev: { discNumber?: number } | undefined): number | undefined {
  return !prev || discOf(prev) !== discOf(t) ? discOf(t) : undefined;
}
