import { describe, expect, it } from 'vitest';
import { creditsFrom } from '../lib/artistInfo';

describe('song credits', () => {
  it('groups by role, writers first, instruments named', () => {
    const credits = creditsFrom([
      { type: 'producer', artist: { name: 'Ken Caillat' } },
      { type: 'producer', artist: { name: 'Fleetwood Mac' } },
      { type: 'instrument', attributes: ['drums (drum set)'], artist: { name: 'Mick Fleetwood' } },
      { type: 'vocal', attributes: ['lead vocals'], artist: { name: 'Stevie Nicks' } },
      { type: 'performance', work: { title: 'Dreams', relations: [{ type: 'composer', artist: { name: 'Stevie Nicks' } }, { type: 'lyricist', artist: { name: 'Stevie Nicks' } }] } },
      { type: 'producer', artist: { name: 'Ken Caillat' } },
    ]);
    expect(credits.map((c) => c.role)).toEqual(['Written by', 'Lyrics', 'Produced by', 'Vocals', 'Drums (drum set)']);
    expect(credits[2].names).toEqual(['Ken Caillat', 'Fleetwood Mac']);
  });
});
