import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));
const { plan } = await import('../lib/smartOffline');

const t = (id: string) => ({ id, sourceId: 'nd', kind: 'track' as const, title: id, artist: 'a' });

describe('smart offline plan', () => {
  it('fills shelves in priority order under the cap, sharing songs between shelves', () => {
    const out = plan(
      [
        { id: 'recent', priority: 20, tracks: [t('a'), t('c'), t('d')] },
        { id: 'fav', priority: 0, tracks: [t('a'), t('b')] },
      ],
      30,
      { 'nd:a': 10 },
      10,
    );
    expect(out.fav.map((x) => x.id)).toEqual(['a', 'b']);
    // a is already counted; c fits (30), d doesn't
    expect(out.recent.map((x) => x.id)).toEqual(['a', 'c']);
  });
  it('skips things that cannot be downloaded', () => {
    const out = plan([{ id: 'x', priority: 0, tracks: [{ ...t('r'), kind: 'radio' as const }] }], 100, {}, 1);
    expect(out.x).toEqual([]);
  });
});
