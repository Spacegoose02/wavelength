import type { Db } from './db.ts';
import { guardiansOf } from './family.ts';
import { notify, withPermission } from './notify.ts';
import { primaryArtist } from './radar.ts';

/**
 * Notifications the Hub sends on a schedule (times in UTC):
 * - **Kid reports**, Monday mornings: for each kid, last week's listening (songs, minutes, days, top artists,
 *   requests), to the kid's parents (family.ts), or to the admins when the kid has none.
 * - **Your month in music**, on the 1st: last month's minutes and most played artist for everyone who listened,
 *   leading to Rewind.
 * Each runs once per week or month, remembered in hub_settings, so a restart doesn't send it twice.
 */

const KEY = 'digests';
const DAY = 86_400_000;
const TICK_MS = 3_600_000;
const SEND_HOUR = 8;
/** A song counts for at most this long, as in Rewind (a 3-hour mix isn't 3 hours of attention). */
const CAP_S = 1800;

interface State { week: string; month: string }

export interface ListeningSummary { songs: number; minutes: number; days: number; top: string[] }

export function summary(db: Db, userId: number, from: number, to: number): ListeningSummary {
  const rows = db.prepare('SELECT played_at, artist, seconds FROM plays WHERE user_id = ? AND played_at >= ? AND played_at < ?').all(userId, from, to) as
    { played_at: number; artist: string; seconds: number }[];
  const by = new Map<string, { name: string; n: number }>();
  const days = new Set<string>();
  let seconds = 0;
  for (const r of rows) {
    seconds += Math.min(r.seconds || 0, CAP_S);
    days.add(new Date(r.played_at).toISOString().slice(0, 10));
    const name = primaryArtist(r.artist);
    if (!name) continue;
    const k = name.toLowerCase();
    const a = by.get(k) ?? { name, n: 0 };
    a.n++;
    by.set(k, a);
  }
  const top = [...by.values()].sort((a, b) => b.n - a.n).slice(0, 3).map((a) => a.name);
  return { songs: rows.length, minutes: Math.round(seconds / 60), days: days.size, top };
}

/** Monday 00:00 UTC of the week `now` is in. */
const weekStart = (now: number) => {
  const d = new Date(now);
  const back = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back);
};

export class Digests {
  private db: Db;
  private now: () => number;
  private timer?: NodeJS.Timeout;

  constructor(db: Db, opts: { now?: () => number } = {}) {
    this.db = db;
    this.now = opts.now ?? Date.now;
  }

  start() {
    this.timer ??= setInterval(() => this.run(), TICK_MS);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private state(): State {
    const row = this.db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(KEY) as { value: string } | undefined;
    try {
      return { week: '', month: '', ...(row ? JSON.parse(row.value) : {}) };
    } catch {
      return { week: '', month: '' };
    }
  }

  private save(s: State) {
    this.db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(s));
  }

  /** Send whatever is due. Returns what was sent, for tests. */
  run(): { kidReports: number; monthly: number } {
    const now = this.now();
    const d = new Date(now);
    const s = this.state();
    let kidReports = 0, monthly = 0;
    if (d.getUTCHours() >= SEND_HOUR) {
      const week = new Date(weekStart(now)).toISOString().slice(0, 10);
      if (s.week !== week) {
        // the first time, just remember the week, so a new Hub doesn't report a week it wasn't watching
        if (s.week) kidReports = this.kidReports(weekStart(now) - 7 * DAY, weekStart(now));
        s.week = week;
      }
      const month = d.toISOString().slice(0, 7);
      if (s.month !== month) {
        if (s.month) monthly = this.monthly(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1), Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
        s.month = month;
      }
      this.save(s);
    }
    return { kidReports, monthly };
  }

  private kidReports(from: number, to: number): number {
    const kids = this.db.prepare("SELECT id, display_name FROM users WHERE role = 'kid' AND disabled = 0").all() as { id: number; display_name: string }[];
    const admins = withPermission(this.db, 'users.manage');
    let sent = 0;
    for (const k of kids) {
      const sum = summary(this.db, k.id, from, to);
      const requests = (this.db.prepare('SELECT COUNT(*) AS n FROM requests WHERE user_id = ? AND created_at >= ? AND created_at < ?').get(k.id, from, to) as { n: number }).n;
      const to_ = guardiansOf(this.db, k.id);
      const body = sum.songs
        ? `${sum.songs} songs, ${sum.minutes} minutes on ${sum.days} day${sum.days === 1 ? '' : 's'}${sum.top.length ? `. Most played: ${sum.top.join(', ')}` : ''}${requests ? `. ${requests} request${requests === 1 ? '' : 's'}` : ''}`
        : `No music last week${requests ? `, ${requests} request${requests === 1 ? '' : 's'}` : ''}`;
      notify(this.db, to_.length ? to_ : admins, 'report', `${k.display_name}’s week`, body, this.now());
      sent++;
    }
    return sent;
  }

  private monthly(from: number, to: number): number {
    const users = this.db.prepare('SELECT DISTINCT p.user_id AS id FROM plays p JOIN users u ON u.id = p.user_id WHERE u.disabled = 0 AND p.played_at >= ? AND p.played_at < ?').all(from, to) as { id: number }[];
    const name = new Date(from).toLocaleString('en', { month: 'long', timeZone: 'UTC' });
    for (const u of users) {
      const sum = summary(this.db, u.id, from, to);
      notify(this.db, [u.id], 'rewind', `Your ${name} in music`, `${sum.minutes} minutes, ${sum.songs} songs${sum.top[0] ? `. Most played: ${sum.top[0]}` : ''}. Open Rewind for the rest`, this.now());
    }
    return users.length;
  }
}
