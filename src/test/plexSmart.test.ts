import { describe, expect, it } from 'vitest';
import { parsePlexSmart, plexDays, plexQuery, plexSort, plexTagRefs, resolvePlexTags, smartFromPlex } from '../lib/plexSmart';
import { newSmartPlaylist } from '../lib/smartPlaylists';

const NOW = Date.UTC(2026, 10, 12);
// how Plex stores a smart playlist made in Plex Web's filter builder: the library path, URL-encoded
const lib = (q: string) => `library://9a8b/directory/${encodeURIComponent(`/library/sections/5/all?${q}`)}`;

describe('plexQuery', () => {
  it('reads library:// and server:// links, encoded once or twice', () => {
    expect(plexQuery(lib('type=10&limit=5'))).toEqual({ path: '/library/sections/5/all', query: 'type=10&limit=5' });
    expect(plexQuery(`library://x/directory/${encodeURIComponent(encodeURIComponent('/library/sections/5/all?type=10'))}`).query).toBe('type=10');
    expect(plexQuery('server://abc/com.plexapp.plugins.library/library/sections/2/all?type=10&album.year=1999')).toEqual({ path: '/library/sections/2/all', query: 'type=10&album.year=1999' });
  });
});

describe('parsePlexSmart', () => {
  it('turns groups, any/all, operators, ratings, dates, sort and limit into Wavelength rules', () => {
    const q = [
      'type=10',
      'push=1',
      'album.genre=12',
      'or=1',
      `artist.title${encodeURIComponent('<=')}Lil`,
      'pop=1',
      `track.userRating${encodeURIComponent('>>=')}7`,
      `track.lastViewedAt${encodeURIComponent('<<=')}-90d`,
      `album.decade=1990`,
      `artist.title${encodeURIComponent('!==')}Drake`,
      'track.skipCount=3',
      `sort=${encodeURIComponent('viewCount:desc')}`,
      'limit=50',
    ].join('&');
    const r = parsePlexSmart(lib(q), NOW);
    expect(r.section).toBe('5');
    expect(r.sort).toBe('plays');
    expect(r.limit).toBe(50);
    expect(r.dropped).toEqual(['track.skipCount = 3']);
    expect(r.rules).toEqual({
      match: 'all',
      rules: [
        { match: 'any', rules: [{ field: 'genre', op: 'is', value: 'plex-tag:album.genre:12' }, { field: 'artist', op: 'beginsWith', value: 'Lil' }] },
        { field: 'rating', op: 'gt', value: '3' },
        { field: 'played', op: 'notInLast', value: '90' },
        { field: 'decade', op: 'is', value: '1990' },
        { field: 'artist', op: 'isNot', value: 'Drake' },
      ],
    });
  });

  it('reads several tag ids as "any of them", and tag names Plex sends as text', () => {
    const r = parsePlexSmart(lib('type=10&album.genre=1,2&artist.mood!=Dark'), NOW);
    expect(r.rules.rules).toEqual([
      { match: 'any', rules: [{ field: 'genre', op: 'is', value: 'plex-tag:album.genre:1' }, { field: 'genre', op: 'is', value: 'plex-tag:album.genre:2' }] },
      { field: 'artistMood', op: 'isNot', value: 'Dark' },
    ]);
  });

  it('a whole-library "any" and bare field names (about the playlist type)', () => {
    const r = parsePlexSmart(lib('type=10&title=Love&or=1&title=Heart'), NOW);
    expect(r.rules).toEqual({ match: 'any', rules: [{ field: 'title', op: 'contains', value: 'Love' }, { field: 'title', op: 'contains', value: 'Heart' }] });
  });
});

describe('Plex values', () => {
  it('relative and fixed dates as days', () => {
    expect(plexDays('-30d', NOW)).toBe(30);
    expect(plexDays('-2w', NOW)).toBe(14);
    expect(plexDays('-3mon', NOW)).toBe(90);
    expect(plexDays('-1y', NOW)).toBe(365);
    expect(plexDays('2026-11-02', NOW)).toBe(10);
    expect(plexDays('nonsense', NOW)).toBeUndefined();
  });
  it('sorts', () => {
    expect(plexSort('random')).toBe('random');
    expect(plexSort('track.lastViewedAt:desc')).toBe('played');
    expect(plexSort('viewCount')).toBe('leastPlays');
    expect(plexSort('titleSort')).toBeUndefined();
  });
});

describe('resolvePlexTags', () => {
  it('names tag ids and leaves out ones Plex no longer has', () => {
    const r = parsePlexSmart(lib('type=10&album.genre=12&artist.style=7'), NOW);
    expect(plexTagRefs(r.rules)).toEqual([{ kind: 'album', tag: 'genre', id: '12' }, { kind: 'artist', tag: 'style', id: '7' }]);
    const dropped: string[] = [];
    const rules = resolvePlexTags(r.rules, { 'album.genre:12': 'Country' }, dropped);
    expect(rules.rules).toEqual([{ field: 'genre', op: 'is', value: 'Country' }]);
    expect(dropped).toEqual(['artist.style is tag #7 (no longer in Plex)']);
  });
});

describe('smartFromPlex', () => {
  it('makes a smart playlist, every song (500) when Plex had no limit', () => {
    const p = smartFromPlex('Country', { rules: { match: 'all', rules: [{ field: 'genre', op: 'is', value: 'Country' }] } }, newSmartPlaylist());
    expect(p).toMatchObject({ name: 'Country', limit: 500, sort: 'random', rules: { match: 'all', rules: [{ field: 'genre', op: 'is', value: 'Country' }] } });
  });
});
