import { randomBytes } from 'node:crypto';
import type { Db } from './db.ts';
import { esc, HttpError } from './http.ts';

/**
 * Public share links (the publicShares feature): a playlist, album, song or artist anyone with the link can look
 * at in a browser, without an account. Only names go out (title, artist, album, length, a public cover); never
 * a stream, a file or a login. Each song links to a search on the big services so the person can play it there.
 * Links can expire and their owner can take them down.
 */

export const PUBLIC_KINDS = ['playlist', 'album', 'track', 'artist'] as const;
const MAX_TRACKS = 500;

export interface PublicTrack {
  title: string;
  artist: string;
  album?: string;
  duration?: number;
}

export interface PublicLink {
  token: string;
  kind: string;
  title: string;
  subtitle: string | null;
  cover: string | null;
  note: string | null;
  tracks: PublicTrack[];
  artist: string | null;
  createdAt: number;
  expiresAt: number | null;
  views: number;
  owner?: string;
}

/** A cover only when it's a plain public https image (Navidrome / Plex links carry a login in the query). */
export function safeCover(url: unknown): string | null {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url) || url.length > 1000) return null;
  try {
    const u = new URL(url);
    for (const k of u.searchParams.keys()) if (/^(u|t|s|p|token|x-plex-token|apikey|api_key|jwt|auth|c|v)$/i.test(k)) return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

interface Row {
  token: string; user_id: number; kind: string; title: string; subtitle: string | null; cover: string | null; note: string | null;
  payload: string; created_at: number; expires_at: number | null; views: number; owner?: string;
}

function toLink(r: Row): PublicLink {
  const p = JSON.parse(r.payload) as { tracks?: PublicTrack[]; artist?: string };
  return {
    token: r.token, kind: r.kind, title: r.title, subtitle: r.subtitle, cover: r.cover, note: r.note, tracks: p.tracks ?? [], artist: p.artist ?? null,
    createdAt: r.created_at, expiresAt: r.expires_at, views: r.views, owner: r.owner,
  };
}

export function createLink(db: Db, userId: number, body: unknown): PublicLink {
  const b = (body ?? {}) as Record<string, unknown>;
  const kind = text(b.kind, 20);
  if (!(PUBLIC_KINDS as readonly string[]).includes(kind)) throw new HttpError(400, `kind is one of ${PUBLIC_KINDS.join(', ')}`);
  const title = text(b.title, 200);
  if (!title) throw new HttpError(400, 'Send a title');
  const payload = (b.payload ?? {}) as { tracks?: unknown; artist?: unknown };
  const tracks: PublicTrack[] = (Array.isArray(payload.tracks) ? payload.tracks : []).slice(0, MAX_TRACKS).flatMap((t: Record<string, unknown>) => {
    const title = text(t?.title, 300), artist = text(t?.artist, 300);
    if (!title) return [];
    const duration = typeof t.duration === 'number' && t.duration > 0 && t.duration < 86_400 ? Math.round(t.duration) : undefined;
    return [{ title, artist, ...(text(t.album, 300) && { album: text(t.album, 300) }), ...(duration && { duration }) }];
  });
  const artist = kind === 'artist' ? text(payload.artist, 300) || title : null;
  if (kind !== 'artist' && !tracks.length) throw new HttpError(400, 'There are no songs to share');
  const days = Number(b.days);
  const now = Date.now();
  const expiresAt = Number.isFinite(days) && days > 0 ? now + Math.min(days, 3650) * 86_400_000 : null;
  const token = randomBytes(12).toString('base64url');
  db.prepare('INSERT INTO public_links (token, user_id, kind, title, subtitle, cover, note, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(token, userId, kind, title, text(b.subtitle, 200) || null, safeCover(b.cover), text(b.note, 500) || null, JSON.stringify(artist ? { artist } : { tracks }), now, expiresAt);
  return getLink(db, token)!;
}

export function getLink(db: Db, token: string): PublicLink | null {
  const r = db.prepare('SELECT l.*, u.display_name AS owner FROM public_links l JOIN users u ON u.id = l.user_id WHERE l.token = ? AND u.disabled = 0').get(token) as Row | undefined;
  return r ? toLink(r) : null;
}

export function myLinks(db: Db, userId: number): PublicLink[] {
  return (db.prepare('SELECT * FROM public_links WHERE user_id = ? ORDER BY created_at DESC LIMIT 500').all(userId) as unknown as Row[]).map((r) => {
    const l = toLink(r);
    return { ...l, tracks: [], songs: l.tracks.length } as PublicLink & { songs: number };
  });
}

/** Owners take down their own links; admins (`all`) anyone's. */
export function deleteLink(db: Db, token: string, userId: number, all: boolean) {
  const r = db.prepare(all ? 'DELETE FROM public_links WHERE token = ?' : 'DELETE FROM public_links WHERE token = ? AND user_id = ?').run(...(all ? [token] : [token, userId]));
  if (!r.changes) throw new HttpError(404, 'No such link');
}

export const seen = (db: Db, token: string) => db.prepare('UPDATE public_links SET views = views + 1 WHERE token = ?').run(token);

const mmss = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');
const search = (q: string) => [
  ['YouTube Music', `https://music.youtube.com/search?q=${encodeURIComponent(q)}`],
  ['Spotify', `https://open.spotify.com/search/${encodeURIComponent(q)}`],
  ['Apple Music', `https://music.apple.com/search?term=${encodeURIComponent(q)}`],
  ['Deezer', `https://www.deezer.com/search/${encodeURIComponent(q)}`],
];
const links = (q: string, cls = '') => search(q).map(([n, u]) => `<a class="${cls}" href="${esc(u)}" rel="noopener noreferrer" target="_blank">${esc(n)}</a>`).join('');

/** The page anyone with the link sees. */
export function linkPage(l: PublicLink): string {
  const head = l.kind === 'artist' ? l.artist ?? l.title : l.kind === 'track' && l.tracks[0] ? `${l.tracks[0].artist} ${l.tracks[0].title}` : `${l.title} ${l.subtitle ?? ''}`;
  const rows = l.kind === 'artist' ? '' : `<ol>${l.tracks.map((t) => `<li><div class="t"><b>${esc(t.title)}</b><span>${esc([t.artist, t.album].filter(Boolean).join(' · '))}</span></div><span class="d">${mmss(t.duration)}</span><div class="s">${links(`${t.artist} ${t.title}`)}</div></li>`).join('')}</ol>`;
  const total = l.tracks.reduce((s, t) => s + (t.duration ?? 0), 0);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(l.title)} · shared from Wavelength</title>
<meta property="og:title" content="${esc(l.title)}"><meta property="og:description" content="${esc(l.subtitle ?? `Shared by ${l.owner ?? 'someone'}`)}">
${l.cover ? `<meta property="og:image" content="${esc(l.cover)}">` : ''}
<style>
  :root { color-scheme: dark; --bg:#0d0a1a; --panel:#17122b; --line:#2c2350; --text:#ece8ff; --muted:#a59fc4; --accent:#ff3df2; --accent2:#21e6ff; }
  * { box-sizing: border-box; } body { margin:0; background:radial-gradient(circle at 50% -20%, #2a1550, var(--bg) 60%); color:var(--text); font:16px/1.5 system-ui, sans-serif; min-height:100vh; }
  main { max-width:760px; margin:0 auto; padding:28px 16px 60px; }
  header { display:flex; gap:20px; align-items:flex-end; flex-wrap:wrap; margin-bottom:20px; }
  header img { width:180px; height:180px; object-fit:cover; border-radius:${l.kind === 'artist' ? '50%' : '14px'}; box-shadow:0 0 40px #ff3df233; }
  .k { text-transform:uppercase; letter-spacing:.12em; font-size:12px; color:var(--accent2); } h1 { margin:4px 0; font-size:32px; line-height:1.15; }
  .m { color:var(--muted); } .note { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:12px 14px; margin:0 0 18px; }
  .play { display:flex; gap:8px; flex-wrap:wrap; margin:12px 0 22px; } .play a, .s a { text-decoration:none; color:#120c24; background:linear-gradient(90deg, var(--accent), var(--accent2)); padding:8px 12px; border-radius:999px; font-weight:600; font-size:14px; }
  ol { list-style:none; padding:0; margin:0; counter-reset:n; } li { counter-increment:n; display:grid; grid-template-columns:2em 1fr auto; gap:4px 10px; padding:10px 8px; border-bottom:1px solid var(--line); }
  li::before { content:counter(n); color:var(--muted); text-align:right; } .t { display:flex; flex-direction:column; min-width:0; } .t span { color:var(--muted); font-size:14px; }
  .d { color:var(--muted); font-size:14px; } .s { grid-column:2 / 4; display:none; gap:6px; flex-wrap:wrap; } li:hover .s, li:focus-within .s { display:flex; } .s a { padding:4px 9px; font-size:12px; background:var(--panel); color:var(--text); border:1px solid var(--line); }
  footer { margin-top:30px; color:var(--muted); font-size:13px; text-align:center; }
</style></head>
<body><main>
<header>${l.cover ? `<img src="${esc(l.cover)}" alt="">` : ''}<div><div class="k">${esc(l.kind === 'track' ? 'Song' : l.kind)}</div><h1>${esc(l.title)}</h1>
<div class="m">${esc([l.subtitle, l.tracks.length > 1 ? `${l.tracks.length} songs${total ? `, ${Math.round(total / 60)} min` : ''}` : ''].filter(Boolean).join(' · '))}</div>
<div class="m">Shared by ${esc(l.owner ?? 'someone')}</div></div></header>
${l.note ? `<p class="note">${esc(l.note)}</p>` : ''}
<div class="play">${links(head)}</div>
${rows}
<footer>Shared from Wavelength. Tap a song for places to play it.</footer>
</main></body></html>`;
}
