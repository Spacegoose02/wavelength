import { SKINS, type Skin } from '../store/settings';

/**
 * Seasonal mode and "Random daily" for the Themes tab. Both only change which skin is *shown*;
 * the skin the user picked stays saved and comes back when the season is over (or the mode is off).
 * Everything here uses the device's local date, so it needs no server or network.
 */

export type HolidaySkin = 'valentine' | 'july4' | 'halloween' | 'thanksgiving' | 'christmas';

export interface Season {
  skin: HolidaySkin;
  label: string;
  /** Human-readable window, shown in Settings → Themes. */
  window: string;
  /** Is `d` (local time) inside this holiday's window? */
  includes(d: Date): boolean;
}

/** month is 1–12 here, to read like a calendar */
const between = (d: Date, fromMonth: number, fromDay: number, toMonth: number, toDay: number) => {
  const n = (d.getMonth() + 1) * 100 + d.getDate();
  return n >= fromMonth * 100 + fromDay && n <= toMonth * 100 + toDay;
};

/** US Thanksgiving: the fourth Thursday of November. */
export function thanksgiving(year: number) {
  const first = new Date(year, 10, 1).getDay();
  return 1 + ((4 - first + 7) % 7) + 21;
}

export const SEASONS: Season[] = [
  { skin: 'valentine', label: "Valentine's Day", window: 'Feb 7 – Feb 14', includes: (d) => between(d, 2, 7, 2, 14) },
  { skin: 'july4', label: 'July 4th', window: 'Jun 28 – Jul 5', includes: (d) => between(d, 6, 28, 7, 5) },
  { skin: 'halloween', label: 'Halloween', window: 'Oct 15 – Oct 31', includes: (d) => between(d, 10, 15, 10, 31) },
  {
    skin: 'thanksgiving',
    label: 'Thanksgiving',
    window: '10 days before – the day after',
    includes: (d) => {
      const t = thanksgiving(d.getFullYear());
      return between(d, 11, t - 10, 11, t + 1);
    },
  },
  { skin: 'christmas', label: 'Christmas', window: 'Dec 1 – Dec 26', includes: (d) => between(d, 12, 1, 12, 26) },
];

export const seasonFor = (d: Date) => SEASONS.find((s) => s.includes(d));

/** Same skin all day, a different one tomorrow. Holiday skins are left out (Seasonal mode covers those). */
export function dailySkin(d: Date): Skin {
  const pool = SKINS.filter((s) => s.group !== 'Holidays');
  const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  // small string hash (FNV-1a) so consecutive days don't walk the list in order
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return pool[(h >>> 0) % pool.length].id;
}

/** The skin to show right now: a holiday in Seasonal mode, else today's random pick, else the user's choice. */
export function activeSkin(o: { skin: Skin; seasonal: boolean; randomDaily: boolean }, d = new Date()): Skin {
  const season = o.seasonal ? seasonFor(d) : undefined;
  if (season) return season.skin;
  if (o.randomDaily) return dailySkin(d);
  return o.skin;
}
