import { describe, expect, it } from 'vitest';
import { findHub, hubCandidates } from '../lib/hubAddress';
import type { HubHealth } from '../sources/hub';

describe('hubCandidates', () => {
  it('tries a LAN address over http, then on the Hub port, then https', () => {
    expect(hubCandidates('192.168.1.10')).toEqual(['http://192.168.1.10', 'http://192.168.1.10:7780', 'https://192.168.1.10']);
    expect(hubCandidates(' nas.local ')).toEqual(['http://nas.local', 'http://nas.local:7780', 'https://nas.local']);
    expect(hubCandidates('tower')).toEqual(['http://tower', 'http://tower:7780', 'https://tower']);
  });

  it('keeps a port that was typed', () => {
    expect(hubCandidates('192.168.1.10:7780')).toEqual(['http://192.168.1.10:7780', 'https://192.168.1.10:7780']);
  });

  it('tries a public name over https first', () => {
    expect(hubCandidates('music.example.com')).toEqual(['https://music.example.com', 'http://music.example.com', 'http://music.example.com:7780']);
  });

  it('takes a full address as typed, and on the Hub port when it has none', () => {
    expect(hubCandidates('HTTPS://music.example.com/')).toEqual(['https://music.example.com', 'https://music.example.com:7780']);
    expect(hubCandidates('http://10.0.0.5:7780')).toEqual(['http://10.0.0.5:7780']);
  });

  it('finds the Hub behind a link to one of its pages', () => {
    expect(hubCandidates('https://music.example.com/link')[0]).toBe('https://music.example.com');
    expect(hubCandidates('https://music.example.com/invite/abc-123')[0]).toBe('https://music.example.com');
    expect(hubCandidates('')).toEqual([]);
  });
});

describe('findHub', () => {
  const hub = { ok: true, name: 'wavelength-hub', version: '1', setupNeeded: false, sso: false } as unknown as HubHealth;

  it('takes the likeliest address that answers', async () => {
    const asked: string[] = [];
    const r = await findHub('192.168.1.10', {
      health: async (url) => {
        asked.push(url);
        if (url === 'http://192.168.1.10:7780' || url === 'https://192.168.1.10') return hub;
        throw new Error('refused');
      },
    });
    expect(r.url).toBe('http://192.168.1.10:7780');
    expect(asked).toHaveLength(3);
  });

  it('says when something answered that is not a Hub', async () => {
    await expect(findHub('nas.local', { health: async () => ({ ok: false }) as unknown as HubHealth })).rejects.toThrow(/isn’t a Wavelength Hub/);
  });

  it('says what to check when nothing answers', async () => {
    await expect(findHub('nas.local', { health: async () => { throw new Error('refused'); } })).rejects.toThrow(/Couldn’t find a Wavelength Hub at nas.local/);
  });
});
