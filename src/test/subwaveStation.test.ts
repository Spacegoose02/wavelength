import { describe, expect, test } from 'vitest';
import { archiveDays, availableEngines, blankPersona, mergePersona, SubWaveSource, SW_FIXES, type SwPersonaFull } from '../sources/subwave';

describe('SUB/WAVE station admin', () => {
  test('editing a DJ keeps the fields Wavelength does not show', () => {
    const roster: SwPersonaFull[] = [
      { id: 'night_owl', name: 'Night Owl', soul: 'old', skills: ['weather'], musicLean: 'dub', tts: { engine: 'kokoro', voice: 'bf_isabella', gainDb: 2, speed: 1.1 } },
      { id: 'sunny', name: 'Sunny' },
    ];
    const next = mergePersona(roster, { id: 'night_owl', name: 'Night Owl', soul: 'new', tts: { engine: 'kokoro', voice: 'am_michael' } });
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ soul: 'new', skills: ['weather'], musicLean: 'dub', tts: { engine: 'kokoro', voice: 'am_michael', gainDb: 2, speed: 1.1 } });
    expect(next[1]).toBe(roster[1]);
  });

  test("the on-air DJ's picture is looked up under the API, not the site root", () => {
    const sw = new SubWaveSource({ id: 'sw', kind: 'subwave', name: 'SW', url: 'http://radio:7700/', enabled: true } as any);
    expect(sw.apiAbs('/persona-avatar/dj_trump')).toBe('http://radio:7700/api/persona-avatar/dj_trump');
    expect(sw.apiAbs('persona-avatar/x')).toBe('http://radio:7700/api/persona-avatar/x');
    expect(sw.apiAbs('/api/persona-avatar/x')).toBe('http://radio:7700/api/persona-avatar/x');
    expect(sw.apiAbs('https://cdn.example/x.png')).toBe('https://cdn.example/x.png');
    expect(sw.apiAbs('')).toBeUndefined();
    expect(sw.guestAvatar({ id: 'katt', name: 'Katt', avatar: '/persona-avatar/katt' })).toBe('http://radio:7700/api/persona-avatar/katt');
    expect(sw.guestAvatar({ id: 'x y', name: 'X' })).toBe('http://radio:7700/api/persona-avatar/x%20y');
    expect(sw.guestAvatar('Katt')).toBeUndefined();
    // /settings hands back the file name, /schedule the public route: both find the picture.
    expect(sw.avatarFor({ id: 'rick_james', avatar: 'rick_james.jpg' })).toBe('http://radio:7700/api/persona-avatar/rick_james?v=rick_james.jpg');
    expect(sw.avatarFor({ id: 'rick_james', avatar: '/persona-avatar/rick_james' })).toBe('http://radio:7700/api/persona-avatar/rick_james');
    expect(sw.avatarFor({ id: 'rick_james', avatar: '' })).toBeUndefined();
    const custom = new SubWaveSource({ id: 'sw', kind: 'subwave', name: 'SW', url: 'http://radio:7700', apiUrl: 'http://radio:7701', enabled: true } as any);
    expect(custom.apiAbs('/persona-avatar/x')).toBe('http://radio:7701/persona-avatar/x');
  });

  test('running voice engines read from a list or from newer SUB/WAVE\'s object', () => {
    expect([...availableEngines(['kokoro', 'piper'])]).toEqual(['kokoro', 'piper']);
    expect([...availableEngines({ kokoro: true, piper: false, heavyEnabled: ['chatterbox'], cloudByProvider: { openai: true } })]).toEqual(['kokoro']);
    expect(availableEngines(undefined).size).toBe(0);
  });

  test('a DJ without an id is new and goes on the end', () => {
    const next = mergePersona([{ id: 'a_dj', name: 'A' }], { name: 'B' });
    expect(next.map((p) => p.name)).toEqual(['A', 'B']);
    expect(next[1].id).toBeUndefined();
  });

  test("a new DJ starts from SUB/WAVE's default, without its id or picture", () => {
    const p = blankPersona([{ id: 'default_dj', name: 'Max', avatar: 'default_dj.png', frequency: 'chatty', linkStyle: 'natural', tts: { engine: 'inherit' } }]);
    expect(p).toMatchObject({ name: '', avatar: '', frequency: 'chatty', linkStyle: 'natural', tts: { engine: 'inherit' } });
    expect(p.id).toBeUndefined();
    expect(blankPersona()).toMatchObject({ name: '', frequency: 'moderate', humour: 5 });
  });

  test('archive hours are grouped by day, newest first', () => {
    const days = archiveDays([
      { path: '2026-11-08/23.mp3', date: '2026-11-08', hour: 23, bytes: 50e6 },
      { path: '2026-11-09/01.mp3', date: '2026-11-09', hour: 1, bytes: 40e6 },
      { path: '2026-11-09/14.mp3', date: '2026-11-09', hour: 14, bytes: 60e6 },
    ]);
    expect(days.map((d) => d.date)).toEqual(['2026-11-09', '2026-11-08']);
    expect(days[0].hours.map((h) => h.hour)).toEqual([14, 1]);
    expect(days[0].bytes).toBe(100e6);
  });

  test("every one-click fix the health check offers has a route", () => {
    for (const id of ['refresh-playlist', 'restart-mixer', 'generate-jingles', 'tag-library', 'subsonic-reset']) expect(SW_FIXES[id]).toMatch(/^\//);
  });
});
