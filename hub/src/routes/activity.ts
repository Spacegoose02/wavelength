import type { FastifyInstance } from 'fastify';
import type { ActivityReport, HouseActivity, HouseListener } from '../api/activity.ts';
import type { Ctx } from '../app.ts';
import { guardiansOf } from '../family.ts';
import { HttpError, signedIn } from '../http.ts';
import { songNotForKids } from '../kidSafe.ts';
import { getPrefs } from '../prefs.ts';
import { getUser } from '../users.ts';

/**
 * House activity (docs/USER-GUIDE.md "Who's listening"): what the people in the house are playing right now, for
 * the app's sidebar, with Join when they're hosting a party. Each device reports its song (names only); the Hub
 * keeps the last one per person in memory for a few minutes.
 *
 * Privacy: grown-ups show unless they turn "Show the house what I'm playing" off; kids only show if they turn it on,
 * and then only to their own grown-ups. Kids looking see no songs that aren't for kids. Nobody sees themselves.
 */

const FRESH_MS = 5 * 60_000; // a report older than this is gone (paused for a while, or the app closed)

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export function activityRoutes(app: FastifyInstance, { db }: Ctx) {
  const now = new Map<number, HouseListener>(); // by user

  /** `settings.shareListening` from their synced settings: true / false, or unset (grown-ups yes, kids no). */
  const shares = (userId: number, role: string) => {
    const v = getPrefs(db, userId)['settings.shareListening']?.value;
    return typeof v === 'boolean' ? v : role !== 'kid';
  };

  app.put('/api/me/activity', async (req) => {
    const { user, device } = signedIn(req);
    const b = (req.body ?? {}) as Partial<ActivityReport>;
    const title = text(b.title, 200);
    if (!title) throw new HttpError(400, 'title is required');
    if (!shares(user.id, user.role)) {
      now.delete(user.id);
      return { ok: true, shared: false };
    }
    now.set(user.id, {
      userId: user.id,
      displayName: user.displayName,
      title,
      artist: text(b.artist, 200),
      ...(text(b.album, 200) && { album: text(b.album, 200) }),
      playing: b.playing === true,
      device: device.name,
      at: Date.now(),
    });
    return { ok: true, shared: true };
  });

  /** Stopped, or turned sharing off. */
  app.delete('/api/me/activity', async (req) => {
    now.delete(signedIn(req).user.id);
    return { ok: true };
  });

  app.get('/api/activity', async (req): Promise<HouseActivity> => {
    const { user: me } = signedIn(req);
    const t = Date.now();
    const listeners: HouseListener[] = [];
    for (const [id, l] of now) {
      if (t - l.at > FRESH_MS) {
        now.delete(id);
        continue;
      }
      if (id === me.id) continue;
      const who = getUser(db, id);
      if (!who || who.disabled || !shares(id, who.role)) continue;
      if (who.role === 'kid' && !guardiansOf(db, id).includes(me.id)) continue;
      if (me.role === 'kid' && songNotForKids(db, { title: l.title, artist: l.artist, album: l.album })) continue;
      listeners.push({ ...l, displayName: who.displayName });
    }
    listeners.sort((a, b) => Number(b.playing) - Number(a.playing) || b.at - a.at);
    return { listeners };
  });
}
