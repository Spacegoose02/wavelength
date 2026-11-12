import { describe, expect, it } from 'vitest';
import { copyAllPlaylists, copySummary } from '../lib/copyPlaylists';
import type { ServerPlaylist, Track } from '../sources/types';

const pl = (id: string, name: string, trackCount?: number): ServerPlaylist => ({ id, sourceId: 'nd', name, trackCount });
const song = (id: string): Track => ({ id, sourceId: 'nd', kind: 'track', title: id, artist: 'A' });

describe('copyAllPlaylists', () => {
  it('copies each playlist once, skips names already in Wavelength, and counts songs left out', async () => {
    const made: [string, string[]][] = [];
    const r = await copyAllPlaylists(
      [pl('1', '1990s Country Radio', 3), pl('2', 'Road trip', 1), pl('3', 'Broken'), pl('4', 'road trip ')],
      ['Road Trip'],
      async (id) => {
        if (id === '3') throw new Error('Not found');
        return id === '1' ? [song('a'), song('b')] : [song('c')];
      },
      (name, tracks) => made.push([name, tracks.map((t) => t.id)]),
    );
    expect(made).toEqual([['1990s Country Radio', ['a', 'b']]]);
    expect(r.skipped).toEqual(['Road trip', 'road trip ']);
    expect(r.failed).toEqual([{ name: 'Broken', error: 'Not found' }]);
    expect(r.missing).toBe(1);
    expect(copySummary(r)).toBe('Copied 1 playlist · 2 already in Wavelength · 1 song the server couldn’t find was left out · couldn’t copy Broken (Not found)');
  });
});
