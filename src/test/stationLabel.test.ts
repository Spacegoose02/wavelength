import { describe, expect, test } from 'vitest';
import { groupByFamily, stationLabel } from '../lib/stationLabel';

const l = (name: string, tags?: string) => stationLabel({ name, tags });

describe('station labels', () => {
  test('split networks and genres out of messy names', () => {
    expect(l('Energy 93@181.FM (Euro EDM)(Dance/Techno)')).toMatchObject({ title: 'Energy 93', network: '181.FM', genres: ['Euro EDM', 'Dance', 'Techno'], family: 'dance' });
    expect(l("90's Dance (181.fm)")).toMatchObject({ title: "90's Dance", network: '181.fm', genres: [], family: 'dance', mark: '90s' });
    expect(l('The Mix @ 181.fm(Pop/Rock/Hits)')).toMatchObject({ title: 'The Mix', network: '181.fm', genres: ['Pop', 'Rock', 'Hits'] });
    expect(l('DEFJAY Radio (RNB/Urban/Hip Hop/Rap)')).toMatchObject({ title: 'DEFJAY Radio', family: 'hiphop' });
    expect(l('KADA Cool (Contemporary) Ada, OK')).toMatchObject({ title: 'KADA Cool', genres: ['Contemporary'], place: 'Ada, OK', family: 'pop' });
    expect(l('108.9 The Office (Pop)')).toMatchObject({ title: '108.9 The Office', family: 'pop', mark: '108' });
    expect(l('BigRigFM (Country)').family).toBe('country');
    expect(l('Awesome 80s (Pop/Rock)(181.fm)')).toMatchObject({ title: 'Awesome 80s', genres: ['Pop', 'Rock'], network: '181.fm' });
    expect(l('The Mix @ 181.fm(Pop/Rock/Hits)').family).toBe('pop');
    expect(l('Energy 93@181.FM (Euro EDM)(Dance/Techno)').mark).toBe('93');
    expect(l('Classic Hits @181.FM (Pop)').mark).toBe('CH');
    expect(l('The Point@181.fm (Pop)').mark).toBe('P');
    expect(l('K-Bull')).toMatchObject({ title: 'K-Bull', genres: [], family: 'country' });
  });

  test('use server tags when the name has no genres', () => {
    expect(l('SUB/WAVE', 'agentic radio')).toMatchObject({ title: 'SUB/WAVE', genres: ['agentic radio'], family: 'ai' });
  });

  test('a genre set with Edit station wins over the name and tags', () => {
    expect(stationLabel({ name: 'The Mix @ 181.fm(Pop/Rock/Hits)', genre: 'Country, Americana' })).toMatchObject({ title: 'The Mix', genres: ['Country', 'Americana'], family: 'country' });
    expect(stationLabel({ name: 'KEXP', genre: 'Indie/Alt' })).toMatchObject({ genres: ['Indie', 'Alt'], family: 'rock' });
    expect(stationLabel({ name: 'BigRigFM (Rock)', genre: '' }).family).toBe('rock');
  });

  test('group in family order, keeping order inside a group', () => {
    const g = groupByFamily([{ name: 'B (Rock)' }, { name: 'A (Pop)' }, { name: 'C (Rock)' }]);
    expect(g.map((x) => [x.family, x.stations.map((s) => s.name)])).toEqual([['pop', ['A (Pop)']], ['rock', ['B (Rock)', 'C (Rock)']]]);
  });
});
