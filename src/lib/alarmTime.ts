/** When a wake-up alarm goes off next (lib/alarm.ts). Pure, for tests. */

export interface AlarmTime {
  /** "07:30", local time */
  time: string;
  /** weekdays it repeats on (0 = Sunday); empty: once, the next time the clock reaches `time` */
  days: number[];
}

/** The next time (ms) the alarm goes off after `now`, in the device's local time, or undefined when `time` is bad. */
export function nextAlarm(a: AlarmTime, now: number): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(a.time);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return undefined;
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    d.setHours(h, min, 0, 0);
    if (d.getTime() <= now) continue;
    if (a.days.length && !a.days.includes(d.getDay())) continue;
    return d.getTime();
  }
  return undefined;
}

/** "Tomorrow at 7:30", "Saturday at 9:00", "in 25 min". */
export function whenText(at: number, now: number): string {
  const mins = Math.round((at - now) / 60_000);
  if (mins < 60) return `in ${Math.max(1, mins)} min`;
  const d = new Date(at);
  const t = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return `today at ${t}`;
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow at ${t}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'long' })} at ${t}`;
}

/** "Weekdays", "Every day", "Sat, Sun", "Once". */
export function daysText(days: number[]): string {
  const s = [...new Set(days)].sort();
  if (!s.length) return 'Once';
  if (s.length === 7) return 'Every day';
  if (s.join() === '1,2,3,4,5') return 'Weekdays';
  if (s.join() === '0,6') return 'Weekends';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return s.map((d) => names[d]).join(', ');
}

/** Volume (0–1 of the person's own) `elapsed` seconds into a fade-in of `seconds`: starts quiet, eases up. */
export function fadeInLevel(elapsed: number, seconds: number): number {
  if (seconds <= 0 || elapsed >= seconds) return 1;
  const x = Math.max(0, elapsed / seconds);
  return 0.05 + 0.95 * x * x;
}
