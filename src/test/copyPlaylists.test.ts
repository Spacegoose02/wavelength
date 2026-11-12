import { describe, expect, it } from 'vitest';
import { copySummary, missingSongs, syncPlaylists } from '../lib/copyPlaylists';
import type { PlexSmartRules, ServerPlaylist, Track } from '../sources/types';

const pl = (id: string, name: string, trackCount?: number, smart?: boolean): ServerPlaylist => ({ id, sourceId: 'px', name, trackCount, smart });
const song = (id: string, title = id, artist = 'A', sourceId = 'px'): Track => ({ id, sourceId, kind: 'track', title, artist });

describe('syncPlaylists', () => {
  it('copies new playlists, adds missing songs to same-named ones, and keeps smart ones smart', async () => {
    const made: [string, string[]][] = [];
    const added: [string, string[]][] = [];
    const smart: [string, PlexSmartRules][] = [];
    const rules: PlexSmartRules = { rules: { match: 'all', rules: [{ field: 'genre', op: 'is', value: 'Country' }] }, limit: 50, dropped: ['artist.country = 3'] };
    const r = await syncPlaylists(
      [
        pl('1', '1990s Country Radio', 3),
        pl('2', 'Road trip', 3),
        pl('3', 'Broken'),
        pl('4', 'Gym'),
        pl('5', 'Country Hits', 20, true),
        pl('6', 'Already smart', 20, true),
        pl('7', 'Unreadable smart', 1, true),
      ],
      [
        // the Navidrome copy of "b" counts as already there
        { id: 'w1', name: 'Road Trip', tracks: [song('a'), song('nd-b', 'B (Remastered)', 'A', 'nd')] },
        { id: 'w2', name: 'gym ', tracks: [song('g')] },
        { id: 'w3', name: 'Country Hits', tracks: [song('x')] },
      ],
      ['Already Smart'],
      {
        tracksOf: async (id) => {
          if (id === '3') throw new Error('Not found');
          if (id === '1') return [song('a'), song('b')];
          if (id === '2') return [song('a'), song('b', 'B'), song('c'), song('c')];
          if (id === '4') return [song('g')];
          return [song('u')];
        },
        smartOf: async (id) => {
          if (id === '7') throw new Error('no rules');
          return rules;
        },
        create: (name, tracks) => {
          made.push([name, tracks.map((t) => t.id)]);
          return `new-${name}`;
        },
        add: (id, tracks) => added.push([id, tracks.map((t) => t.id)]),
        saveSmart: (name, x) => smart.push([name, x]),
      },
    );
    expect(made).toEqual([['1990s Country Radio', ['a', 'b']], ['Unreadable smart', ['u']]]);
    expect(added).toEqual([['w1', ['c']]]);
    expect(smart).toEqual([['Country Hits', rules]]);
    expect(r.merged).toEqual([{ name: 'Road trip', added: 1 }]);
    expect(r.upToDate).toEqual(['Gym']);
    expect(r.smartSkipped).toEqual(['Already smart']);
    expect(r.staleCopies).toEqual(['Country Hits']);
    expect(r.failed).toEqual([{ name: 'Broken', error: 'Not found' }]);
    expect(r.missing).toBe(1);
    expect(copySummary(r)).toBe(
      'Copied 2 playlists · added 1 missing song to 1 playlist you had · 1 smart playlist made with its rules · 2 already up to date · 1 song the server couldn’t find was left out · rules Wavelength doesn’t have were left out of Country Hits (artist.country = 3) · your earlier regular copy of Country Hits is still there, delete it if you like · couldn’t sync Broken (Not found)',
    );
  });

  it('syncs smart playlists as songs on servers without smart rules (Navidrome)', async () => {
    const made: string[] = [];
    await syncPlaylists([pl('1', 'Smart', 1, true)], [], [], { tracksOf: async () => [song('a')], create: (n) => (made.push(n), n), add: () => {}, saveSmart: () => {} });
    expect(made).toEqual(['Smart']);
  });

  it('says so when there is nothing to do', async () => {
    const r = await syncPlaylists([], [], [], { tracksOf: async () => [], create: () => '', add: () => {}, saveSmart: () => {} });
    expect(copySummary(r)).toBe('Nothing to sync');
  });
});

describe('missingSongs', () => {
  it('matches by track or by title and artist, and adds each song once', () => {
    expect(missingSongs([song('a')], [song('a'), song('a2', 'a'), song('b'), song('b')]).map((t) => t.id)).toEqual(['b']);
  });
});
