import { describe, expect, it } from 'vitest';
import { PART, saveInParts } from '../lib/tagSave';

const changes = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `a/${i}.mp3`, tags: { title: `T${i}` } }));

describe('saveInParts', () => {
  it('sends a big Save in small parts that share one batch id', async () => {
    const calls: { n: number; batch?: string }[] = [];
    const c = {
      saveTags: async (_label: string, part: { path: string }[], batch?: string) => {
        calls.push({ n: part.length, batch });
        return { batch: batch ?? null, changed: part.map((p) => p.path), failed: [] };
      },
    };
    const progress: number[] = [];
    const r = await saveInParts(c as never, 'L', changes(PART * 2 + 3), (d) => progress.push(d));
    expect(calls.map((x) => x.n)).toEqual([PART, PART, 3]);
    expect(new Set(calls.map((x) => x.batch)).size).toBe(1);
    expect(calls[0].batch).toMatch(/^[0-9a-f]{16}$/);
    expect(r.batches).toEqual([calls[0].batch]);
    expect(r.changed).toHaveLength(PART * 2 + 3);
    expect(r.error).toBeUndefined();
    expect(progress[progress.length - 1]).toBe(PART * 2 + 3);
  });

  it('tries a failed part once more, then stops and says how far it got', async () => {
    let n = 0;
    const c = {
      saveTags: async (_l: string, part: { path: string }[], batch?: string) => {
        n++;
        if (n === 2 || n >= 4) throw new Error('504 error');
        return { batch: batch ?? null, changed: part.map((p) => p.path), failed: [] };
      },
    };
    // part 1 ok, part 2 fails then works on the retry, part 3 fails twice
    const r = await saveInParts(c as never, 'L', changes(PART * 3), () => undefined);
    expect(r.changed).toHaveLength(PART * 2);
    expect(r.error).toBe('504 error');
  });
});
