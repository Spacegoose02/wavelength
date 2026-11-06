import type { IndexedAlbum, IndexedArtist, IndexedSong } from './api/library.ts';

/**
 * Search over the Hub's list of every Navidrome song (libraryIndex.ts), for the app's Search page
 * (`GET /api/library/search`, docs/HUB.md "Search").
 *
 * Navidrome's own search only finds words as they're typed. This one:
 * - forgives typos ("beyonse", "kendirck") and finds words by their start ("kend lam"),
 * - ignores accents, case, "&" vs "and", and punctuation ("acdc" finds AC/DC, "gods plan" finds God's Plan),
 * - puts what this person plays first (their plays per artist, from the `plays` table).
 *
 * Built once per listing as an inverted index: every word of every title, artist and album points at its songs.
 * A query looks each of its words up in the vocabulary (exact, then prefix, then one or two letters off) and keeps
 * the songs that matched every word.
 */

const TITLE = 0;
const ARTIST = 1;
const ALBUM = 2;
const FIELD_WEIGHT = [1, 0.9, 0.6];
const EXACT = 1;
const PREFIX = 0.7;
const FUZZY = 0.45;

/** Words of a name: lower case, no accents, "&" as "and", apostrophes dropped ("God's" → "gods"). */
export function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Damerau–Levenshtein distance, giving up (returning max + 1) once it's over `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = b.length;
  let prev2 = new Array<number>(n + 1).fill(0);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(n + 1);
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

/** How many letters a word of this length may be off by. */
const allowed = (len: number) => (len >= 8 ? 2 : len >= 4 ? 1 : 0);

export interface SearchOptions {
  /** plays per artist for the person searching, keyed by `words(artist).join(' ')` */
  plays?: Map<string, number>;
  songs?: number;
  albums?: number;
  artists?: number;
}

export interface SearchResult {
  songs: IndexedSong[];
  albums: IndexedAlbum[];
  artists: IndexedArtist[];
  didYouMean?: string;
}

export class SearchIndex {
  private songs: IndexedSong[];
  /** word → songs it appears in, as `song * 4 + field` */
  private postings = new Map<string, number[]>();
  private vocab: string[] = [];
  private artistKey: string[] = [];

  constructor(songs: IndexedSong[]) {
    this.songs = songs;
    songs.forEach((s, i) => {
      const add = (text: string | undefined, field: number) => {
        if (!text) return;
        const ws = words(text);
        // the whole name run together too, so "acdc" or "blink182" find "AC/DC" and "blink-182"
        if (ws.length > 1) ws.push(ws.join(''));
        for (const w of new Set(ws)) {
          let list = this.postings.get(w);
          if (!list) this.postings.set(w, (list = []));
          list.push(i * 4 + field);
        }
      };
      add(s.title, TITLE);
      add(s.artist, ARTIST);
      add(s.album, ALBUM);
      this.artistKey.push(words(s.artist).join(' '));
    });
    this.vocab = [...this.postings.keys()];
  }

  get size() {
    return this.songs.length;
  }

  /** Vocabulary words that a query word matches, with how well. */
  private lookup(q: string): { word: string; how: number }[] {
    const out: { word: string; how: number }[] = [];
    const max = allowed(q.length);
    for (const w of this.vocab) {
      if (w === q) out.push({ word: w, how: EXACT });
      else if (q.length >= 2 && w.startsWith(q)) out.push({ word: w, how: PREFIX });
      else if (max && w[0] === q[0] && editDistance(q, w, max) <= max) out.push({ word: w, how: FUZZY });
      else if (max && q.length >= 5 && w.length >= q.length && editDistance(q, w.slice(0, q.length), 1) <= 1) out.push({ word: w, how: FUZZY * 0.9 });
    }
    return out;
  }

  search(query: string, opts: SearchOptions = {}): SearchResult {
    const qs = [...new Set(words(query))];
    const empty: SearchResult = { songs: [], albums: [], artists: [] };
    if (!qs.length || !this.songs.length) return empty;

    const n = this.songs.length;
    // per song: summed best score over the query's words, and how many words matched, for three scopes:
    // anywhere (songs), in the artist or album (albums), in the artist (artists)
    const scope = () => ({ score: new Float32Array(n), hits: new Uint8Array(n) });
    const all = scope();
    const alb = scope();
    const art = scope();
    let corrected = false;
    const fixed: string[] = [];

    for (const q of qs) {
      const matches = this.lookup(q);
      const exact = matches.some((m) => m.how === EXACT || m.how === PREFIX);
      if (!exact) {
        const best = matches.filter((m) => m.how < PREFIX).sort((a, b) => (this.postings.get(b.word)?.length ?? 0) - (this.postings.get(a.word)?.length ?? 0))[0];
        if (best) corrected = true;
        fixed.push(best?.word ?? q);
      } else fixed.push(q);
      const bestAll = new Map<number, number>();
      const bestAlb = new Map<number, number>();
      const bestArt = new Map<number, number>();
      for (const m of matches) {
        for (const p of this.postings.get(m.word) ?? []) {
          const song = p >> 2;
          const field = p & 3;
          const v = m.how * FIELD_WEIGHT[field];
          if (v > (bestAll.get(song) ?? 0)) bestAll.set(song, v);
          if (field !== TITLE && v > (bestAlb.get(song) ?? 0)) bestAlb.set(song, v);
          if (field === ARTIST && v > (bestArt.get(song) ?? 0)) bestArt.set(song, v);
        }
      }
      const merge = (best: Map<number, number>, into: ReturnType<typeof scope>) => {
        for (const [song, v] of best) {
          into.score[song] += v;
          into.hits[song]++;
        }
      };
      merge(bestAll, all);
      merge(bestAlb, alb);
      merge(bestArt, art);
    }

    const need = qs.length;
    const phrase = qs.join(' ');
    const boost = (i: number) => Math.log2(1 + (opts.plays?.get(this.artistKey[i]) ?? 0)) * 0.35;

    const songHits: { i: number; s: number }[] = [];
    for (let i = 0; i < n; i++) {
      if (all.hits[i] !== need) continue;
      const title = words(this.songs[i].title).join(' ');
      let s = all.score[i] / need;
      if (title === phrase) s += 1;
      else if (title.startsWith(`${phrase} `)) s += 0.5;
      songHits.push({ i, s: s + boost(i) });
    }
    songHits.sort((a, b) => b.s - a.s);

    const albums = new Map<string, { album: IndexedAlbum; s: number }>();
    const artists = new Map<string, { artist: IndexedArtist; s: number; albums: Set<string> }>();
    for (let i = 0; i < n; i++) {
      const song = this.songs[i];
      if (alb.hits[i] === need && song.albumId) {
        const s = alb.score[i] / need + boost(i);
        const cur = albums.get(song.albumId);
        if (!cur) {
          albums.set(song.albumId, {
            s,
            album: {
              id: song.albumId,
              name: song.album ?? '',
              artist: song.artist,
              ...(song.artistId && { artistId: song.artistId }),
              ...(song.year && { year: song.year }),
              ...(song.coverArt && { coverArt: song.coverArt }),
              songCount: 1,
            },
          });
        } else {
          cur.album.songCount++;
          if (s > cur.s) cur.s = s;
        }
      }
      if (art.hits[i] === need) {
        const id = song.artistId ?? `name:${this.artistKey[i]}`;
        const s = art.score[i] / need + boost(i);
        const cur = artists.get(id);
        if (!cur) artists.set(id, { s, albums: new Set(song.albumId ? [song.albumId] : []), artist: { id, name: song.artist, ...(song.coverArt && { coverArt: song.coverArt }), albumCount: 0 } });
        else {
          if (song.albumId) cur.albums.add(song.albumId);
          if (s > cur.s) cur.s = s;
        }
      }
    }
    const top = <T>(m: Iterable<{ s: number } & T>, k: number) => [...m].sort((a, b) => b.s - a.s).slice(0, k);

    return {
      songs: songHits.slice(0, opts.songs ?? 60).map((h) => this.songs[h.i]),
      albums: top(albums.values(), opts.albums ?? 30).map((a) => a.album),
      artists: top(artists.values(), opts.artists ?? 20).map((a) => ({ ...a.artist, albumCount: a.albums.size })),
      ...(corrected && { didYouMean: fixed.join(' ') }),
    };
  }
}
