import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { url: string; init?: RequestInit }[] = [];
let tauri = false;
let hub: { url: string; token: string } | undefined;
vi.mock('../lib/http', async (orig) => {
  const real = await orig<typeof import('../lib/http')>();
  return {
    ...real,
    get isTauri() {
      return tauri;
    },
    hubEndpoint: () => hub,
    getJson: async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/play')) return { audioTracks: [{ contentUrl: '/api/items/b1/file/7', duration: 60 }], displayTitle: 'Book', id: 'sess' };
      return { libraries: [] };
    },
  };
});

const { AudiobookshelfSource } = await import('../sources/audiobookshelf');

const cfg = { id: 'hub-3', hubId: 3, hubRelayKey: '12.sig', kind: 'audiobookshelf', name: 'Books', url: 'http://abs.lan:13378', token: 'abs-key', enabled: true } as const;
const auth = (i: number) => (calls[i].init!.headers as Record<string, string>).Authorization;

describe('Audiobookshelf through the Hub', () => {
  beforeEach(() => {
    calls.length = 0;
    tauri = false;
    hub = { url: 'https://hub.example/', token: 'hub-token' };
  });

  it('in a browser, calls the Hub with the Hub token and loads audio with the relay key', async () => {
    const src = new AudiobookshelfSource({ ...cfg });
    await src.test();
    expect(calls[0].url).toBe('https://hub.example/api/abs/3/api/libraries');
    expect(auth(0)).toBe('Bearer hub-token');
    const { tracks } = await src.startBook('b1');
    expect(tracks[0].streamUrl).toBe('https://hub.example/api/abs/3/api/items/b1/file/7?k=12.sig');
    expect(tracks[0].coverUrl).toBe('https://hub.example/api/abs/3/api/items/b1/cover?k=12.sig');
    expect(JSON.stringify(calls)).not.toContain('abs-key');
  });

  it('calls Audiobookshelf directly in the apps, from an older Hub, or when signed out of the Hub', async () => {
    for (const [setup, conf] of [
      [() => (tauri = true), cfg],
      [() => {}, { ...cfg, hubRelayKey: undefined }],
      [() => (hub = undefined), cfg],
    ] as const) {
      calls.length = 0;
      tauri = false;
      hub = { url: 'https://hub.example', token: 'hub-token' };
      setup();
      const src = new AudiobookshelfSource({ ...conf });
      await src.test();
      expect(calls[0].url).toBe('http://abs.lan:13378/api/libraries');
      expect(auth(0)).toBe('Bearer abs-key');
    }
  });
});
