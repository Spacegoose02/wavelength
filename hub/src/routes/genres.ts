import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { filesSince, genreKey, genreLookup, genresSince, genreTargets, getGenreSettings, normalizeGenre, saveGenreSettings, setGenresSince, type GenreRule } from '../genres.ts';
import { clientIp, HttpError, need } from '../http.ts';
import { getScanSettings } from '../library.ts';
import { libraryFile, readTags, relPath, type Tags } from '../tags.ts';
import { navidromeAdmin } from './navidrome.ts';
import { saveTagChanges } from './tags.ts';

/**
 * Tidy genres (genres.ts), for admins (`library.edit`): the rules, the review of the library (albums whose
 * genre isn't tidy, and genres no rule knows), and applying the tidy genre to albums. Every change is a tag
 * editor Save, so it shows under Settings → Server → Tag edits and can be undone there.
 */

/** "Rap; Hip-Hop" and ["Hip-Hop", "Rap"] are the same genres. */
const sameGenres = (a: string[], b: string) => {
  const x = new Set(a.flatMap((g) => g.split(/\s*[;,/|\\]\s*/)).map(genreKey).filter(Boolean));
  const y = new Set(b.split(/\s*[;,/|\\]\s*/).map(genreKey).filter(Boolean));
  return x.size === y.size && [...x].every((k) => y.has(k));
};

function readRules(v: unknown): GenreRule[] {
  if (!Array.isArray(v) || v.length > 5000) throw new HttpError(400, 'rules must be a list of up to 5000');
  const out = new Map<string, GenreRule>();
  for (const r of v as Record<string, unknown>[]) {
    const from = typeof r?.from === 'string' ? r.from.trim() : '', to = typeof r?.to === 'string' ? r.to.trim() : '';
    if (!genreKey(from) || !genreKey(to) || from.length > 100 || to.length > 100) throw new HttpError(400, 'Each rule needs a genre to change and what it becomes (up to 100 characters)');
    out.set(genreKey(from), { from, to });
  }
  return [...out.values()];
}

export function genreRoutes(app: FastifyInstance, { db, config, library }: Ctx) {
  const admin = async () => {
    const s = getScanSettings(db, config.secretKey);
    if (!s) throw new HttpError(409, 'Add the Navidrome admin login under Settings → Server first');
    return navidromeAdmin(s.url, s.username, s.password);
  };
  const settingsOut = () => {
    const s = getGenreSettings(db);
    return { auto: s.auto, rules: s.rules, defaults: s.defaults, kept: s.keep.length, genres: genreTargets(s.rules) };
  };

  // Downloads that finish from now on are new; the library already there is for the review.
  if (genresSince(db) === null) setGenresSince(db, Date.now());

  /** New downloads: give their files the tidy genre before Navidrome scans them (Library.onNewMusic). */
  library.onNewMusic = async () => {
    const s = getGenreSettings(db);
    const since = genresSince(db) ?? Date.now();
    setGenresSince(db, Date.now());
    if (!s.auto || !config.musicDir) return;
    const lookup = genreLookup(s.rules);
    // files someone edited by hand since keep what they chose
    const edited = new Set((db.prepare('SELECT path FROM tag_edits WHERE at >= ? AND user_id IS NOT NULL').all(since) as { path: string }[]).map((r) => r.path));
    const files = filesSince(config.musicDir, since).filter((f) => !edited.has(relPath(config.musicDir, f)));
    const plan: { file: string; tags: Tags }[] = [];
    for (let i = 0; i < files.length; i += 8) {
      await Promise.all(files.slice(i, i + 8).map(async (file) => {
        const cur = (await readTags(file).catch(() => ({}) as Tags)).genre ?? '';
        const { genre } = normalizeGenre(cur, lookup);
        if (genre && genre !== cur) plan.push({ file, tags: { genre } });
      }));
    }
    if (!plan.length) return;
    const r = await saveTagChanges(db, config.musicDir, plan, 'Genres of new downloads', null);
    if (r.changed.length) audit(db, { action: 'genres.tidied', target: 'new downloads', detail: { files: r.changed.length, failed: r.failed.length } });
  };

  app.get('/api/admin/genres', async (req) => {
    need(req, 'library.edit');
    return settingsOut();
  });

  /** `{ auto?, rules? }`; `rules: null` goes back to the default rules. */
  app.put('/api/admin/genres', { bodyLimit: 1024 * 1024 }, async (req) => {
    const { user } = need(req, 'library.edit');
    const body = (req.body ?? {}) as { auto?: unknown; rules?: unknown };
    if (body.auto !== undefined && typeof body.auto !== 'boolean') throw new HttpError(400, 'auto must be true or false');
    const rules = body.rules === null ? null : body.rules === undefined ? undefined : readRules(body.rules);
    saveGenreSettings(db, { auto: body.auto as boolean | undefined, rules });
    audit(db, { actorId: user.id, action: 'genres.settings', detail: { auto: body.auto, rules: rules === null ? 'defaults' : rules?.length }, ip: clientIp(req) });
    return settingsOut();
  });

  /**
   * The library's albums whose genre isn't the tidy one (with what it would become), and the genres no rule
   * knows, with how many albums have each. Albums an admin chose to keep are left out.
   */
  app.get('/api/admin/genres/review', async (req) => {
    need(req, 'library.edit');
    const s = getGenreSettings(db);
    const lookup = genreLookup(s.rules);
    const keep = new Set(s.keep);
    const albums = await (await admin()).albums();
    const changes: { id: string; name: string; artist: string; songs: number; current: string; proposed: string }[] = [];
    const unknown = new Map<string, { genre: string; albums: number; examples: string[] }>();
    for (const a of albums) {
      if (!a.genres.length || keep.has(a.id)) continue;
      const current = a.genres.join('; ');
      const { genre, unknown: odd } = normalizeGenre(current, lookup);
      if (genre && !sameGenres(a.genres, genre)) changes.push({ id: a.id, name: a.name, artist: a.artist, songs: a.songs, current, proposed: genre });
      for (const g of odd) {
        const u = unknown.get(genreKey(g)) ?? { genre: g, albums: 0, examples: [] };
        u.albums++;
        if (u.examples.length < 3) u.examples.push(`${a.artist} – ${a.name}`);
        unknown.set(genreKey(g), u);
      }
    }
    changes.sort((a, b) => a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name));
    return {
      albums: changes,
      unknown: [...unknown.values()].sort((a, b) => b.albums - a.albums || a.genre.localeCompare(b.genre)),
      total: albums.length,
      kept: keep.size,
      genres: genreTargets(s.rules),
    };
  });

  /** `{ albums: [{ id, genre }] }`: set these albums' genre in every song, as one undoable Save. */
  app.post('/api/admin/genres/apply', async (req) => {
    const { user } = need(req, 'library.edit');
    const list = (req.body as { albums?: unknown } | null)?.albums;
    if (!Array.isArray(list) || !list.length || list.length > 500) throw new HttpError(400, 'Send 1 to 500 albums');
    const wanted = list.map((a: Record<string, unknown>) => {
      const id = typeof a?.id === 'string' ? a.id.slice(0, 100) : '', genre = typeof a?.genre === 'string' ? a.genre.trim() : '';
      if (!id || !genreKey(genre) || genre.length > 200) throw new HttpError(400, 'Each album needs an id and a genre');
      return { id, genre };
    });
    const nd = await admin();
    const plan: { file: string; tags: Tags }[] = [];
    const missing: string[] = [];
    let label = '';
    for (const a of wanted) {
      const songs = await nd.albumSongs(a.id);
      if (!label && songs[0]) label = `${songs[0].albumArtist || songs[0].artist || 'Unknown artist'} – ${songs[0].album || 'Unknown album'}`;
      for (const song of songs) {
        try {
          plan.push({ file: libraryFile(config.musicDir, config.navidromeMusicDir, String(song.path ?? '')), tags: { genre: a.genre } });
        } catch {
          missing.push(String(song.path ?? song.title ?? ''));
        }
      }
    }
    if (!plan.length) throw new HttpError(404, 'The Hub can’t find any of those albums’ files in its music folder');
    label = wanted.length === 1 ? `Genre: ${label}`.slice(0, 200) : `Genres of ${wanted.length} albums`;
    const r = await saveTagChanges(db, config.musicDir, plan, label, user.id);
    if (r.changed.length) {
      audit(db, { actorId: user.id, action: 'genres.applied', target: label, detail: { albums: wanted.length, files: r.changed.length, failed: r.failed.length }, ip: clientIp(req) });
      library.changed();
    }
    return { ...r, label, missing };
  });

  /** `{ ids, keep }`: leave these albums out of the review (or put them back in). */
  app.post('/api/admin/genres/keep', async (req) => {
    const { user } = need(req, 'library.edit');
    const body = req.body as { ids?: unknown; keep?: unknown } | null;
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === 'string' && !!x).map((x) => x.slice(0, 100)) : [];
    if (!ids.length || ids.length > 500) throw new HttpError(400, 'Send 1 to 500 album ids');
    const keep = new Set(getGenreSettings(db).keep);
    for (const id of ids) {
      if (body?.keep === false) keep.delete(id);
      else keep.add(id);
    }
    saveGenreSettings(db, { keep: [...keep].slice(-20000) });
    audit(db, { actorId: user.id, action: 'genres.kept', detail: { albums: ids.length, keep: body?.keep !== false }, ip: clientIp(req) });
    return settingsOut();
  });
}
