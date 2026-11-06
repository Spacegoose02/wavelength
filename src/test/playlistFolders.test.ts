import { describe, expect, test } from 'vitest';
import { folderNames, groupPlaylists, sortPlaylists } from '../lib/playlistFolders';

const p = (id: string, name: string, updatedAt: number, n = 0) => ({ id, name, updatedAt, tracks: Array(n).fill(0) });
const list = [p('a', 'Gym', 3, 10), p('b', 'chill', 5, 2), p('c', 'Party 2', 1, 30), p('d', 'Party 10', 4, 1)];

describe('playlist folders', () => {
  test('sorts by recent change, name (numbers in order) or size', () => {
    expect(sortPlaylists(list, 'recent').map((x) => x.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(sortPlaylists(list, 'name').map((x) => x.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(sortPlaylists(list, 'size').map((x) => x.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  test('pinned first, then loose, then folders by name', () => {
    const g = groupPlaylists(list, { c: 'Parties', d: 'Parties', a: 'Exercise' }, ['d', 'missing'], 'name');
    expect(g.pinned.map((x) => x.id)).toEqual(['d']);
    expect(g.loose.map((x) => x.id)).toEqual(['b']);
    expect(g.folders).toEqual([{ name: 'Exercise', playlists: [list[0]] }, { name: 'Parties', playlists: [list[2]] }]);
    expect(folderNames({ c: 'Parties', d: 'Parties', a: 'Exercise' })).toEqual(['Exercise', 'Parties']);
  });
});
