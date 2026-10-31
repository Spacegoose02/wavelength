import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { usageSummary } from '../dj/agent.ts';
import {
  blockedReason, DEFAULT_MODEL, getAccess, getSettings, keyInfo, MODELS, monthStart, PROVIDERS, EFFORTS, priceOf, saveSettings, setAccess, spentSince,
} from '../dj/settings.ts';
import { clientIp, HttpError, need, signedIn } from '../http.ts';
import { getUser, listUsers } from '../users.ts';

/**
 * The AI DJ (docs/AI-DJ.md). Listeners chat in the app; the app sends each message here, and the Hub runs the
 * model with the key it keeps. Admins (keys.manage) set it up and switch it on per account.
 */
export function djRoutes(app: FastifyInstance, { db, config, dj }: Ctx) {
  const key = config.secretKey;

  /** Signed in, and allowed to use the DJ right now. */
  const listener = (req: Parameters<typeof signedIn>[0]) => {
    const { user } = signedIn(req);
    const why = blockedReason(db, key, user);
    if (why) throw new HttpError(403, why);
    return user;
  };

  const allowance = (userId: number) => {
    const { monthlyLimit } = getAccess(db, userId);
    return { spent: spentSince(db, monthStart(), userId), limit: monthlyLimit };
  };

  /** Whether this person can use the DJ, and how much of their allowance is left. The app shows the DJ only when `available`. */
  app.get('/api/dj', async (req) => {
    const { user } = signedIn(req);
    const why = blockedReason(db, key, user);
    const s = getSettings(db);
    return { available: !why, reason: why, model: MODELS.find((m) => m.id === s.model)?.label ?? s.model, ...allowance(user.id) };
  });

  app.get('/api/dj/chats', async (req) => {
    const user = listener(req);
    return { chats: dj.list(user.id), ...allowance(user.id) };
  });

  app.get<{ Params: { id: string } }>('/api/dj/chats/:id', async (req) => dj.get(listener(req).id, Number(req.params.id)));

  app.delete<{ Params: { id: string } }>('/api/dj/chats/:id', async (req) => {
    dj.delete(listener(req).id, Number(req.params.id));
    return { ok: true };
  });

  /** `{ chatId?, message }` → the DJ's answer, or tool calls for the app to run (`status: 'tools'`). */
  app.post('/api/dj/chat', async (req) => {
    const user = listener(req);
    const b = (req.body ?? {}) as { chatId?: unknown; message?: unknown };
    const chatId = typeof b.chatId === 'number' ? b.chatId : null;
    const out = await dj.send(user, chatId, typeof b.message === 'string' ? b.message : '');
    return { ...out, ...allowance(user.id) };
  });

  /** `{ results: [{ id, content, isError? }] }` for the calls the app was given. */
  app.post<{ Params: { id: string } }>('/api/dj/chats/:id/tools', async (req) => {
    const user = listener(req);
    const out = await dj.toolResults(user, Number(req.params.id), (req.body as { results?: unknown } | null)?.results);
    return { ...out, ...allowance(user.id) };
  });

  // ---- admin ----

  const adminView = () => {
    const settings = getSettings(db);
    const month = monthStart();
    const usage = usageSummary(db, month) as unknown as { byUser: { userId: number; cost: number; calls: number }[] } & Record<string, unknown>;
    const spent = new Map(usage.byUser.map((u) => [u.userId, u]));
    const users = listUsers(db).map((u) => {
      const a = getAccess(db, u.id);
      const s = spent.get(u.id);
      return { id: u.id, displayName: u.displayName, username: u.username, role: u.role, disabled: u.disabled, enabled: a.enabled, monthlyLimit: a.monthlyLimit, spent: s?.cost ?? 0, calls: s?.calls ?? 0 };
    });
    return {
      settings,
      key: keyInfo(db, key),
      providers: PROVIDERS,
      efforts: EFFORTS,
      models: MODELS,
      defaultModel: DEFAULT_MODEL,
      price: priceOf(settings, settings.model),
      users,
      month: { spent: spentSince(db, month), ...usage },
      allTime: spentSince(db, 0),
    };
  };

  app.get('/api/admin/dj', async (req) => {
    need(req, 'keys.manage');
    return adminView();
  });

  app.put('/api/admin/dj', async (req) => {
    const { user } = need(req, 'keys.manage');
    const { changed } = saveSettings(db, key, req.body);
    if (changed.length) audit(db, { actorId: user.id, action: 'dj.settings', detail: { changed }, ip: clientIp(req) });
    return adminView();
  });

  /** `{ enabled?, monthlyLimit? }` for one account. */
  app.put<{ Params: { userId: string } }>('/api/admin/dj/users/:userId', async (req) => {
    const { user } = need(req, 'keys.manage');
    const target = getUser(db, Number(req.params.userId));
    if (!target) throw new HttpError(404, 'No such user');
    const b = (req.body ?? {}) as { enabled?: unknown; monthlyLimit?: unknown };
    const access = setAccess(db, target.id, { ...(b.enabled !== undefined && { enabled: b.enabled === true }), ...(b.monthlyLimit !== undefined && { monthlyLimit: b.monthlyLimit }) });
    audit(db, { actorId: user.id, action: 'dj.access', target: target.username, detail: access, ip: clientIp(req) });
    return { access };
  });

  /** Check the key and model without spending tokens. */
  app.post('/api/admin/dj/test', async (req) => {
    need(req, 'keys.manage');
    return { message: await dj.provider().test() };
  });
}
