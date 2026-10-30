import { relative, resolve, sep } from 'node:path';
import type { Db } from './db.ts';
import { filesSince } from './genres.ts';
import { HttpError } from './http.ts';
import { audit } from './audit.ts';
import { deemixPrefix, type Library } from './library.ts';
import { hubDeemix } from './routes/proxy.ts';
import { saveTagChanges } from './routes/tags.ts';
import { readTags, type Tags } from './tags.ts';

/**
 * Clean versions in their own folder (docs/USERS-AND-ADMIN.md §6.5). Deezer gives an album's clean version the
 * same artist and title as the explicit one, so deemix would name its folder and files the same and skip every
 * song as already there. deemix has no folder setting per download, but it reads its settings when a download
 * starts and downloads one album at a time. So the Hub queues each clean version on its own: it waits until
 * deemix has nothing to do, adds " (Clean)" to deemix's album folder name, queues the album, and puts the folder
 * name back as soon as deemix starts on it. When the download is in, the songs' album tag gets " (Clean)" too
 * (with a music folder), so Navidrome keeps the two versions apart and Wavelength knows which one is clean.
 */

export const CLEAN_MARK = ' (Clean)';
const RESTORE_KEY = 'deemix.cleanRestore';
const SINCE_KEY = 'deemix.cleanSince';
const IDLE_WAIT_MS = 12 * 3600_000;
const START_WAIT_MS = 10 * 60_000;
const ALBUM_CLEAN = /[([]\s*(clean|edited|censored)\b[^)\]]*[)\]]/i;

export interface CleanJob {
  link: string;
  state: 'waiting' | 'queued' | 'failed';
  error?: string;
  at: number;
}

type Item = { uuid?: string; status?: string };
const items = (q: any): Item[] => Object.values<Item>(q?.queue ?? {}).filter((i) => typeof i?.uuid === 'string');

export class CleanDownloads {
  private db: Db;
  private key: Buffer;
  private musicDir: string;
  private library: Library;
  private chain: Promise<void> = Promise.resolve();
  private jobs = new Map<string, CleanJob>();
  /** Shorter in tests. */
  pollMs = 3000;

  constructor(db: Db, key: Buffer, musicDir: string, library: Library) {
    this.db = db;
    this.key = key;
    this.musicDir = musicDir;
    this.library = library;
    library.onNewMusic.push(() => this.tagNew());
    // the Hub stopped half way last time: put deemix's folder name back
    if (this.saved()) this.chain = this.restore().catch(() => undefined);
  }

  /** Clean versions waiting for deemix, or that couldn't be queued (recent ones). */
  list(): CleanJob[] {
    const old = Date.now() - 24 * 3600_000;
    for (const [k, j] of this.jobs) if (j.state !== 'waiting' && j.at < old) this.jobs.delete(k);
    return [...this.jobs.values()];
  }

  /** Queue a clean version. Returns straight away; it reaches deemix once deemix has nothing else to do. */
  add(link: string, bitrate: number) {
    if (!deemixPrefix(link)?.startsWith('album_')) throw new HttpError(400, 'Send a Deezer album link');
    hubDeemix(this.db, this.key); // 404 now when there's no deemix
    const cur = this.jobs.get(link);
    if (cur?.state === 'waiting') return cur;
    const job: CleanJob = { link, state: 'waiting', at: Date.now() };
    this.jobs.set(link, job);
    this.library.activity();
    this.chain = this.chain.then(() => this.run(job, bitrate)).catch(() => undefined);
    return job;
  }

  /** Resolves once everything added so far has been handed to deemix (tests). */
  idle() {
    return this.chain;
  }

  private async run(job: CleanJob, bitrate: number) {
    try {
      const { client } = hubDeemix(this.db, this.key);
      // nothing waiting or downloading, so this album is the next one deemix starts
      await this.until(async () => !items(await client.getQueue()).some((i) => i.status === 'inQueue' || i.status === 'downloading'), IDLE_WAIT_MS, 'deemix stayed busy');
      const { settings, spotifySettings } = await client.getSettings();
      const orig = { albumNameTemplate: unmark(String(settings.albumNameTemplate ?? '%artist% - %album%')), createAlbumFolder: settings.createAlbumFolder !== false };
      this.save(orig);
      const template = orig.albumNameTemplate + CLEAN_MARK;
      try {
        await client.saveSettings({ ...settings, albumNameTemplate: template, createAlbumFolder: true }, spotifySettings, (s) => s.albumNameTemplate === template);
        this.db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(SINCE_KEY, String(Date.now()));
        await client.addToQueue(job.link, bitrate);
        const prefix = deemixPrefix(job.link)!;
        // started (or already finished or gone): deemix has read the folder name for it
        await this.until(async () => !items(await client.getQueue()).some((i) => i.uuid!.startsWith(prefix) && i.status === 'inQueue'), START_WAIT_MS, "deemix didn't start it");
        Object.assign(job, { state: 'queued', at: Date.now() });
      } finally {
        await this.restore();
      }
      audit(this.db, { action: 'download.clean', target: job.link, detail: { folder: template } });
    } catch (e) {
      Object.assign(job, { state: 'failed', error: (e as Error).message.slice(0, 300), at: Date.now() });
    }
  }

  private async until(ok: () => Promise<boolean>, ms: number, why: string) {
    const end = Date.now() + ms;
    while (!(await ok())) {
      if (Date.now() > end) throw new HttpError(504, why);
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
  }

  private saved(): { albumNameTemplate: string; createAlbumFolder: boolean } | undefined {
    const row = this.db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(RESTORE_KEY) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  private save(v: { albumNameTemplate: string; createAlbumFolder: boolean }) {
    this.db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(RESTORE_KEY, JSON.stringify(v));
  }

  /** Put deemix's own folder settings back (keeping anything else changed meanwhile). */
  private async restore() {
    const orig = this.saved();
    if (!orig) return;
    const { client } = hubDeemix(this.db, this.key);
    const { settings, spotifySettings } = await client.getSettings();
    if (settings.albumNameTemplate !== orig.albumNameTemplate || settings.createAlbumFolder !== orig.createAlbumFolder) {
      await client.saveSettings({ ...settings, ...orig }, spotifySettings, (s) => s.albumNameTemplate === orig.albumNameTemplate);
    }
    this.db.prepare('DELETE FROM hub_settings WHERE key = ?').run(RESTORE_KEY);
  }

  /** New downloads in a "… (Clean)" folder: add " (Clean)" to their album tag (Library.onNewMusic). */
  async tagNew() {
    const row = this.db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(SINCE_KEY) as { value: string } | undefined;
    if (!row || !this.musicDir) return;
    const since = Number(row.value) - 60_000;
    // in a "… (Clean)" folder, or a CD folder inside one
    const inClean = (f: string) => relative(resolve(this.musicDir), f).split(sep).slice(0, -1).some((d) => d.endsWith(CLEAN_MARK.trim()));
    const files = filesSince(this.musicDir, since).filter(inClean);
    const plan: { file: string; tags: Tags }[] = [];
    for (const file of files) {
      const album = (await readTags(file).catch(() => ({}) as Tags)).album;
      if (album && !ALBUM_CLEAN.test(album)) plan.push({ file, tags: { album: album + CLEAN_MARK } });
    }
    // nothing still on its way: stop looking
    if (!this.list().some((j) => j.state === 'waiting') && Date.now() - Number(row.value) > 24 * 3600_000) this.db.prepare('DELETE FROM hub_settings WHERE key = ?').run(SINCE_KEY);
    if (plan.length) await saveTagChanges(this.db, this.musicDir, plan, 'Clean versions', null);
  }
}

const unmark = (t: string) => (t.endsWith(CLEAN_MARK) ? t.slice(0, -CLEAN_MARK.length) : t);
