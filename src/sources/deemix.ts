import { getJson, http, qs, trimSlash } from '../lib/http';

export interface DeezerResult {
  type: 'track' | 'album' | 'artist';
  id: number;
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  duration?: number;
  link: string;
  trackCount?: number;
}

/** Search the public Deezer catalog (no login needed). */
export async function searchDeezer(q: string): Promise<DeezerResult[]> {
  const [albums, tracks] = await Promise.all([
    getJson(`https://api.deezer.com/search/album?${qs({ q, limit: 24 })}`),
    getJson(`https://api.deezer.com/search?${qs({ q, limit: 40 })}`),
  ]);
  return [
    ...(albums.data ?? []).map((a: any) => ({
      type: 'album' as const,
      id: a.id,
      title: a.title,
      artist: a.artist?.name,
      cover: a.cover_medium,
      link: a.link,
      trackCount: a.nb_tracks,
    })),
    ...(tracks.data ?? []).map((t: any) => ({
      type: 'track' as const,
      id: t.id,
      title: t.title,
      artist: t.artist?.name,
      album: t.album?.title,
      cover: t.album?.cover_medium,
      duration: t.duration,
      link: t.link,
    })),
  ];
}

/** Talks to a deemix web server (deemix-gui / deemix-docker). */
export class Deemix {
  constructor(private url: string, private arl?: string) {}

  private get base() {
    return trimSlash(this.url);
  }

  private async post(path: string, body: unknown) {
    const res = await http(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (!res.ok) throw new Error(json?.errid ?? json?.error ?? `${res.status} from deemix`);
    return json;
  }

  async login() {
    if (!this.arl) throw new Error('deemix is not logged in and no ARL is set in Settings');
    const r = await this.post('/api/loginArl', { arl: this.arl, force: true, child: 0 });
    if (r?.status === 0 || r?.status === false) throw new Error('deemix rejected the ARL');
  }

  /** bitrate: 9 = FLAC, 3 = MP3 320, 1 = MP3 128 */
  async addToQueue(link: string, bitrate?: number) {
    const send = async () => {
      const r = await this.post('/api/addToQueue', { url: link, bitrate: bitrate ?? null });
      // deemix answers 200 with { result: false, errid } on failure — treat that as an error
      if (r?.result === false) throw new Error(r?.errid ?? r?.data?.error ?? 'deemix refused the download');
      return r;
    };
    try {
      return await send();
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      if (!/NotLoggedIn|login/i.test(msg)) throw new Error(friendly(msg));
      // each Wavelength session starts logged out on deemix's side — log in with the ARL and retry
      if (!this.arl) throw new Error('deemix isn\'t logged in — add your Deezer ARL in Settings → deemix');
      await this.login();
      return send();
    }
  }

  async getQueue(): Promise<any> {
    return getJson(`${this.base}/api/getQueue`);
  }

  async test() {
    const r = await getJson(`${this.base}/api/connect`);
    let user = r?.currentUser?.name;
    if (!user && this.arl) {
      await this.login();
      user = (await getJson(`${this.base}/api/connect`).catch(() => null))?.currentUser?.name ?? 'your ARL';
    }
    return user ? `Connected to deemix, logged in as ${user}` : 'Reached deemix, but it is NOT logged in — add your Deezer ARL below';
  }
}

function friendly(msg: string) {
  if (/fetch|connect|ECONNREFUSED|error sending request/i.test(msg)) return "Can't reach deemix — check its URL in Settings";
  return `deemix: ${msg}`;
}
