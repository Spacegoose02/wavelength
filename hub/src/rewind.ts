import type { Db } from './db.ts';

/**
 * Wavelength Rewind (docs/USERS-AND-ADMIN.md, Phase 6): a person's listening for a year or a month, from
 * the `plays` table. Devices report plays through POST /api/me/history (routes/mine.ts); only music counts,
 * not radio, audiobooks or podcasts. Minutes are worked out from each song's length.
 */

/** Plays older than this are dropped, so the table stays small. */
const KEEP_MS = 3 * 366 * 24 * 3600_000;
const MAX_SECONDS = 30 * 60;

const text = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Keep a music play for Rewind. Returns it when it's new (not a play the Hub already had), for scrobbling. */
export function recordPlay(db: Db, userId: number, at: number, track: Record<string, unknown>, json: string) {
  if ((track.kind ?? 'track') !== 'track') return null;
  const title = text(track.title), artist = text(track.artist);
  if (!title) return null;
  const seconds = Math.min(Math.max(Math.round(Number(track.duration) || 0), 0), MAX_SECONDS);
  const album = text(track.album);
  const { changes } = db.prepare('INSERT OR IGNORE INTO plays (user_id, played_at, title, artist, album, seconds, track) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(userId, at, title, artist, album, seconds, json);
  db.prepare('DELETE FROM plays WHERE user_id = ? AND played_at < ?').run(userId, Date.now() - KEEP_MS);
  return changes ? { title, artist, album, seconds } : null;
}

/** Years and months that have plays, newest first, in the person's time zone (`tz` = getTimezoneOffset()). */
export function rewindPeriods(db: Db, userId: number, tz: number) {
  const rows = db.prepare(`SELECT strftime('%Y-%m', (played_at - ?) / 1000, 'unixepoch') AS ym, COUNT(*) AS n FROM plays
    WHERE user_id = ? GROUP BY ym ORDER BY ym DESC`).all(tz * 60_000, userId) as { ym: string; n: number }[];
  return rows.map((r) => ({ year: Number(r.ym.slice(0, 4)), month: Number(r.ym.slice(5)), plays: r.n }));
}

interface PlayRow { played_at: number; title: string; artist: string; album: string; seconds: number; track: string }

export function rewind(db: Db, userId: number, year: number, month: number | null, tz: number) {
  const shift = tz * 60_000;
  const from = Date.UTC(year, month ? month - 1 : 0, 1) + shift;
  const to = (month ? Date.UTC(year, month, 1) : Date.UTC(year + 1, 0, 1)) + shift;
  const rows = db.prepare('SELECT played_at, title, artist, album, seconds, track FROM plays WHERE user_id = ? AND played_at >= ? AND played_at < ? ORDER BY played_at')
    .all(userId, from, to) as unknown as PlayRow[];

  const key = (...parts: string[]) => parts.map((p) => p.toLowerCase()).join('\u0000');
  type Agg = { plays: number; seconds: number; first: PlayRow; last: PlayRow };
  const tally = (pick: (r: PlayRow) => string | null) => {
    const m = new Map<string, Agg>();
    for (const r of rows) {
      const k = pick(r);
      if (k === null) continue;
      const a = m.get(k);
      if (a) {
        a.plays++;
        a.seconds += r.seconds;
        a.last = r;
      } else m.set(k, { plays: 1, seconds: r.seconds, first: r, last: r });
    }
    return [...m.values()].sort((a, b) => b.plays - a.plays || b.seconds - a.seconds || a.first.played_at - b.first.played_at);
  };
  const track = (r: PlayRow) => JSON.parse(r.track) as unknown;

  const artists = tally((r) => (r.artist ? key(r.artist) : null));
  const songs = tally((r) => key(r.title, r.artist));
  const albums = tally((r) => (r.album ? key(r.album, r.artist) : null));

  const byHour = Array<number>(24).fill(0);
  const byWeekday = Array<number>(7).fill(0); // Sunday first
  const byMonth = Array<number>(12).fill(0);
  const days = new Map<string, number>();
  for (const r of rows) {
    const local = new Date(r.played_at - shift);
    byHour[local.getUTCHours()]++;
    byWeekday[local.getUTCDay()]++;
    byMonth[local.getUTCMonth()]++;
    const day = local.toISOString().slice(0, 10);
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  const busiest = [...days].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  // the longest run of days in a row with at least one play
  let streak = 0, run = 0, prev = 0;
  for (const d of [...days.keys()].sort()) {
    const t = Date.parse(d);
    run = t - prev === 86_400_000 ? run + 1 : 1;
    streak = Math.max(streak, run);
    prev = t;
  }

  // artists first heard in this period
  const firstEver = db.prepare(`SELECT artist, MIN(played_at) AS first FROM plays WHERE user_id = ? AND artist != '' GROUP BY lower(artist)
    HAVING first >= ? AND first < ? ORDER BY first`).all(userId, from, to) as { artist: string; first: number }[];
  const newSet = new Set(firstEver.map((a) => key(a.artist)));
  const top = songs[0];
  const favouriteFirst = top
    ? (db.prepare('SELECT MIN(played_at) AS at FROM plays WHERE user_id = ? AND lower(title) = lower(?) AND lower(artist) = lower(?)').get(userId, top.first.title, top.first.artist) as { at: number }).at
    : null;

  return {
    year,
    month,
    from,
    to,
    plays: rows.length,
    minutes: Math.round(rows.reduce((n, r) => n + r.seconds, 0) / 60),
    songs: songs.length,
    artists: artists.length,
    albums: albums.length,
    topArtists: artists.slice(0, 10).map((a) => ({ artist: a.first.artist, plays: a.plays, minutes: Math.round(a.seconds / 60), track: track(a.last) })),
    topSongs: songs.slice(0, 10).map((a) => ({ title: a.first.title, artist: a.first.artist, plays: a.plays, track: track(a.last) })),
    topAlbums: albums.slice(0, 10).map((a) => ({ album: a.first.album, artist: a.first.artist, plays: a.plays, track: track(a.last) })),
    /** The top song, and when it was first played (ever, not only in this period). */
    favourite: top ? { title: top.first.title, artist: top.first.artist, plays: top.plays, firstPlayedAt: favouriteFirst } : null,
    newArtists: { count: newSet.size, top: artists.filter((a) => newSet.has(key(a.first.artist))).slice(0, 5).map((a) => ({ artist: a.first.artist, plays: a.plays })) },
    byHour,
    byWeekday,
    byMonth: month ? null : byMonth,
    busiestDay: busiest ? { day: busiest[0], plays: busiest[1] } : null,
    daysListened: days.size,
    streak,
    /** Up to 100 of the period's most played songs, for "Save as playlist". */
    playlist: songs.slice(0, 100).map((a) => track(a.last)),
  };
}
