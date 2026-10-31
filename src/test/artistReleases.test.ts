import { describe, expect, test } from 'vitest';
import { localToday, newestRelease, ownedIndex } from '../lib/artistReleases';
import { deezerNotForKids } from '../lib/kids';
import type { DeezerResult } from '../sources/deemix';
import type { Album } from '../sources/types';

const release = (id: number, title: string, releaseDate: string, extra: Partial<DeezerResult> = {}): DeezerResult =>
  ({ type: 'album', id, title, artist: 'Lil Wayne', link: `https://www.deezer.com/album/${id}`, releaseDate, recordType: 'album', ...extra }) as DeezerResult;
const album = (title: string, extra: Partial<Album> = {}): Album => ({ id: title, sourceId: 'nd', artist: 'Lil Wayne', title, ...extra });

const opts = { today: '2026-10-31', windowDays: 42, pref: 'both' as const };

describe('an artist’s releases next to the library', () => {
  test('a release you have is found by artist and name, ignoring "(Deluxe)"-style extras the versions ignore', () => {
    const owned = ownedIndex([album('Tha Carter V'), album('Free Weezy Album [2015 Remaster]')]);
    expect(owned(release(1, 'Tha Carter V', '2018-09-28'))?.title).toBe('Tha Carter V');
    expect(owned(release(2, 'Free Weezy Album', '2015-07-04'))?.title).toBe('Free Weezy Album [2015 Remaster]');
    expect(owned(release(3, 'Tha Carter VI', '2025-06-06'))).toBeUndefined();
    expect(owned(release(1, 'Tha Carter V', '2018-09-28', { artist: 'Someone Else' }))).toBeUndefined();
  });

  test('having the explicit album doesn’t make its clean release "in library", and the other way round', () => {
    const explicitOnly = ownedIndex([album('Rebirth', { explicit: 'explicit' })]);
    expect(explicitOnly(release(1, 'Rebirth', '2010-02-02', { version: 'explicit' }))).toBeDefined();
    expect(explicitOnly(release(2, 'Rebirth (Edited)', '2010-02-02', { version: 'clean' }))).toBeUndefined();
    const cleanOnly = ownedIndex([album('Rebirth (Clean)')]);
    expect(cleanOnly(release(2, 'Rebirth (Edited)', '2010-02-02', { version: 'clean' }))).toBeDefined();
    expect(cleanOnly(release(1, 'Rebirth', '2010-02-02', { version: 'explicit' }))).toBeUndefined();
  });

  test('a copy merged from another server counts', () => {
    const merged = album('Tha Carter III', { refs: [album('Tha Carter III', { sourceId: 'plex' }), album('Tha Carter III (Clean)', { sourceId: 'nd' })] });
    expect(ownedIndex([merged])(release(9, 'Tha Carter III (Clean)', '2008-06-10', { version: 'clean' }))).toBe(merged);
  });

  test('songs and artists are never "in library" this way', () => {
    expect(ownedIndex([album('Lollipop')])({ ...release(1, 'Lollipop', '2008-03-13'), type: 'track' })).toBeUndefined();
  });
});

describe('the newest release banner', () => {
  test('picks the newest release that’s out, and says it’s new within the window', () => {
    const n = newestRelease([release(1, 'Old', '2024-01-01'), release(2, 'Fresh', '2026-10-24', { recordType: 'single' }), release(3, 'Middle', '2026-01-01')], opts);
    expect(n.latest?.title).toBe('Fresh');
    expect(n.isNew).toBe(true);
    expect(n.upcoming).toBeUndefined();
  });

  test('older than the window it’s the latest release, not a new one', () => {
    const n = newestRelease([release(1, 'Last Year', '2025-10-31')], opts);
    expect(n.latest?.title).toBe('Last Year');
    expect(n.isNew).toBe(false);
  });

  test('the window counts whole days: 42 days ago is still new, 43 isn’t', () => {
    expect(newestRelease([release(1, 'A', '2026-09-19')], opts).isNew).toBe(true);
    expect(newestRelease([release(1, 'A', '2026-09-18')], opts).isNew).toBe(false);
  });

  test('an announced release is "coming soon", the nearest one first, and not the latest', () => {
    const n = newestRelease([release(1, 'Out', '2026-10-01'), release(2, 'Far', '2027-03-01'), release(3, 'Soon', '2026-11-14'), release(4, 'Today', '2026-10-31')], opts);
    expect(n.latest?.title).toBe('Today');
    expect(n.upcoming?.title).toBe('Soon');
  });

  test('a kid profile sees the newest release it may have, not an explicit one', () => {
    const list = [release(1, 'Loud', '2026-10-20', { explicit: true }), release(2, 'Quiet', '2026-08-01', { explicit: false })];
    expect(newestRelease(list, { ...opts, hide: deezerNotForKids }).latest?.title).toBe('Quiet');
    expect(newestRelease(list, opts).latest?.title).toBe('Loud');
  });

  test('with both versions out, the preferred one is shown', () => {
    const list = [release(1, 'Tha Carter VI', '2026-10-20', { explicit: true }), release(2, 'Tha Carter VI', '2026-10-20', { explicit: false })];
    expect(newestRelease(list, { ...opts, pref: 'clean' }).latest?.id).toBe(2);
    expect(newestRelease(list, { ...opts, pref: 'clean' }).latest?.version).toBe('clean');
    expect(newestRelease([...list].reverse(), { ...opts, pref: 'explicit' }).latest?.id).toBe(1);
  });

  test('nothing with a date, nothing to show', () => {
    expect(newestRelease([release(1, 'Undated', '')], opts).latest).toBeUndefined();
    expect(newestRelease([], opts).latest).toBeUndefined();
  });

  test('today is the device’s own date', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
