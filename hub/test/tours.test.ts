import assert from 'node:assert/strict';
import { test } from 'node:test';
import { json, seeded } from './helpers.ts';

const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const past = '2001-01-01';

test('tour dates: off until switched on and given a key; the key never leaves the Hub', async () => {
  const urls: string[] = [];
  const tourFetch = async (url: string) => {
    urls.push(url);
    if (url.includes('ticketmaster')) {
      return {
        _embedded: {
          events: [
            { url: 'https://tm/1', dates: { start: { localDate: soon, localTime: '19:30:00' } }, _embedded: { venues: [{ name: 'O2', city: { name: 'London' }, country: { countryCode: 'GB' } }], attractions: [{ name: 'Adele' }] } },
            { url: 'https://tm/2', dates: { start: { localDate: soon } }, _embedded: { venues: [{ name: 'Pub', city: { name: 'Leeds' } }], attractions: [{ name: 'Adele Tribute Band' }] } },
            { url: 'https://tm/3', dates: { start: { localDate: past } }, _embedded: { venues: [{ name: 'Old', city: { name: 'Bath' } }], attractions: [{ name: 'adele' }] } },
          ],
        },
      };
    }
    return [{ datetime: `${soon}T20:00:00`, url: 'https://bit/1', venue: { name: 'Hall', city: 'Paris', country: 'France' } }];
  };
  const { app, tokens } = await seeded({}, {}, { tourFetch });
  assert.equal((await json(app, 'GET', '/api/tours?artist=Adele', { token: tokens.member })).status, 403, 'off by default');

  const features = (await json(app, 'GET', '/api/admin/features', { token: tokens.admin })).body.features;
  await json(app, 'PUT', '/api/admin/features', { token: tokens.admin, body: { features: { ...features, tourDates: { on: true, kids: false } } } });
  assert.equal((await json(app, 'GET', '/api/tours/status', { token: tokens.member })).body.available, false, 'no key yet');
  assert.equal((await json(app, 'GET', '/api/tours?artist=Adele', { token: tokens.member })).status, 409);

  assert.equal((await json(app, 'PUT', '/api/admin/tours', { token: tokens.member, body: { key: 'x' } })).status, 403);
  const saved = await json(app, 'PUT', '/api/admin/tours', { token: tokens.admin, body: { provider: 'ticketmaster', key: 'tm-secret-9876' } });
  assert.deepEqual(saved.body, { provider: 'ticketmaster', keySet: true, hint: '…9876' });
  assert.equal((await json(app, 'GET', '/api/tours/status', { token: tokens.member })).body.available, true);
  assert.equal((await json(app, 'GET', '/api/tours/status', { token: tokens.kid })).body.available, false, 'kids off');

  const r = await json(app, 'GET', '/api/tours?artist=Adele', { token: tokens.member });
  assert.deepEqual(r.body.events, [{ date: soon, time: '19:30', venue: 'O2', city: 'London', country: 'GB', url: 'https://tm/1' }], 'only this artist, only upcoming');
  assert.ok(!JSON.stringify(r.body).includes('tm-secret'));
  await json(app, 'GET', '/api/tours?artist=adele', { token: tokens.member });
  assert.equal(urls.length, 1, 'cached');

  await json(app, 'PUT', '/api/admin/tours', { token: tokens.admin, body: { provider: 'bandsintown' } });
  const b = await json(app, 'GET', '/api/tours?artist=Adele', { token: tokens.member });
  assert.equal(b.body.events[0].city, 'Paris');
  assert.match(urls[1], /rest\.bandsintown\.com\/artists\/Adele\/events\?app_id=tm-secret-9876/);
  assert.equal((await json(app, 'PUT', '/api/admin/tours', { token: tokens.admin, body: { provider: 'songkick' } })).status, 400);
});
