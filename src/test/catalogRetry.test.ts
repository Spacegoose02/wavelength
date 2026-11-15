import { afterEach, describe, expect, it, vi } from 'vitest';

let tries = 0;
let fail: (n: number) => Error | undefined = () => undefined;
const books = [{ id: 'b', title: 'Book' }];

vi.mock('../store/settings', () => ({
  enabledSources: () => [{ id: 'abs', kind: 'audiobookshelf', name: 'Audiobookshelf', url: 'http://abs', enabled: true }],
}));
vi.mock('../sources/registry', () => ({
  mergeAlbums: (l: unknown[][]) => l.flat(),
  mergeArtists: (l: unknown[][]) => l.flat(),
  sourceFor: () => ({
    getBooks: async () => {
      const e = fail(++tries);
      if (e) throw e;
      return books;
    },
  }),
}));

const { useCatalog, RETRY_MS } = await import('../store/catalog');

async function load() {
  tries = 0;
  const p = useCatalog.getState().load();
  await vi.advanceTimersByTimeAsync(RETRY_MS + 10);
  await p;
  return useCatalog.getState();
}

describe('catalog load', () => {
  afterEach(() => vi.useRealTimers());

  it('gives a server that dropped the connection one more go', async () => {
    vi.useFakeTimers();
    fail = (n) => (n === 1 ? new TypeError('NetworkError when attempting to fetch resource.') : undefined);
    const s = await load();
    expect(tries).toBe(2);
    expect(s.books).toHaveLength(1);
    expect(s.errors).toEqual({});
  });

  it('reports it when the second go fails too, and does not retry an error status', async () => {
    vi.useFakeTimers();
    fail = () => new TypeError('NetworkError when attempting to fetch resource.');
    expect((await load()).errors).toEqual({ Audiobookshelf: 'NetworkError when attempting to fetch resource.' });
    expect(tries).toBe(2);

    fail = () => new Error('500 Internal Server Error — http://abs/api/libraries');
    expect((await load()).errors.Audiobookshelf).toMatch(/^500/);
    expect(tries).toBe(1);
  });
});
