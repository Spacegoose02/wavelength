/**
 * Song titles with the track number written into them ("04 - God's Plan"), for Library care → Numbered titles
 * (`GET /api/admin/tags/numbered`, routes/tags.ts). The same rule as the app's src/lib/trackTitles.ts: keep the
 * two in step.
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
  const sure = m[2] ? padded || own : padded && (own || !trackNumber);
  return sure ? { number, title: rest } : undefined;
}
