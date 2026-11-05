/**
 * Song titles with the track number written into them: "04 - God's Plan", "04. God's Plan", "4 – God's Plan".
 * Some tagging and renaming tools copy the file name ("04 - God's Plan.mp3") into the title tag, which breaks
 * lyrics lookups, matching against Deezer and charts, and looks wrong everywhere. The sources show these titles
 * without the number (sources/navidrome.ts, sources/plex.ts), lyrics look them up without it (lib/lyrics.ts),
 * and Library care → Numbered titles writes the clean title back into the files (views/LibraryCare.tsx).
 *
 * A leading number is only taken for a track number when it can't be part of the name: it has a leading zero
 * ("04"), or it is the song's own track number. Without a separator ("04 God's Plan") it must have the leading
 * zero. "7 Rings", "99 Problems" and "1-800-273-8255" are left alone.
 */
const PREFIX = /^\s*(\d{1,3})(?:\s*([-–—.)_])\s+|\s+)(?=\S)/;

/** The track number at the start of a title and the title without it, when it is one. */
export function numberedTitle(title: string, trackNumber?: number): { number: number; title: string } | undefined {
  const m = PREFIX.exec(title ?? '');
  if (!m) return undefined;
  const digits = m[1];
  const number = Number(digits);
  const rest = title.slice(m[0].length).trim();
  if (!rest) return undefined;
  const padded = digits.length > 1 && digits.startsWith('0');
  const own = !!trackNumber && number === trackNumber;
  // "04 - Song" / "4. Song" (track 4): a separator; "04 Song" with none only when it's padded and not another number
  const sure = m[2] ? padded || own : padded && (own || !trackNumber);
  return sure ? { number, title: rest } : undefined;
}

/** `title` without a track number written in front of it ("04 - God's Plan" → "God's Plan"). */
export function withoutTrackNumber(title: string, trackNumber?: number): string {
  return numberedTitle(title, trackNumber)?.title ?? title;
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
  from: string;
  to: string;
}

/** The songs (as the Hub's tag editor reads them) whose title tag starts with their track number. */
export function titleFixes(songs: { path: string; albumId?: string; tags: { title?: string; track?: string } }[]): TitleFix[] {
  const out: TitleFix[] = [];
  for (const s of songs) {
    const from = s.tags.title ?? '';
    const hit = numberedTitle(from, parseInt(s.tags.track ?? '', 10) || undefined);
    if (hit) out.push({ path: s.path, albumId: s.albumId, from, to: hit.title });
  }
  return out;
}
