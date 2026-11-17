import { HubClient, type HubHealth } from '../sources/hub';

/**
 * Finding a Hub from the address the way people type it (views/HubSettings.tsx SignedOut, docs/HUB.md "Connecting"):
 * `192.168.1.10`, `192.168.1.10:7780`, `hub.local`, `music.example.com`, a full `https://…` link, or a link to one of
 * the Hub's own pages (`/link`, `/setup`, `/invite/…`). Every likely spelling is tried at once and the first that
 * answers as a Wavelength Hub, in the order below, wins.
 */

/** The Hub's port in the Docker image and the Unraid template. */
export const HUB_PORT = 7780;

/** A LAN address: an IP, localhost, a name without dots, or a home-network name like `nas.local`. */
const isLocal = (host: string) =>
  /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host === 'localhost' || !host.includes('.') || /\.(local|lan|home|internal|localdomain|home\.arpa)$/i.test(host) || host.startsWith('[');

/** The addresses to try for what was typed, most likely first. */
export function hubCandidates(typed: string): string[] {
  let s = typed.trim().replace(/\s+/g, '');
  if (!s) return [];
  // a link to one of the Hub's pages: the Hub is what's in front of it
  s = s.replace(/\/(link|setup|invite\/[\w-]*|auth\/.*)$/i, '').replace(/\/+$/, '');
  const scheme = /^(https?):\/\//i.exec(s);
  if (scheme) {
    const url = s.replace(/^https?/i, scheme[1].toLowerCase());
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return [url];
    }
    // `http://192.168.1.10` (no port) is usually the Hub on its own port
    return parsed.port ? [url] : [url, `${parsed.protocol}//${parsed.host}:${HUB_PORT}${parsed.pathname.replace(/\/+$/, '')}`];
  }
  const host = s.split('/')[0].replace(/:\d+$/, '');
  const hasPort = /^[^/]+:\d+(\/|$)/.test(s) && !s.startsWith('[');
  const out = isLocal(host)
    ? [`http://${s}`, ...(hasPort ? [] : [`http://${withPort(s)}`]), `https://${s}`]
    : [`https://${s}`, `http://${s}`, ...(hasPort ? [] : [`http://${withPort(s)}`])];
  return [...new Set(out)];
}

const withPort = (s: string) => {
  const i = s.indexOf('/');
  return i < 0 ? `${s}:${HUB_PORT}` : `${s.slice(0, i)}:${HUB_PORT}${s.slice(i)}`;
};

export class HubNotFound extends Error {}

/**
 * The first candidate that answers as a Hub, with its health. Throws HubNotFound with a message for people (not a
 * network error) when none does, or when something answered that isn't a Hub.
 */
export async function findHub(typed: string, opts: { timeoutMs?: number; health?: (url: string) => Promise<HubHealth> } = {}): Promise<{ url: string; health: HubHealth }> {
  const list = hubCandidates(typed);
  if (!list.length) throw new HubNotFound('Type your server’s address');
  const timeout = opts.timeoutMs ?? 8000;
  const ask = opts.health ?? ((url: string) => new HubClient(url).health());
  let notHub = false;
  const tries = list.map((url) =>
    Promise.race([
      ask(url).then((h) => {
        if (h?.ok !== true) {
          notHub = true;
          throw new Error('not a Hub');
        }
        return { url, health: h };
      }),
      new Promise<never>((_, no) => setTimeout(() => no(new Error('timed out')), timeout)),
    ]),
  );
  for (const t of tries) t.catch(() => undefined); // the ones never awaited below don't count as unhandled
  // all asked at once, but taken in order: a quicker unlikely one doesn't beat a likely one that also answers
  for (const t of tries) {
    try {
      return await t;
    } catch {
      /* next */
    }
  }
  const shown = typed.trim();
  throw new HubNotFound(
    notHub
      ? `${shown} answered, but it isn’t a Wavelength Hub. Use the address you open Wavelength at in a browser.`
      : `Couldn’t find a Wavelength Hub at ${shown}. Check the address (it’s the one you open Wavelength at in a browser, often with :${HUB_PORT} at the end) and that this device is on the same network.`,
  );
}
