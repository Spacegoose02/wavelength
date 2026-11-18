import { afterEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
const { aiMarkOf, isAiIn, useAiArtists } = await import('../lib/aiArtists');
const { withoutDontPlay } = await import('../lib/dontPlay');
const { useSettings } = await import('../store/settings');

const mark = (name: string) => ({ name, setBy: 'boss', setAt: 1 });

describe('AI-generated artists', () => {
  const list = [mark('The Velvet Sundown'), mark('Aria & Neon')];
  afterEach(() => {
    useAiArtists.setState({ artists: [] });
    useSettings.setState({ aiArtists: { hideInDiscover: false, outOfPicks: false }, dontPlay: { artists: [], songs: [] } });
  });

  it('matches an artist however it is written, and songs where they are the main artist', () => {
    expect(isAiIn(list, 'velvet sundown')).toBe(true);
    expect(isAiIn(list, 'The Velvet Sundown feat. Someone')).toBe(true);
    expect(isAiIn(list, 'Someone feat. The Velvet Sundown')).toBe(false);
    expect(isAiIn(list, 'Velvet Underground')).toBe(false);
    expect(isAiIn([], 'The Velvet Sundown')).toBe(false);
  });

  it('matches a whole name with "&" in it, not just its first artist', () => {
    expect(isAiIn(list, 'Aria and Neon')).toBe(true);
    expect(isAiIn(list, 'Aria')).toBe(false);
    expect(aiMarkOf(list, 'aria & neon')?.name).toBe('Aria & Neon');
  });

  it('keeps them out of picks only for someone who asked', () => {
    useAiArtists.setState({ artists: list });
    const songs = [{ artist: 'The Velvet Sundown', title: 'Dust' }, { artist: 'Adele', title: 'Hello' }];
    expect(withoutDontPlay(songs)).toHaveLength(2);
    useSettings.getState().setAiArtists({ outOfPicks: true });
    expect(withoutDontPlay(songs).map((s) => s.artist)).toEqual(['Adele']);
    expect(useSettings.getState().aiArtists).toEqual({ hideInDiscover: false, outOfPicks: true });
  });
});
