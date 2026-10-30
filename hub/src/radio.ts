import { connect as tcpConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

/**
 * Song titles from inside internet radio streams (ICY / "Shoutcast" metadata), for the browser app, which can't
 * ask a station for them itself (the station would need CORS headers and to expose `icy-metaint`). The desktop
 * and Android apps read them directly (src/lib/icy.ts; keep the two parsers in step, test/radio.test.ts checks).
 *
 * Talks HTTP/1.0 over a plain socket because old Shoutcast servers answer `ICY 200 OK`, which Node's HTTP
 * client refuses. Reads one metadata block (at most metaint + 4 KB of audio), then hangs up.
 */

export const MAX_METAINT = 256 * 1024;
const MAX_HEAD = 16 * 1024;
const TIMEOUT_MS = 8_000;

export interface IcyResult {
  /** false when the station doesn't send titles in its stream at all. */
  icy: boolean;
  /** The current song ('' while the station sends none). */
  title: string;
}

/** Same rules as src/lib/icy.ts parseIcyMetadata. */
export function parseIcyMetadata(bytes: Uint8Array): string | undefined {
  const text = decode(bytes).replace(/\0+$/, '');
  const m = /StreamTitle='([\s\S]*?)';(?=\s*(?:[A-Za-z]+=|$))/.exec(text) ?? /StreamTitle='([\s\S]*?)'?;?\s*$/.exec(text);
  if (!m) return undefined;
  return cleanIcyTitle(m[1]);
}

export function cleanIcyTitle(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(t)) return '';
  if (/^(unknown|unknown - unknown|n\/a|null|undefined)$/i.test(t)) return '';
  return t;
}

function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

export function streamUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new IcyError('Send a stream link');
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) throw new IcyError('Send an http(s) stream link');
  return u;
}

export class IcyError extends Error {}

/** Ask a station for its current title, following up to 3 redirects. */
export async function readStationTitle(raw: string, timeoutMs = TIMEOUT_MS): Promise<IcyResult> {
  let url = streamUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    const r = await readOnce(url, timeoutMs);
    if ('location' in r) {
      url = streamUrl(new URL(r.location, url).toString());
      continue;
    }
    return r;
  }
  throw new IcyError('Too many redirects');
}

function readOnce(url: URL, timeoutMs: number): Promise<IcyResult | { location: string }> {
  return new Promise((resolve, reject) => {
    const https = url.protocol === 'https:';
    const port = Number(url.port) || (https ? 443 : 80);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const sock: Socket = https ? tlsConnect({ host, port, servername: /^[\d.:]+$/.test(host) ? undefined : host }) : tcpConnect({ host, port });
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      fn();
    };
    const fail = (msg: string) => done(() => reject(new IcyError(msg)));
    const timer = setTimeout(() => fail(`No answer from ${url.hostname}`), timeoutMs);

    sock.once(https ? 'secureConnect' : 'connect', () => {
      sock.write(
        `GET ${url.pathname}${url.search} HTTP/1.0\r\n` +
          `Host: ${url.host}\r\n` +
          'User-Agent: Mozilla/5.0 (Windows NT 10.0) Wavelength\r\n' +
          'Accept: */*\r\n' +
          'Icy-MetaData: 1\r\n' +
          'Connection: close\r\n\r\n',
      );
    });
    sock.on('error', () => fail(`Couldn't reach ${url.hostname}`));
    sock.on('end', () => fail('The station hung up before its first title'));

    let buf = Buffer.alloc(0);
    let metaint = -1;
    sock.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (metaint < 0) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) {
          if (buf.length > MAX_HEAD) fail('Not a radio stream');
          return;
        }
        const lines = buf.subarray(0, end).toString('latin1').split('\r\n');
        buf = buf.subarray(end + 4);
        const status = /^(?:HTTP\/\d(?:\.\d)?|ICY)\s+(\d{3})/.exec(lines[0]);
        if (!status) return fail('Not a radio stream');
        const headers = new Map<string, string>();
        for (const l of lines.slice(1)) {
          const i = l.indexOf(':');
          if (i > 0) headers.set(l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim());
        }
        const code = Number(status[1]);
        const location = headers.get('location');
        if (code >= 300 && code < 400 && location) return done(() => resolve({ location }));
        if (code < 200 || code >= 300) return fail(`The station answered ${code}`);
        const n = Number(headers.get('icy-metaint'));
        if (!Number.isInteger(n) || n <= 0 || n > MAX_METAINT) return done(() => resolve({ icy: false, title: '' }));
        metaint = n;
      }
      if (buf.length < metaint + 1) return;
      const len = buf[metaint] * 16;
      if (buf.length < metaint + 1 + len) return;
      const title = len ? (parseIcyMetadata(buf.subarray(metaint + 1, metaint + 1 + len)) ?? '') : '';
      done(() => resolve({ icy: true, title }));
    });
  });
}

/**
 * Titles asked for in the last 10 s, so many listeners of one station (or a fast-polling app) cost the
 * station one connection, not one each.
 */
export class StationTitles {
  private cache = new Map<string, { at: number; result: Promise<IcyResult> }>();
  private read: (url: string) => Promise<IcyResult>;
  private ttlMs: number;
  constructor(read: (url: string) => Promise<IcyResult> = readStationTitle, ttlMs = 10_000) {
    this.read = read;
    this.ttlMs = ttlMs;
  }

  get(url: string): Promise<IcyResult> {
    const now = Date.now();
    const hit = this.cache.get(url);
    if (hit && now - hit.at < this.ttlMs) return hit.result;
    if (this.cache.size > 500) for (const [k, v] of this.cache) if (now - v.at >= this.ttlMs) this.cache.delete(k);
    const result = this.read(url);
    this.cache.set(url, { at: now, result });
    result.catch(() => this.cache.delete(url));
    return result;
  }
}
