import type { Db } from './db.ts';
import { HttpError } from './http.ts';

/**
 * Feature switches (Settings → Features, admins). Each new feature that goes beyond playing music can be
 * turned off for the whole household, and some separately for kid profiles. The app reads them from
 * GET /api/me (`features`) and hides what's off; Hub routes that serve a feature check it too (`requireFeature`).
 * Kept in hub_settings as one JSON row; unknown keys are dropped, missing ones take their defaults.
 *
 * The same list, with the labels shown to admins, lives in the app's src/lib/features.ts. Add a feature in both.
 */

export const FEATURES = {
  homeMixes: { on: true, kids: true },
  blend: { on: true, kids: true },
  smartOffline: { on: true, kids: true },
  sonic: { on: false, kids: true },
  automix: { on: true, kids: true },
  cast: { on: true, kids: true },
  djVoice: { on: false, kids: false },
  artistInfo: { on: true, kids: true },
  tourDates: { on: false, kids: false },
  singMode: { on: true, kids: true },
  musicVideos: { on: true, kids: false },
  publicShares: { on: false, kids: false },
  discordStatus: { on: true, kids: false },
  mouthTuner: { on: true, kids: true },
  exclusiveAudio: { on: false, kids: false },
} as const satisfies Record<string, FeatureSwitch>;

export type FeatureKey = keyof typeof FEATURES;
export interface FeatureSwitch {
  /** on for the household */
  on: boolean;
  /** on for kid profiles too (only matters while `on`) */
  kids: boolean;
}
export type Features = Record<FeatureKey, FeatureSwitch>;

const KEY = 'features';
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];
export const isFeature = (k: unknown): k is FeatureKey => typeof k === 'string' && k in FEATURES;

export function getFeatures(db: Db): Features {
  const row = db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  let saved: Record<string, Partial<FeatureSwitch>> = {};
  try {
    saved = row ? JSON.parse(row.value) : {};
  } catch {
    saved = {};
  }
  const out = {} as Features;
  for (const k of FEATURE_KEYS) {
    const s = saved[k] ?? {};
    out[k] = { on: typeof s.on === 'boolean' ? s.on : FEATURES[k].on, kids: typeof s.kids === 'boolean' ? s.kids : FEATURES[k].kids };
  }
  return out;
}

/** `{ homeMixes: { on: false }, … }`: only the keys and fields sent change. */
export function putFeatures(db: Db, patch: unknown): Features {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new HttpError(400, 'Send { features: { key: { on, kids } } }');
  const cur = getFeatures(db);
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!isFeature(k)) throw new HttpError(400, `Unknown feature: ${k.slice(0, 40)}`);
    const p = (v ?? {}) as Partial<FeatureSwitch>;
    if (p.on !== undefined && typeof p.on !== 'boolean') throw new HttpError(400, `${k}.on must be true or false`);
    if (p.kids !== undefined && typeof p.kids !== 'boolean') throw new HttpError(400, `${k}.kids must be true or false`);
    cur[k] = { on: p.on ?? cur[k].on, kids: p.kids ?? cur[k].kids };
  }
  db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(cur));
  return cur;
}

/** Whether a feature is on for this person. */
export function featureOn(db: Db, key: FeatureKey, user: { role: string }): boolean {
  const f = getFeatures(db)[key];
  return f.on && (user.role !== 'kid' || f.kids);
}

/** Refuse a route whose feature is off for this person (403, with `feature` so the app can say why). */
export function requireFeature(db: Db, key: FeatureKey, user: { role: string }) {
  if (!featureOn(db, key, user)) throw new HttpError(403, 'An admin turned this feature off', { feature: key });
}
