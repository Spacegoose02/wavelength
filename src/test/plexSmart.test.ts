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
    expect(r.dropped).toEqual(['Track skips is 3']);
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

describe('Plex playlists seen in the wild', () => {
  const sortLib = `sort=${encodeURIComponent('artist.titleSort,album.titleSort,album.index,album.id,album.originallyAvailableAt')}`;
  it('"Radio" lists: library order and album.and=1 say nothing to warn about', () => {
    const r = parsePlexSmart(lib(`type=10&album.genre=4&album.and=1&album.decade=1990&${sortLib}&limit=500`), NOW);
    expect(r.dropped).toEqual([]);
    expect(r.sort).toBe('random');
    expect(r.rules.rules).toEqual([{ field: 'genre', op: 'is', value: 'plex-tag:album.genre:4' }, { field: 'decade', op: 'is', value: '1990' }]);
  });
  it('"Fresh ♥": one version per song (group / having) is left out quietly; a sort we lack is said in words', () => {
    const q = `type=10&track.userRating${encodeURIComponent('>>=')}8&track.group=guid&track.having=${encodeURIComponent('min(album.originallyAvailableAt)')}&sort=${encodeURIComponent('track.lastRatedAt:desc')}`;
    const r = parsePlexSmart(lib(q), NOW);
    expect(r.rules.rules).toEqual([{ field: 'rating', op: 'gt', value: '4' }]);
    expect(r.dropped).toEqual(['Sorted by last rated (newest first)']);
  });
  it('"Recently Released": release dates become years', () => {
    const rel = parsePlexSmart(lib(`type=10&album.originallyAvailableAt${encodeURIComponent('>>=')}-60d`), NOW);
    expect(rel.rules.rules).toEqual([{ field: 'year', op: 'gt', value: '2025' }]);
    const fixed = parsePlexSmart(lib(`type=10&album.originallyAvailableAt${encodeURIComponent('>>=')}2025-01-01&album.originallyAvailableAt${encodeURIComponent('<<=')}2026-01-01`), NOW);
    expect(fixed.rules.rules).toEqual([{ field: 'year', op: 'gt', value: '2024' }, { field: 'year', op: 'lt', value: '2026' }]);
    expect(fixed.dropped).toEqual([]);
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
    expect(plexSort('track.lastRatedAt:desc')).toBeUndefined();
    // Plex's default library order: no warning, shuffled here
    expect(plexSort('artist.titleSort,album.titleSort,album.index,album.id,album.originallyAvailableAt')).toBe('random');
  });
});

describe('resolvePlexTags', () => {
  it('names tag ids and leaves out ones Plex no longer has', () => {
    const r = parsePlexSmart(lib('type=10&album.genre=12&artist.style=7'), NOW);
    expect(plexTagRefs(r.rules)).toEqual([{ kind: 'album', tag: 'genre', id: '12' }, { kind: 'artist', tag: 'style', id: '7' }]);
    const dropped: string[] = [];
    const rules = resolvePlexTags(r.rules, { 'album.genre:12': 'Country' }, dropped);
    expect(rules.rules).toEqual([{ field: 'genre', op: 'is', value: 'Country' }]);
    expect(dropped).toEqual(['Artist style (a tag Plex no longer has)']);
  });
});

describe('smartFromPlex', () => {
  it('makes a smart playlist, every song (500) when Plex had no limit', () => {
    const p = smartFromPlex('Country', { rules: { match: 'all', rules: [{ field: 'genre', op: 'is', value: 'Country' }] } }, newSmartPlaylist());
    expect(p).toMatchObject({ name: 'Country', limit: 500, sort: 'random', rules: { match: 'all', rules: [{ field: 'genre', op: 'is', value: 'Country' }] } });
  });
});
