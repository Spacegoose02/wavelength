import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Everything the Hub reads from its environment. See docs/HUB.md for the full list. */
export interface Config {
  version: string;
  port: number;
  host: string;
  dataDir: string;
  /** Public base URL people open in a browser, e.g. https://hub.example.com. Used for the pairing link. */
  publicUrl: string;
  /** 32 random bytes. Signs pairing forms and (through a derived key) encrypts stored server logins. */
  secretKey: Buffer;
  sso: SsoConfig;
  /** The music library folder (mounted at /music in Docker). yt-dlp saves into it. Empty = not mounted. */
  musicDir: string;
  /** yt-dlp command; the Docker image ships it with ffmpeg. */
  ytdlpBin: string;
  /** The app's web build, served at / so Wavelength works in a browser. Empty or missing = not served. */
  webDir: string;
}

export interface SsoConfig {
  enabled: boolean;
  /** Proxy addresses allowed to send identity headers (exact IPs). */
  trustedProxies: string[];
  /** If set, the proxy must also send `X-Wavelength-Proxy-Secret` with this value. */
  proxySecret: string;
  /** Create a Wavelength user the first time an SSO user signs in. Off = the admin adds people first. */
  autoCreate: boolean;
  /** SSO usernames that are always admins. */
  admins: string[];
  /** tinyauth group whose members are admins. */
  adminGroup: string;
}

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const bool = (v: string | undefined, def: boolean) => (v === undefined || v === '' ? def : /^(1|true|yes|on)$/i.test(v));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = env.WAVELENGTH_DATA_DIR || './data';
  mkdirSync(dataDir, { recursive: true });
  const sso: SsoConfig = {
    enabled: bool(env.WAVELENGTH_SSO, false),
    trustedProxies: list(env.WAVELENGTH_TRUSTED_PROXIES),
    proxySecret: env.WAVELENGTH_PROXY_SECRET ?? '',
    autoCreate: bool(env.WAVELENGTH_SSO_AUTO_CREATE, false),
    admins: list(env.WAVELENGTH_ADMINS).map((s) => s.toLowerCase()),
    adminGroup: env.WAVELENGTH_ADMIN_GROUP ?? '',
  };
  if (sso.enabled && !sso.trustedProxies.length && !sso.proxySecret) {
    // Without either, anyone who can reach the Hub could send `Remote-User: admin`.
    throw new Error('WAVELENGTH_SSO is on but neither WAVELENGTH_TRUSTED_PROXIES nor WAVELENGTH_PROXY_SECRET is set');
  }
  return {
    version: (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version,
    port: Number(env.PORT || 7780),
    host: env.HOST || '0.0.0.0',
    dataDir,
    publicUrl: (env.WAVELENGTH_PUBLIC_URL || `http://localhost:${env.PORT || 7780}`).replace(/\/+$/, ''),
    secretKey: loadSecretKey(env.WAVELENGTH_SECRET_KEY, dataDir),
    sso,
    musicDir: (env.WAVELENGTH_MUSIC_DIR ?? '').replace(/\/+$/, ''),
    ytdlpBin: env.WAVELENGTH_YTDLP || 'yt-dlp',
    // the image puts the web build next to src/
    webDir: (env.WAVELENGTH_WEB_DIR ?? fileURLToPath(new URL('../web', import.meta.url))).replace(/\/+$/, ''),
  };
}

/** From the environment (base64 or hex, 32 bytes), else a key generated once into the data folder. */
function loadSecretKey(value: string | undefined, dataDir: string): Buffer {
  if (value) {
    const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
    if (key.length !== 32) throw new Error('WAVELENGTH_SECRET_KEY must be 32 bytes (64 hex characters or base64)');
    return key;
  }
  const file = join(dataDir, 'secret.key');
  if (existsSync(file)) return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  const key = randomBytes(32);
  writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  return key;
}
