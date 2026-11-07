import type { Db } from './db.ts';

/**
 * Joined artist credits (docs/USERS-AND-ADMIN.md, "Joined artist credits"). Navidrome splits a single Artist or
 * Album artist tag into several artists only on its own separators: " / ", " feat. ", " feat ", " ft. ", " ft "
 * and "; " (resources/mappings.yaml in Navidrome). A semicolon with no space after it ("Lil Wayne;Drake"), which
 * many taggers and downloaders write, isn't one of them, so Navidrome lists "Lil Wayne;Drake" as one artist. The
 * Hub rewrites such tags to "Lil Wayne; Drake" so Navidrome splits them: for new downloads before Navidrome scans
 * them (routes/credits.ts), and for the rest of the library from Library care → Unmatched songs in the app.
 */

/** Any semicolon with any spacing around it, the full-width "；" too. */
const SEMI = /\s*[;；]\s*/;

/**
 * The credit written the way Navidrome splits it: "Lil Wayne;Drake" → "Lil Wayne; Drake", "A ; B;C" →
 * "A; B; C". Empty parts ("Drake;") go. A value without a semicolon comes back as it is.
 */
export function tidyCredit(value: string): string {
  if (!SEMI.test(value)) return value;
  return value.split(SEMI).map((p) => p.trim()).filter(Boolean).join('; ');
}

export interface CreditSettings {
  /** Tidy the credits of new downloads before Navidrome scans them. */
  auto: boolean;
}

const KEY = 'credits';
const SINCE_KEY = 'credits.since';

export function getCreditSettings(db: Db): CreditSettings {
  const row = db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  try {
    const v = row ? JSON.parse(row.value) : {};
    return { auto: v.auto ?? true };
  } catch {
    return { auto: true };
  }
}

export function saveCreditSettings(db: Db, s: Partial<CreditSettings>): CreditSettings {
  const next = { ...getCreditSettings(db), ...s };
  db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(next));
  return next;
}

/** When new downloads' credits were last tidied (files changed after this are new). */
export function creditsSince(db: Db): number | null {
  const row = db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(SINCE_KEY) as { value: string } | undefined;
  return row ? Number(row.value) : null;
}
export function setCreditsSince(db: Db, at: number) {
  db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(SINCE_KEY, String(at));
}
