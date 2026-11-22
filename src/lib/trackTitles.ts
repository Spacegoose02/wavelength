/**
 * Song titles with the track number written into them: "04 - God's Plan", "04. God's Plan", "4 – God's Plan".
 * Some tagging and renaming tools copy the file name ("04 - God's Plan.mp3") into the title tag, which breaks
 * lyrics lookups, matching against Deezer and charts, and looks wrong everywhere. The sources show these titles
 * without the number (sources/navidrome.ts, sources/plex.ts), lyrics look them up without it (lib/lyrics.ts),
 * and Library care → Numbered titles writes the clean title back into the files (views/LibraryCare.tsx). The Hub
 * finds those with a copy of numberedTitle() (hub/src/trackTitles.ts): keep the two in step.
 *
 * A leading number is only taken for a track number when it can't be part of the name: it has a leading zero
 * ("04"), or it is the song's own track number. Without a separator ("04 God's Plan") it must have the leading
 * zero. "7 Rings", "99 Problems" and "1-800-273-8255" are left alone.
 *
 * Given the song's `artist`, a number followed by that artist ("50 - The Clash - Should I Stay or Should I Go", a
 * file name from a numbered playlist or chart download) is always a prefix, whatever the number: both come off.
 */
const PREFIX = /^\s*(\d{1,3})(?:\s*([-–—.)_])\s+|\s+)(?=\S)/;

/** The track number at the start of a title and the title without it, when it is one. */
export function numberedTitle(title: string, trackNumber?: number, artist?: string): { number: number; title: string } | undefined {
  const m = PREFIX.exec(title ?? '');
  if (!m) return undefined;
  const digits = m[1];
  const number = Number(digits);
  const rest = title.slice(m[0].length).trim();
  if (!rest) return undefined;
  // "50 - The Clash - Song" by The Clash: the number can't be part of the name
  const named = withoutArtist(rest, artist);
  if (m[2] && named !== rest) return { number, title: named };
  const padded = digits.length > 1 && digits.startsWith('0');
  const own = !!trackNumber && number === trackNumber;
  // "04 - Song" / "4. Song" (track 4): a separator; "04 Song" with none only when it's padded and not another number
  const sure = m[2] ? padded || own : padded && (own || !trackNumber);
  return sure ? { number, title: named } : undefined;
}

const loose = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

/** "The Clash - Should I Stay" → "Should I Stay" when `artist` is The Clash; anything else unchanged. */
export function withoutArtist(title: string, artist?: string): string {
  const name = loose(artist ?? '');
  if (!name) return title;
  const m = /^(.+?)\s+[-–—]\s+(\S.*)$/.exec(title);
  return m && loose(m[1]) === name ? m[2].trim() : title;
}

/** `title` without a track number written in front of it ("04 - God's Plan" → "God's Plan"). */
export function withoutTrackNumber(title: string, trackNumber?: number, artist?: string): string {
  return numberedTitle(title, trackNumber, artist)?.title ?? title;
}

/**
 * For lookups (lyrics), where trying a title without a leading number costs nothing: also takes "4 - Song"
 * when the track number isn't known.
 */
export function looseWithoutTrackNumber(title: string): string {
  const m = PREFIX.exec(title ?? '');
  const rest = m && (m[2] || m[1].startsWith('0')) ? title.slice(m[0].length).trim() : '';
  return rest || title;
}

/** A song file whose title tag has its track number in front, and the title to write instead. */
export interface TitleFix {
  path: string;
  albumId?: string;
  /** the album's artist and name, when the Hub found it (GET /api/admin/tags/numbered) */
  artist?: string;
  album?: string;
  from: string;
  to: string;
}

/** The songs (as the Hub's tag editor reads them) whose title tag starts with their track number. */
export function titleFixes(songs: { path: string; albumId?: string; tags: { title?: string; track?: string; artist?: string } }[]): TitleFix[] {
  const out: TitleFix[] = [];
  for (const s of songs) {
    const from = s.tags.title ?? '';
    const hit = numberedTitle(from, parseInt(s.tags.track ?? '', 10) || undefined, s.tags.artist);
    if (hit) out.push({ path: s.path, albumId: s.albumId, from, to: hit.title });
  }
  return out;
}
