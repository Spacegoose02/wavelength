import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { need, signedIn, str } from '../http.ts';
import { lastPlayedBy } from '../playedBy.ts';

/** How long a "now playing" report counts without another one (devices report every minute while playing). */
const FRESH_MS = 3 * 60_000;

interface Playing {
  userId: number;
  displayName: string;
  role: string;
  deviceId: number;
  deviceName: string;
  platform: string;
  title: string;
  artist: string;
  album: string;
  source: string;
  at: number;
}

/**
 * Who's listening now (docs/USERS-AND-ADMIN.md Phase 2): each device says what it's playing, and admins see
 * it in Settings → Server. Kept in memory only; nothing about listening is stored.
 */
export function listeningRoutes(app: FastifyInstance, _ctx: Ctx) {
  const now = new Map<number, Playing>(); // by device

  app.post('/api/me/playing', async (req) => {
    const { user, device } = signedIn(req);
    const b = req.body ?? {};
    const title = str(b, 'title', 300);
    if (!title || (b as Record<string, unknown>).stopped === true) {
      now.delete(device.id);
      return { ok: true };
    }
    now.set(device.id, {
      userId: user.id, displayName: user.displayName, role: user.role,
      deviceId: device.id, deviceName: device.name, platform: device.platform,
      title, artist: str(b, 'artist', 300), album: str(b, 'album', 300), source: str(b, 'source', 40), at: Date.now(),
    });
    return { ok: true };
  });

  app.get('/api/admin/listening', async (req) => {
    need(req, 'users.manage');
    const cutoff = Date.now() - FRESH_MS;
    for (const [id, p] of now) if (p.at < cutoff) now.delete(id);
    // who sent the song: the Hub from the music folder, Navidrome through the Hub, or (no relay streams) Navidrome directly
    const list = [...now.values()].map((p) => ({ ...p, playedBy: lastPlayedBy(p.deviceId) ?? (p.source === 'navidrome' ? 'direct' : null) }));
    return { listening: list.sort((a, b) => a.displayName.localeCompare(b.displayName)) };
  });
}
