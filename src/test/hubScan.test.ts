import { describe, expect, it } from 'vitest';
import { phoneLink, scanForHubs, shortAddress } from '../lib/hubScan';
import type { HubHealth } from '../sources/hub';

const hub = (v = '1.0.0'): HubHealth => ({ ok: true, version: v, setupNeeded: false, sso: false });

describe('scanForHubs', () => {
  it('keeps only what answers as a Wavelength Hub, in the order found', async () => {
    const found = await scanForHubs({
      scan: async () => ['192.168.1.20:7780', '192.168.1.5:7780', '192.168.1.9:7780'],
      health: async (url) => {
        if (url.includes('.5:')) return { ok: false } as unknown as HubHealth; // something else on that port
        if (url.includes('.9:')) throw new Error('refused');
        return hub();
      },
    });
    expect(found.map((h) => h.url)).toEqual(['http://192.168.1.20:7780']);
  });

  it('gives up on one that never answers, without holding up the rest', async () => {
    const found = await scanForHubs({
      scan: async () => ['10.0.0.2:7780', '10.0.0.3:7780'],
      health: (url) => (url.includes('.2:') ? new Promise(() => undefined) : Promise.resolve(hub())),
      timeoutMs: 50,
    });
    expect(found.map((h) => h.url)).toEqual(['http://10.0.0.3:7780']);
  });

  it('finds nothing when it can’t look', async () => {
    expect(await scanForHubs({ scan: async () => Promise.reject(new Error('no network')) })).toEqual([]);
    expect(await scanForHubs()).toEqual([]); // a browser can't scan
  });
});

describe('phoneLink', () => {
  it('swaps a localhost link for the address this device reached the Hub at', () => {
    expect(phoneLink('http://localhost:7780/link?code=ABCD-EFGH', 'http://192.168.1.20:7780')).toBe('http://192.168.1.20:7780/link?code=ABCD-EFGH');
    expect(phoneLink('http://127.0.0.1:7780/link', 'https://music.example.com/')).toBe('https://music.example.com/link');
  });

  it('keeps the Hub’s own public address', () => {
    expect(phoneLink('https://music.example.com/link?code=X', 'http://192.168.1.20:7780')).toBe('https://music.example.com/link?code=X');
  });

  it('keeps localhost when this device is on the Hub’s own machine', () => {
    expect(phoneLink('http://localhost:7780/link', 'http://localhost:7780')).toBe('http://localhost:7780/link');
  });
});

it('shortAddress drops the scheme', () => {
  expect(shortAddress('http://192.168.1.20:7780/')).toBe('192.168.1.20:7780');
});
