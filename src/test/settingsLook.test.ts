import { describe, expect, it, vi } from 'vitest';

describe('Settings → Themes & critters', () => {
  it('finds the critters, scenes and visualizer on their own sub-tabs', async () => {
    vi.stubGlobal('Audio', function Audio() {
      return new Proxy({}, { get: () => () => {} });
    });
    const { searchSettings } = await import('../views/Settings');
    const all = ['account', 'sources', 'playback', 'themes', 'downloads', 'discover', 'updates'] as const;
    const find = (q: string) => searchSettings(q, [...all]).map((e) => `${e.tab}/${e.sub ?? ''}/${e.heading}`);
    expect(find('critters')).toContain('themes/critters/Critters');
    expect(find('girl')).toEqual(expect.arrayContaining(['themes/critters/Critters', 'themes/scenes/Scenes']));
    expect(find('oscilloscope')).toEqual(['themes/visualizer/Now Playing visualizer']);
    expect(find('seasonal')).toEqual(['themes/theme/Theme']);
    expect(find('mouth')).toEqual(['themes/critters/Critter mouths']);
  });
});
