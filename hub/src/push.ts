import { randomBytes } from 'node:crypto';
import type { Db } from './db.ts';
import { seal, unseal } from './crypto.ts';
import type { NoticeKind } from './notify.ts';

/**
 * Push notifications through ntfy (https://ntfy.sh, or one the household runs), so news reaches a phone
 * while Wavelength is closed. An admin picks the ntfy server (nothing is sent anywhere until they do); each
 * person who turns it on gets their own hard-to-guess topic, which they subscribe to in the ntfy app. Every
 * notification the Hub writes (notify.ts) is then also posted to the topics of the people it's for.
 *
 * What's sent: the notification's title and text, nothing else. On ntfy.sh anyone who knows a topic can
 * read it, so the topic is the secret; a private ntfy server with an access token keeps it in the house.
 */

const SETTINGS = 'push';
const TOPICS = 'push.topics';
const AAD = 'push.token';

export interface PushSettings { server: string; token?: string }

const read = <T>(db: Db, key: string): T | undefined => {
  const row = db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(key) as { value: string } | undefined;
  try {
    return row ? (JSON.parse(row.value) as T) : undefined;
  } catch {
    return undefined;
  }
};
const write = (db: Db, key: string, v: unknown) =>
  db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(v));

/** The admin's ntfy server, if push is set up. The token stays sealed here. */
export const pushSettings = (db: Db): PushSettings | undefined => read<PushSettings>(db, SETTINGS);

/** `server: ''` turns push off for everyone. `token: undefined` keeps the saved one, `null` removes it. */
export function savePushSettings(db: Db, key: Buffer, v: { server: string; token?: string | null }) {
  if (!v.server) {
    db.prepare('DELETE FROM hub_settings WHERE key = ?').run(SETTINGS);
    return;
  }
  const old = pushSettings(db);
  const token = v.token === undefined ? old?.token : v.token ? seal(key, v.token, AAD) : undefined;
  write(db, SETTINGS, { server: v.server, ...(token && { token }) });
}

const topics = (db: Db) => read<Record<string, string>>(db, TOPICS) ?? {};
export const topicOf = (db: Db, userId: number): string | undefined => topics(db)[String(userId)];

/** Turn push on for someone: a new topic each time, so turning it off and on again cuts off old subscribers. */
export function newTopic(db: Db, userId: number): string {
  const topic = `wl-${randomBytes(15).toString('base64url').replace(/[-_]/g, 'x')}`;
  write(db, TOPICS, { ...topics(db), [userId]: topic });
  return topic;
}

export function dropTopic(db: Db, userId: number) {
  const t = topics(db);
  delete t[String(userId)];
  write(db, TOPICS, t);
}

const TAGS: Record<NoticeKind, string> = {
  'request.new': 'inbox_tray', 'request.ready': 'white_check_mark', 'request.rejected': 'no_entry', 'request.have': 'cd',
  'request.failed': 'warning', share: 'gift', radar: 'new', library: 'books', report: 'bar_chart', rewind: 'rewind',
};

/** Post one notification to a topic (ntfy's JSON form, so titles in any language arrive whole). Throws when it isn't accepted. */
export async function postPush(db: Db, key: Buffer, topic: string, kind: NoticeKind, title: string, body: string, click?: string) {
  const s = pushSettings(db);
  if (!s) throw new Error('Push notifications aren’t set up on this Hub');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (s.token) headers.authorization = `Bearer ${unseal(key, s.token, AAD)}`;
  const r = await fetch(`${s.server}/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ topic, title, message: body, tags: [TAGS[kind] ?? 'bell'], ...(click && { click }) }),
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  if (!r.ok) throw new Error(`ntfy answered ${r.status}${r.status === 401 || r.status === 403 ? ': check the access token' : ''}`);
}

/** notify.ts calls this for every notification it writes. Errors are logged, never thrown. */
export function pushNotices(db: Db, key: Buffer, userIds: number[], kind: NoticeKind, title: string, body: string, click?: string) {
  if (!pushSettings(db)) return;
  const t = topics(db);
  for (const id of new Set(userIds)) {
    const topic = t[String(id)];
    if (topic) postPush(db, key, topic, kind, title, body, click).catch((e) => console.warn(`push to user ${id} failed: ${(e as Error).message}`));
  }
}
