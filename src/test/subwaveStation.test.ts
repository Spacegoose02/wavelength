import { describe, expect, test } from 'vitest';
import { archiveDays, blankPersona, mergePersona, SW_FIXES, type SwPersonaFull } from '../sources/subwave';

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
