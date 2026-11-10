import { describe, expect, it } from 'vitest';
import { isLastMusicSource, lastMusicSourceWarning } from '../lib/musicSources';
import type { SourceConfig } from '../sources/types';

const src = (id: string, kind: SourceConfig['kind'], enabled = true, url = 'https://x'): SourceConfig => ({ id, kind, name: id, url, enabled }) as SourceConfig;

describe('switching off the last music source', () => {
  it('warns when no other Navidrome or Plex source is on', () => {
    const hub = src('Navidrome', 'navidrome', true, 'https://mhub.example/nd/3');
    const list = [src('SUB/WAVE', 'subwave'), src('Audiobookshelf', 'audiobookshelf'), hub, src('Plex', 'plex', false)];
    expect(isLastMusicSource(list, hub)).toBe(true);
    expect(lastMusicSourceWarning(hub)).toContain('through the Hub');
  });
  it("doesn't warn when another music source is on, or for non-music sources", () => {
    const nd = src('Navidrome', 'navidrome');
    expect(isLastMusicSource([nd, src('Plex', 'plex')], nd)).toBe(false);
    expect(isLastMusicSource([nd, src('SUB/WAVE', 'subwave')], src('SUB/WAVE', 'subwave'))).toBe(false);
    expect(lastMusicSourceWarning(src('Navidrome', 'navidrome', true, 'https://nd.example'))).not.toContain('Hub');
  });
});
