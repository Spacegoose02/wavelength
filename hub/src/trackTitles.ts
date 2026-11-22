/**
 * Song titles with the track number written into them ("04 - God's Plan"), for Library care → Numbered titles
 * (`GET /api/admin/tags/numbered`, routes/tags.ts). The same rule as the app's src/lib/trackTitles.ts: keep the
 * two in step.
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
