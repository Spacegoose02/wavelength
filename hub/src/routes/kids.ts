import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { hashPassword, verifyPassword } from '../crypto.ts';
import type { Db } from '../db.ts';
import { clientIp, HttpError, signedIn } from '../http.ts';
import { familyActor, familyPinKey, getFamily } from '../families.ts';

/**
 * Kid profiles (docs/USERS-AND-ADMIN.md §6.5): an admin sets each kid's bedtime and daily listening limit,
 * and one grown-up PIN for the household. The kid's devices report listening time here (so the limit holds
 * across devices), stop at bedtime or when time is up, and ask for the PIN to keep going or to sign out.
 */

export interface KidRules {
  bedtimeFrom: string | null;
  bedtimeTo: string | null;
  dailyMinutes: number | null;
}

const NO_RULES: KidRules = { bedtimeFrom: null, bedtimeTo: null, dailyMinutes: null };
const PIN_KEY = 'kid_pin';

function rulesFor(db: Db, userId: number): KidRules {
  const r = db.prepare('SELECT bedtime_from, bedtime_to, daily_minutes FROM kid_rules WHERE user_id = ?').get(userId) as
    | { bedtime_from: string | null; bedtime_to: string | null; daily_minutes: number | null }
    | undefined;
  return r ? { bedtimeFrom: r.bedtime_from, bedtimeTo: r.bedtime_to, dailyMinutes: r.daily_minutes } : NO_RULES;
}

const used = (db: Db, userId: number, day: string) =>
  (db.prepare('SELECT seconds FROM listening WHERE user_id = ? AND day = ?').get(userId, day) as { seconds: number } | undefined)?.seconds ?? 0;

const setting = (db: Db, key: string) => (db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
/**
 * The grown-up PIN for this person: their family's own (set by its manager, families.ts), else the Hub's.
 * Without `familyId`, the Hub's.
 */
const pinHash = (db: Db, familyId?: number | null) => (familyId ? setting(db, familyPinKey(familyId)) : null) ?? setting(db, PIN_KEY);

/** The device's local date, as it sent it; anything else is refused. */
function dayOf(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, "Send the day as 'YYYY-MM-DD'");
  return v;
}

/** 'HH:MM', null to clear, undefined to keep. */
function time(v: unknown, name: string): string | null | undefined {
  if (v === undefined || v === null || v === '') return v === undefined ? undefined : null;
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new HttpError(400, `${name} is a time like 20:30`);
  return v;
}

export function kidRoutes(app: FastifyInstance, { db, limits }: Ctx) {
  /** This profile's rules, how long it listened on `?day=`, and whether a PIN is set. */
  app.get('/api/me/kid', async (req) => {
    const { user } = signedIn(req);
    const day = dayOf((req.query as { day?: unknown }).day);
    return { kid: user.role === 'kid', rules: user.role === 'kid' ? rulesFor(db, user.id) : NO_RULES, usedSeconds: used(db, user.id, day), pinSet: !!pinHash(db, user.familyId) };
  });

  /** Add listening time (a device reports every minute or so). `{ day, seconds }`, at most 5 minutes at once. */
  app.post('/api/me/listened', async (req) => {
    const { user } = signedIn(req);
    const b = (req.body ?? {}) as { day?: unknown; seconds?: unknown };
    const day = dayOf(b.day);
    const seconds = typeof b.seconds === 'number' && Number.isFinite(b.seconds) ? Math.round(Math.min(Math.max(b.seconds, 0), 300)) : 0;
    if (seconds) {
      db.prepare(`INSERT INTO listening (user_id, day, seconds) VALUES (?, ?, ?)
        ON CONFLICT (user_id, day) DO UPDATE SET seconds = seconds + excluded.seconds`).run(user.id, day, seconds);
      // keep about two months
      db.prepare("DELETE FROM listening WHERE user_id = ? AND day < date(?, '-60 days')").run(user.id, day);
    }
    return { usedSeconds: used(db, user.id, day) };
  });

  /** Check the grown-up PIN (to keep listening after bedtime or the limit, or to sign out of a kid profile). */
  app.post('/api/kid/unlock', async (req) => {
    const { user } = signedIn(req);
    const pin = (req.body as { pin?: unknown } | null)?.pin;
    const hash = pinHash(db, user.familyId);
    if (!hash) throw new HttpError(404, 'No grown-up PIN is set. An admin sets one under Settings → Users');
    limits.login.hit(`pin:${user.id}`);
    const ok = typeof pin === 'string' && (await verifyPassword(pin, hash));
    audit(db, { actorId: user.id, action: ok ? 'kid.unlocked' : 'kid.pin_failed', ip: clientIp(req) });
    if (!ok) throw new HttpError(403, "That's not the PIN");
    limits.login.clear(`pin:${user.id}`);
    return { ok: true };
  });

  // ---- admins, and family managers for their own family's kids (families.ts `kidControls`) ----

  /** Every kid (a manager: their family's) with their rules and listening on `?day=`, and whether the PIN is set. */
  app.get('/api/admin/kids', async (req) => {
    const actor = familyActor(db, signedIn(req), 'kidControls');
    const day = dayOf((req.query as { day?: unknown }).day);
    const familyId = actor.admin ? null : actor.family!.id;
    const kids = (familyId
      ? db.prepare("SELECT id, display_name, family_id FROM users WHERE role = 'kid' AND family_id = ? ORDER BY display_name COLLATE NOCASE").all(familyId)
      : db.prepare("SELECT id, display_name, family_id FROM users WHERE role = 'kid' ORDER BY display_name COLLATE NOCASE").all()) as { id: number; display_name: string; family_id: number | null }[];
    return {
      pinSet: familyId ? !!pinHash(db, familyId) : !!setting(db, PIN_KEY),
      ...(familyId && { familyPinSet: !!setting(db, familyPinKey(familyId)) }),
      kids: kids.map((k) => ({ userId: k.id, displayName: k.display_name, familyId: k.family_id, rules: rulesFor(db, k.id), usedSeconds: used(db, k.id, day) })),
    };
  });

  /** `{ bedtimeFrom?, bedtimeTo?, dailyMinutes? }`; null clears one. */
  app.put<{ Params: { userId: string } }>('/api/admin/kids/:userId', async (req) => {
    const auth = signedIn(req);
    const admin = auth.user;
    const id = Number(req.params.userId);
    const kid = db.prepare('SELECT id, role, display_name, family_id FROM users WHERE id = ?').get(id) as { id: number; role: string; display_name: string; family_id: number | null } | undefined;
    const actor = familyActor(db, auth, 'kidControls');
    if (!kid || (!actor.admin && kid.family_id !== actor.family!.id)) throw new HttpError(404, 'No such user');
    if (kid.role !== 'kid') throw new HttpError(400, 'Bedtime and limits are for kid profiles');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const cur = rulesFor(db, id);
    const from = time(b.bedtimeFrom, 'Bedtime');
    const to = time(b.bedtimeTo, 'Wake-up time');
    let minutes = cur.dailyMinutes;
    if (b.dailyMinutes !== undefined) {
      if (b.dailyMinutes === null || b.dailyMinutes === '' || b.dailyMinutes === 0) minutes = null;
      else if (typeof b.dailyMinutes === 'number' && Number.isInteger(b.dailyMinutes) && b.dailyMinutes > 0 && b.dailyMinutes <= 1440) minutes = b.dailyMinutes;
      else throw new HttpError(400, 'The daily limit is a number of minutes (1 to 1440), or null for none');
    }
    const next: KidRules = { bedtimeFrom: from === undefined ? cur.bedtimeFrom : from, bedtimeTo: to === undefined ? cur.bedtimeTo : to, dailyMinutes: minutes };
    if (!next.bedtimeFrom !== !next.bedtimeTo) throw new HttpError(400, 'Set both bedtime and wake-up time, or neither');
    db.prepare(`INSERT INTO kid_rules (user_id, bedtime_from, bedtime_to, daily_minutes, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET bedtime_from = excluded.bedtime_from, bedtime_to = excluded.bedtime_to, daily_minutes = excluded.daily_minutes, updated_at = excluded.updated_at`)
      .run(id, next.bedtimeFrom, next.bedtimeTo, next.dailyMinutes, Date.now());
    audit(db, { actorId: admin.id, action: 'kid.rules', target: kid.display_name, detail: next, ip: clientIp(req) });
    return { rules: next };
  });

  /**
   * `{ pin }` (4 to 8 digits) sets the grown-up PIN; `{ pin: null }` removes it. `familyId` sets that family's
   * own PIN instead (a manager always sets their family's), which its kids' devices ask for in place of the Hub's.
   */
  app.put('/api/admin/kid-pin', async (req) => {
    const auth = signedIn(req);
    const b = (req.body ?? {}) as { pin?: unknown; familyId?: unknown };
    const actor = familyActor(db, auth, 'kidControls', b.familyId === undefined || b.familyId === null ? undefined : Number(b.familyId));
    if (actor.admin && b.familyId != null && !actor.family) throw new HttpError(404, 'No such family');
    const family = actor.family ?? (actor.admin ? undefined : getFamily(db, auth.user.familyId));
    const key = family ? familyPinKey(family.id) : PIN_KEY;
    const pin = b.pin;
    if (pin === null) db.prepare('DELETE FROM hub_settings WHERE key = ?').run(key);
    else if (typeof pin === 'string' && /^\d{4,8}$/.test(pin)) {
      db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, await hashPassword(pin));
    } else throw new HttpError(400, 'The PIN is 4 to 8 digits');
    audit(db, { actorId: auth.user.id, action: pin === null ? 'kid.pin_removed' : 'kid.pin_set', ...(family && { target: family.name }), ip: clientIp(req) });
    return { pinSet: pin !== null };
  });
}
