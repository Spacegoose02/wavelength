import { invoke } from '@tauri-apps/api/core';
import { HubClient, type HubHealth } from '../sources/hub';
import { isTauri } from './http';
import { HUB_PORT } from './hubAddress';

/**
 * Hubs on this device's home network, so nobody types an address with a TV remote (views/HubSettings.tsx SignedOut,
 * docs/HUB.md "Connecting"). The app (src-tauri/src/hubscan.rs) finds what listens on the Hub's port; each one is
 * then asked for its health, and only Wavelength Hubs come back. A browser can't look, so there it's always empty.
 */
export interface FoundHub {
  url: string;
  health: HubHealth;
}

export async function scanForHubs(opts: { scan?: () => Promise<string[]>; health?: (url: string) => Promise<HubHealth>; timeoutMs?: number } = {}): Promise<FoundHub[]> {
  const scan = opts.scan ?? (isTauri ? () => invoke<string[]>('hub_scan', { port: HUB_PORT }) : async () => []);
  const ask = opts.health ?? ((url: string) => new HubClient(url).health());
  const timeout = opts.timeoutMs ?? 4000;
  let hosts: string[];
  try {
    hosts = await scan();
  } catch {
    return [];
  }
  const checked = await Promise.all(
    hosts.map(async (host) => {
      const url = `http://${host}`;
      try {
        const health = await Promise.race([ask(url), new Promise<never>((_, no) => setTimeout(() => no(new Error('timed out')), timeout))]);
        return health?.ok === true ? { url, health } : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  return checked.filter((h): h is FoundHub => !!h);
}

/** `http://192.168.1.10:7780` as people say it: `192.168.1.10:7780`. */
export const shortAddress = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/+$/, '');

const LOOPBACK = /^https?:\/\/(localhost|127(\.\d+){3}|\[::1\]|0\.0\.0\.0)(:\d+)?(?=\/|$)/i;

/**
 * The link a phone opens to approve this device. A Hub whose public address was never set (WAVELENGTH_PUBLIC_URL)
 * hands out `http://localhost:7780/link`, which a phone can't open, so the address this device reached it at is
 * used instead. Anything else the Hub says is kept: it knows its own outside address best.
 */
export function phoneLink(link: string, connectedAt: string): string {
  if (!LOOPBACK.test(link) || LOOPBACK.test(connectedAt)) return link;
  return link.replace(LOOPBACK, connectedAt.replace(/\/+$/, ''));
}
