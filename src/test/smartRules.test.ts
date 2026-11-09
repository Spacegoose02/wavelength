import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { albumKey, songKey, tagKey, useItemTagStore } from '../lib/itemTags';
import { advancedRules, describe as say, newSmartPlaylist, type SongFacts } from '../lib/smartPlaylists';
import { describeRules, evalGroup, isEmpty, needsSongs, newRule, type RuleGroup, sortKey } from '../lib/smartRules';
import type { Album, Track } from '../sources/types';

const album = (artist: string, title: string, year: number, genres: string[], more: Partial<Album> = {}) => ({ id: title, sourceId: 'nd', artist, title, year, genres, ...more }) as Album;
const track = (title: string, artist: string) => ({ id: title, sourceId: 'nd', kind: 'track', title, artist }) as Track;
const facts = (f: Partial<SongFacts>): SongFacts => ({ rating: 0, starred: false, plays: 0, ...f });
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 9);

const country = album('Luke Combs', 'Gettin’ Old', 2023, ['Country'], { labels: ['Columbia Nashville'], releaseTypes: ['album'], plays: 12 });
const rap = album('Lil Baby', 'It’s Only Me', 2022, ['Rap', 'Hip-Hop'], { starred: true });
const xmas = album('*NSYNC', 'Home for Christmas', 1998, ['Pop'], { compilation: false, releaseTypes: ['album'] });

describe('advanced smart playlist rules', () => {
  beforeEach(() => useItemTagStore.setState({
    albums: { [albumKey('NSYNC', 'Home for Christmas')]: { kind: 'album', artist: 'NSYNC', title: 'Home for Christmas', facets: { collection: ['Christmas'] }, sources: {}, updatedAt: 1 } },
    artists: { [tagKey('Lil Baby')]: { kind: 'artist', artist: 'Lil Baby', title: '', facets: { genre: ['Southern Hip Hop'], style: ['Trap'] }, sources: {}, updatedAt: 1 } },
  } as never));
  afterEach(() => useItemTagStore.setState({ albums: {}, artists: {}, songs: {}, songAlbums: {}, songsAt: 0 } as never));

  test('album genre is Country and (artist contains Lil or artist contains Luke)', () => {
    const g: RuleGroup = {
      match: 'all',
      rules: [
        { field: 'genre', op: 'is', value: 'country' },
        { match: 'any', rules: [{ field: 'artist', op: 'contains', value: 'Lil' }, { field: 'artist', op: 'contains', value: 'luke' }] },
      ],
    };
    expect(evalGroup(g, { album: country })).toBe(true);
    expect(evalGroup(g, { album: rap })).toBe(false);
    expect(describeRules(g)).toBe('Album genre is country and any of (Artist contains Lil, Artist contains luke)');
    expect(needsSongs(g)).toBe(false);
  });

  test('artist fields read the Hub, falling back to album genres; album fields read the Hub and the album list', () => {
    const r = (field: never, value: string, op = 'is') => ({ match: 'all', rules: [{ field, op, value }] }) as RuleGroup;
    expect(evalGroup(r('artistGenre' as never, 'Southern Hip Hop'), { album: rap })).toBe(true);
    expect(evalGroup(r('artistGenre' as never, 'Country'), { album: country })).toBe(true);
    expect(evalGroup(r('artistStyle' as never, 'trap'), { album: rap })).toBe(true);
    expect(evalGroup(r('collection' as never, 'Christmas'), { album: xmas })).toBe(true);
    expect(evalGroup(r('collection' as never, 'Christmas', 'isNot'), { album: country })).toBe(true);
    expect(evalGroup(r('decade' as never, '1990'), { album: xmas })).toBe(true);
    expect(evalGroup(r('label' as never, 'columbia', 'contains'), { album: country })).toBe(true);
    expect(evalGroup(r('albumType' as never, 'album'), { album: rap })).toBe(true);
    expect(evalGroup(r('albumStarred' as never, 'true'), { album: rap })).toBe(true);
    expect(evalGroup(r('albumPlays' as never, '10', 'gt'), { album: country })).toBe(true);
    expect(evalGroup(r('year' as never, '2000', 'lt'), { album: country })).toBe(false);
  });

  test('track rules are "maybe" until the song is read, then decide', () => {
    const g: RuleGroup = { match: 'all', rules: [{ field: 'genre', op: 'is', value: 'Rap' }, { field: 'plays', op: 'gt', value: '5' }, { field: 'played', op: 'notInLast', value: '30' }] };
    expect(needsSongs(g)).toBe(true);
    expect(evalGroup(g, { album: rap, now: NOW })).toBeUndefined();
    expect(evalGroup(g, { album: country, now: NOW })).toBe(false);
    const song = track('Heyy', 'Lil Baby');
    expect(evalGroup(g, { album: rap, track: song, facts: facts({ plays: 9, playedAt: NOW - 60 * DAY }), now: NOW })).toBe(true);
    expect(evalGroup(g, { album: rap, track: song, facts: facts({ plays: 9, playedAt: NOW - 2 * DAY }), now: NOW })).toBe(false);
    // never played counts as not played lately
    expect(evalGroup(g, { album: rap, track: song, facts: facts({ plays: 9 }), now: NOW })).toBe(true);
  });

  test('"any" with an undecided track row stays maybe; a decided one wins', () => {
    const g: RuleGroup = { match: 'any', rules: [{ field: 'starred', op: 'is', value: 'true' }, { field: 'genre', op: 'is', value: 'Pop' }] };
    expect(evalGroup(g, { album: xmas })).toBe(true);
    expect(evalGroup(g, { album: rap })).toBeUndefined();
  });

  test('empty rows are left out; the label is known once the album is read', () => {
    expect(isEmpty({ match: 'all', rules: [newRule('genre')] })).toBe(true);
    expect(evalGroup({ match: 'any', rules: [newRule('genre')] }, { album: rap })).toBe(true);
    const label: RuleGroup = { match: 'all', rules: [{ field: 'label', op: 'is', value: 'Quality Control' }] };
    expect(evalGroup(label, { album: rap })).toBeUndefined();
    expect(evalGroup(label, { album: rap, track: track('x', 'y'), facts: facts({ label: 'Quality Control; Motown' }) })).toBe(true);
  });

  test('a song’s own mood: albums with no song that has it are left out before reading them', () => {
    const g: RuleGroup = { match: 'all', rules: [{ field: 'trackMood', op: 'is', value: 'reckless' }] };
    // songs' moods not loaded yet: maybe
    expect(evalGroup(g, { album: rap })).toBeUndefined();
    useItemTagStore.setState({
      songsAt: 1,
      songs: { [songKey('Lil Baby', 'It’s Only Me', 'Heyy')]: { mood: ['Reckless'] } },
      songAlbums: { [albumKey('Lil Baby', 'It’s Only Me')]: { mood: ['Reckless'] } },
    } as never);
    expect(evalGroup(g, { album: rap })).toBeUndefined();
    expect(evalGroup(g, { album: country })).toBe(false);
    expect(evalGroup({ match: 'all', rules: [{ field: 'trackMood', op: 'isNot', value: 'reckless' }] }, { album: country })).toBe(true);
    expect(evalGroup(g, { album: rap, track: track('Heyy', 'Lil Baby'), facts: facts({}) })).toBe(true);
    expect(evalGroup(g, { album: rap, track: track('California Breeze', 'Lil Baby'), facts: facts({}) })).toBe(false);
  });

  test('the simple rules become advanced ones', () => {
    const p = { ...newSmartPlaylist(), genres: ['Rap; Hip-Hop'], minRating: 4, starred: true, notPlayedDays: 90, fromYear: 1990, toYear: 1999, notCollections: ['Christmas'] };
    const g = advancedRules(p);
    expect(g.rules).toEqual([
      { match: 'any', rules: [{ field: 'genre', op: 'is', value: 'Rap' }, { field: 'genre', op: 'is', value: 'Hip-Hop' }] },
      { field: 'year', op: 'gt', value: '1989' },
      { field: 'year', op: 'lt', value: '2000' },
      { field: 'collection', op: 'isNot', value: 'Christmas' },
      { field: 'rating', op: 'gt', value: '3' },
      { field: 'starred', op: 'is', value: 'true' },
      { field: 'played', op: 'notInLast', value: '90' },
    ]);
    expect(say({ ...p, rules: g, sort: 'plays', limit: 50 })).toContain('up to 50, most played first');
  });

  test('sorting for the limit', () => {
    const a = { album: rap, facts: facts({ plays: 3, rating: 5 }) };
    const b = { album: rap, facts: facts({ plays: 10, rating: 2 }) };
    expect([a, b].sort((x, y) => sortKey('plays', x) - sortKey('plays', y))[0]).toBe(b);
    expect([a, b].sort((x, y) => sortKey('rating', x) - sortKey('rating', y))[0]).toBe(a);
  });
});
