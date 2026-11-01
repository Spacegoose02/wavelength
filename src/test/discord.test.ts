import { describe, expect, it } from 'vitest';
import { activityFor } from '../lib/discordActivity';

describe('discord activity', () => {
  it('shows the song, a public cover only, and when it ends', () => {
    const a = activityFor({ title: 'Dreams', artist: 'Fleetwood Mac', album: 'Rumours', coverUrl: 'https://e-cdns-images.dzcdn.net/x.jpg' }, 30, 257, 1_000_000);
    expect(a).toMatchObject({ type: 2, details: 'Dreams', state: 'by Fleetwood Mac', timestamps: { start: 970_000, end: 1_227_000 } });
    expect(a.assets.large_image).toBe('https://e-cdns-images.dzcdn.net/x.jpg');
    const b = activityFor({ title: 'Dreams', artist: 'Fleetwood Mac', coverUrl: 'https://nas/rest/getCoverArt?id=1&u=me&t=tok&s=salt' }, 0, 0);
    expect(b.assets.large_image).toBeUndefined();
    expect(b.timestamps).not.toHaveProperty('end');
  });
});
