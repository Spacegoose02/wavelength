import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const replies: Record<string, unknown> = {};
vi.mock('../lib/http', async (orig) => {
  const real = await orig<typeof import('../lib/http')>();
  return {
    ...real,
    getJson: async (url: string) => {
      const path = url.replace('https://abs.test', '').split('?')[0];
      calls.push(path);
      if (!(path in replies)) throw new Error(`unexpected ${path}`);
      return replies[path];
    },
  };
});

const { AudiobookshelfSource } = await import('../sources/audiobookshelf');

const ep = (id: string, title: string) => ({ id, title, publishedAt: 1 });

describe('Audiobookshelf continue listening', () => {
  beforeEach(() => {
    calls.length = 0;
    replies['/api/me'] = {
      mediaProgress: [
        { libraryItemId: 'show1', episodeId: 'e1', currentTime: 30, progress: 0.1, lastUpdate: 100 },
        { libraryItemId: 'show2', episodeId: 'old', currentTime: 60, progress: 0.4, lastUpdate: 200 },
        { libraryItemId: 'show1', episodeId: 'done', currentTime: 900, progress: 1, isFinished: true, lastUpdate: 300 },
        { libraryItemId: 'book1', currentTime: 10, progress: 0.2, lastUpdate: 400 },
      ],
    };
    replies['/api/libraries'] = { libraries: [{ id: 'lib', mediaType: 'podcast' }] };
    replies['/api/libraries/lib/recent-episodes'] = { episodes: [{ ...ep('e1', 'New one'), libraryItemId: 'show1', podcast: { metadata: { title: 'Show 1' } } }] };
    replies['/api/items/show2'] = { media: { metadata: { title: 'Show 2' }, episodes: [ep('old', 'Old one'), ep('other', 'Other')] } };
  });

  it('never asks for items-in-progress, and reads only the shows the latest list misses', async () => {
    const src = new AudiobookshelfSource({ id: 's', kind: 'audiobookshelf', name: 'ABS', url: 'https://abs.test', token: 't' } as never);
    const list = await src.getEpisodesInProgress();
    expect(list.map((t) => t.title)).toEqual(['Old one', 'New one']);
    expect(calls).not.toContain('/api/me/items-in-progress');
    expect(calls.filter((c) => c.startsWith('/api/items/'))).toEqual(['/api/items/show2']);
  });

  it('asks for nothing else when nothing is part-played', async () => {
    replies['/api/me'] = { mediaProgress: [] };
    const src = new AudiobookshelfSource({ id: 's', kind: 'audiobookshelf', name: 'ABS', url: 'https://abs.test', token: 't' } as never);
    expect(await src.getEpisodesInProgress()).toEqual([]);
    expect(calls).toEqual(['/api/me']);
  });
});
