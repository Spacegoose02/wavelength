import type { FastifyInstance } from 'fastify';
import { allowedBy, dontPlayOf } from '../dontPlay.ts';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { featureOn, requireFeature } from '../features.ts';
import { usageSummary } from '../dj/agent.ts';
import { ollamaModels } from '../dj/ollama.ts';
import {
  blockedReason, DEFAULT_MODEL, getAccess, getSettings, keyInfo, MODELS, monthStart, PROVIDERS, EFFORTS, OPENAI_VOICE_MODELS, priceOf, VOICE_ENGINES, saveSettings, setAccess, spentSince, webFor,
} from '../dj/settings.ts';
import { clientIp, HttpError, need, signedIn } from '../http.ts';
import { getUser, listUsers } from '../users.ts';

/**
 * The AI DJ (docs/AI-DJ.md). Listeners chat in the app; the app sends each message here, and the Hub runs the
 * model with the key it keeps. Admins (keys.manage) set it up and switch it on per account.
 */
export function djRoutes(app: FastifyInstance, { db, config, dj, voice, station }: Ctx) {
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
    return { available: !why, reason: why, model: MODELS.find((m) => m.id === s.model)?.label ?? s.model, web: webFor(db, user), ...allowance(user.id) };
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

  /** The talking DJ: `{ previous?, next, name?, style? }` → `{ text }` to read aloud between songs (also DJ mode's links between its songs). */
  app.post('/api/dj/patter', async (req) => {
    const user = listener(req);
    if (!featureOn(db, 'djMode', user)) requireFeature(db, 'djVoice', user);
    return { ...(await dj.patter(user, req.body)), ...allowance(user.id) };
  });

  /** DJ mode: `{ kind?, ask?, playlist?, previous?, recent?, name?, style?, talk? }` → `{ kind, title, songs, intro }`, the next segment. */
  app.post('/api/dj/station', async (req) => {
    const user = listener(req);
    requireFeature(db, 'djMode', user);
    const seg = await station.next(user, req.body);
    // nothing the person said "Don't play" to (dontPlay.ts)
    const ok = allowedBy(dontPlayOf(db, user.id));
    return { ...seg, ...(Array.isArray(seg.songs) && { songs: seg.songs.filter(ok) }), ...allowance(user.id) };
  });

  /** The talking DJ's voices: `{ engine, voices, default, error? }`. `engine: 'device'` = each device reads it. */
  /** The Hub's voice reads the talking DJ's lines and DJ mode's intros: either feature will do. */
  const voiceFeature = (user: Parameters<typeof featureOn>[2]) => {
    if (!featureOn(db, 'djMode', user)) requireFeature(db, 'djVoice', user);
  };

  app.get('/api/dj/voice', async (req) => {
    const user = listener(req);
    voiceFeature(user);
    return voice.info();
  });

  /** `{ text, voice?, speed?, style? }` → an MP3 of the line, read by the Hub's voice (Kokoro or OpenAI). */
  app.post('/api/dj/speak', async (req, reply) => {
    const user = listener(req);
    voiceFeature(user);
    const { audio, type } = await voice.speak(user, req.body);
    return reply.type(type).header('cache-control', 'no-store').send(audio);
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
      openaiKey: keyInfo(db, key, 'openaiKey'),
      ollamaKey: keyInfo(db, key, 'ollamaKey'),
      voiceEngines: VOICE_ENGINES,
      openaiVoiceModels: OPENAI_VOICE_MODELS,
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

  /** The voice list for the admin page (Kokoro's comes from its container). */
  app.get('/api/admin/dj/voice', async (req) => {
    need(req, 'keys.manage');
    return voice.info();
  });

  /** `{ text?, voice? }` → an MP3 in the saved voice, so admins can hear it. Not counted against anyone. */
  app.post('/api/admin/dj/voice/test', async (req, reply) => {
    need(req, 'keys.manage');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const { audio, type } = await voice.speak(null, { text: 'Hey, this is DJ Trash Panda. Here’s how I sound between your songs.', ...b });
    return reply.type(type).header('cache-control', 'no-store').send(audio);
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
  /** `{ which?: 'chat' | 'quick' }`: check the chat's provider, or the one writing the short lines. */
  app.post('/api/admin/dj/test', async (req) => {
    need(req, 'keys.manage');
    const which = (req.body as { which?: unknown } | null)?.which === 'quick' ? 'quick' : 'chat';
    return { message: await dj.provider(which).test() };
  });

  /** The models on the saved Ollama server, for the admin page's picker. */
  app.get('/api/admin/dj/ollama', async (req) => {
    need(req, 'keys.manage');
    const s = getSettings(db);
    if (!s.ollamaUrl) return { models: [], error: null };
    try {
      return { models: await ollamaModels(s.ollamaUrl, dj.ollamaWebFetch), error: null };
    } catch {
      return { models: [], error: `Couldn’t reach Ollama at ${s.ollamaUrl}` };
    }
  });
}
