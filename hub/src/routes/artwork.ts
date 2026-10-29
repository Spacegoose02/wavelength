import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { decodeImage, downloadImage, findArt } from '../artwork.ts';
import { audit } from '../audit.ts';
import { clientIp, HttpError, need, signedIn, str } from '../http.ts';

/**
 * Cover art kept on the Hub (docs/HUB.md "Cover art"). An admin looks an album or artist up on Deezer, Apple
 * Music, the Cover Art Archive or fanart.tv, or uploads a picture; the Hub saves the image in its data folder
 * and every device shows it in place of the server's own. Nothing is written to the music files or folders.
 */

interface Row { id: number; kind: string; artist: string; album: string; file: string; source: string; set_by_name: string | null; updated_at: number }
const toArt = (r: Row) => ({ id: r.id, kind: r.kind, artist: r.artist, album: r.album, url: `/api/art/${r.file}`, source: r.source, setBy: r.set_by_name, updatedAt: r.updated_at });

const FILE = /^[0-9a-f]{32}\.(jpg|png|webp)$/;
const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const SOURCES = ['Deezer', 'Apple Music', 'Cover Art Archive', 'fanart.tv'];

function target(b: unknown) {
  const kind = str(b, 'kind', 10);
  if (kind !== 'album' && kind !== 'artist') throw new HttpError(400, 'kind is album or artist');
  const artist = str(b, 'artist', 300);
  const album = kind === 'album' ? str(b, 'album', 300) : '';
  if (!artist || (kind === 'album' && !album)) throw new HttpError(400, kind === 'album' ? 'Send the artist and album' : 'Send the artist');
  return { kind, artist, album } as const;
}

export function artworkRoutes(app: FastifyInstance, { db, config }: Ctx) {
  const dir = join(config.dataDir, 'artwork');
  const SELECT = 'SELECT a.*, u.display_name AS set_by_name FROM artwork a LEFT JOIN users u ON u.id = a.set_by';
  const label = (t: { kind: string; artist: string; album: string }) => `${t.kind}: ${t.artist}${t.album ? ` – ${t.album}` : ''}`;

  app.get('/api/artwork', async (req) => {
    signedIn(req);
    return { artwork: (db.prepare(`${SELECT} ORDER BY a.updated_at DESC`).all() as unknown as Row[]).map(toArt) };
  });

  /**
   * The image itself. Open to anyone, because an <img> can't send the device token: file names are 128 random
   * bits, only handed out by the signed-in list above, and a new picture always gets a new name.
   */
  app.get<{ Params: { file: string } }>('/api/art/:file', async (req, reply) => {
    const { file } = req.params;
    const path = join(dir, file);
    if (!FILE.test(file) || !existsSync(path)) throw new HttpError(404, 'No such picture');
    return reply
      .header('content-type', TYPES[file.split('.')[1]])
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .send(readFileSync(path));
  });

  app.get('/api/admin/artwork/search', async (req) => {
    need(req, 'library.edit');
    const t = target(req.query);
    return findArt(t.kind, t.artist, t.album, { fanartKey: config.fanartKey, version: config.version });
  });

  /**
   * `{ kind, artist, album?, url? | image? , source? }`: a picture from a link (one the search found, or any
   * image link) or an upload (`image`, base64). The same album or artist again replaces its picture.
   */
  app.put('/api/admin/artwork', { bodyLimit: 22 * 1024 * 1024 }, async (req) => {
    const { user } = need(req, 'library.edit');
    const b = req.body as Record<string, unknown> | null;
    const t = target(b);
    const link = str(b, 'url', 2000);
    const image = typeof b?.image === 'string' ? b.image : '';
    if (!link === !image) throw new HttpError(400, 'Send an image link or an uploaded image');
    const { bytes, type } = image ? decodeImage(image) : await downloadImage(link);
    const named = str(b, 'source', 40);
    const source = image ? 'upload' : SOURCES.includes(named) ? named : 'link';

    mkdirSync(dir, { recursive: true });
    const file = `${randomBytes(16).toString('hex')}.${type}`;
    writeFileSync(join(dir, file), bytes);
    const old = db.prepare('SELECT file FROM artwork WHERE kind = ? AND artist = ? COLLATE NOCASE AND album = ? COLLATE NOCASE').get(t.kind, t.artist, t.album) as { file: string } | undefined;
    db.prepare(`INSERT INTO artwork (kind, artist, album, file, source, set_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (kind, artist COLLATE NOCASE, album COLLATE NOCASE)
      DO UPDATE SET file = excluded.file, source = excluded.source, set_by = excluded.set_by, updated_at = excluded.updated_at`)
      .run(t.kind, t.artist, t.album, file, source, user.id, Date.now());
    if (old) rmSync(join(dir, old.file), { force: true });

    const r = db.prepare(`${SELECT} WHERE a.kind = ? AND a.artist = ? COLLATE NOCASE AND a.album = ? COLLATE NOCASE`).get(t.kind, t.artist, t.album) as unknown as Row;
    audit(db, { actorId: user.id, action: 'artwork.set', target: label(t), detail: { source, bytes: bytes.length }, ip: clientIp(req) });
    return { artwork: toArt(r) };
  });

  /** Back to the server's own picture. */
  app.delete<{ Params: { id: string } }>('/api/admin/artwork/:id', async (req) => {
    const { user } = need(req, 'library.edit');
    const r = db.prepare('SELECT * FROM artwork WHERE id = ?').get(Number(req.params.id)) as Row | undefined;
    if (!r) throw new HttpError(404, 'No such picture');
    db.prepare('DELETE FROM artwork WHERE id = ?').run(r.id);
    rmSync(join(dir, r.file), { force: true });
    audit(db, { actorId: user.id, action: 'artwork.reset', target: label(r), ip: clientIp(req) });
    return { ok: true };
  });
}
