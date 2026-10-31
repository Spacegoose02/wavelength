import { describe as group, expect, test } from 'vitest';
import { offerStatus, type CleanOffer } from '../lib/cleanVersions';
import { DeemixWatch, describe, summary } from '../lib/deemixQueue';

const raw = () => ({
  queueOrder: ['album_1_9', 'album_2_9', 'album_3_9'],
  queue: {
    album_1_9: { uuid: 'album_1_9', type: 'album', id: 1, title: 'One', status: 'downloading', size: 12, downloaded: 5, failed: 0, progress: 41 },
    album_2_9: { uuid: 'album_2_9', type: 'album', id: 2, title: 'Two', status: 'inQueue', size: 8 },
    album_3_9: { uuid: 'album_3_9', type: 'album', id: 3, title: 'Three', status: 'withErrors', size: 8, downloaded: 6, failed: 2, errors: [{ errid: 'wrongBitrate', data: { title: 'Bonus' } }] },
  },
});

group('deemix queue', () => {
  test('each download says where it is, in words', () => {
    const items = new DeemixWatch(() => 0).read(raw());
    expect(items.map((i) => describe(i, 0))).toEqual(['Downloading · 5 of 12 songs', 'Waiting · next up', 'Done, but 2 of 8 songs failed']);
    expect(items[2].errors).toEqual([{ title: 'Bonus', artist: '', message: 'Not available at the chosen quality' }]);
    expect(summary(items)).toMatchObject({ downloading: 1, waiting: 1, failed: 1, done: 0, stuck: false });
  });

  test('a download that stops moving is called stuck, and moving again clears it', () => {
    let now = 0;
    const watch = new DeemixWatch(() => now, 1000);
    const q = raw();
    watch.read(q);
    now = 5000;
    const stuck = watch.read(q);
    expect(stuck[0].stalled).toBe(true);
    expect(describe(stuck[0], now + 120_000)).toMatch(/^Stuck · no progress for \d+ min · 5 of 12 songs$/);
    expect(summary(stuck).stuck).toBe(true);
    q.queue.album_1_9.downloaded = 6;
    now = 6000;
    expect(watch.read(q)[0].stalled).toBe(false);
  });
});

group('clean versions sent to deemix', () => {
  const offer: CleanOffer = { artist: 'A', album: 'B', link: 'https://www.deezer.com/album/5', deezerId: 5, have: false };
  const sent = { [offer.link]: { at: Date.now() - 3600_000, via: 'deemix' as const } };

  test('one deemix and the Hub have lost can be sent again', () => {
    expect(offerStatus(offer, { sent, sending: {}, queue: {}, hub: {} })).toEqual({ label: 'Sent to deemix', kind: 'queued' });
    expect(offerStatus(offer, { sent, sending: {}, queue: {}, hub: {}, queueRead: true })).toEqual({ label: 'Not in deemix’s queue any more', kind: 'error' });
  });

  test('one still in deemix or held by the Hub shows how it is going', () => {
    expect(offerStatus(offer, { sent, sending: {}, queue: { 5: { status: 'downloading', progress: 40, downloaded: 4, size: 10 } }, hub: {}, queueRead: true }).label).toBe('Downloading 4 of 10');
    expect(offerStatus(offer, { sent, sending: {}, queue: {}, hub: { [offer.link]: { state: 'waiting', stuck: true } }, queueRead: true }).label).toBe('Waiting · deemix looks stuck');
  });
});
