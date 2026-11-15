import { describe, expect, it } from 'vitest';
import { parseCsv } from '../lib/playlistImport';
import { readSpotifyFiles } from '../lib/spotifyExport';
import { readZip } from '../lib/zip';

/** A small zip: deflated or stored files, the way Spotify's and Exportify's are made. */
async function makeZip(files: Record<string, string>, stored = false): Promise<Blob> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const dir: Uint8Array[] = [];
  let at = 0;
  let n = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const data = stored ? raw : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const nm = enc.encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, stored ? 0 : 8, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nm.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(10, stored ? 0 : 8, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, raw.length, true);
    central.setUint16(28, nm.length, true);
    central.setUint32(42, at, true);
    parts.push(new Uint8Array(local.buffer), nm, data);
    dir.push(new Uint8Array(central.buffer), nm);
    at += 30 + nm.length + data.length;
    n++;
  }
  const dirSize = dir.reduce((s, d) => s + d.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, n, true);
  end.setUint16(10, n, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, at, true);
  return new Blob([...parts, ...dir, new Uint8Array(end.buffer)] as BlobPart[]);
}

const PLAYLISTS = JSON.stringify({
  playlists: [
    {
      name: 'Road trip',
      items: [
        { track: { trackName: 'Midnight City', artistName: 'M83', albumName: 'Hurry Up, We’re Dreaming', trackUri: 'spotify:track:1' }, episode: null },
        { track: null, episode: { episodeName: 'A podcast' } },
        { track: { trackName: 'One More Time', artistName: 'Daft Punk', albumName: 'Discovery' } },
      ],
    },
    { name: 'Empty one', items: [] },
  ],
});
const LIBRARY = JSON.stringify({
  tracks: [{ artist: 'Adele', album: '25', track: 'Hello', uri: 'spotify:track:2' }, { artist: 'Adele', album: '25', track: 'Hello' }],
  albums: [],
  artists: [{ name: 'Adele', uri: 'x' }, { name: 'M83' }, { name: 'adele' }],
});
const EXPORTIFY = '"Track URI","Track Name","Album URI","Album Name","Artist URI(s)","Artist Name(s)","Release Date"\n"spotify:track:1","Hello","spotify:album:1","25","spotify:artist:1","Adele","2015"\n"spotify:track:3","Get Lucky","spotify:album:2","Random Access Memories","spotify:artist:2,spotify:artist:3","Daft Punk,Pharrell Williams","2013"';

describe('Move from Spotify', () => {
  it('reads Exportify CSVs by their name columns, not the URI ones', () => {
    expect(parseCsv(EXPORTIFY)).toEqual([
      { title: 'Hello', artist: 'Adele', album: '25' },
      { title: 'Get Lucky', artist: 'Daft Punk', album: 'Random Access Memories' },
    ]);
    // plain sheets still work
    expect(parseCsv('Title,Artist\nHello,Adele')).toEqual([{ title: 'Hello', artist: 'Adele', album: undefined }]);
  });

  it('reads files out of a zip, deflated or stored', async () => {
    for (const stored of [false, true]) {
      const entries = await readZip(await makeZip({ 'a/b.txt': 'héllo', 'c.json': '{"x":1}' }, stored));
      expect(entries.map((e) => e.name)).toEqual(['a/b.txt', 'c.json']);
      expect(await entries[0].text()).toBe('héllo');
    }
    await expect(readZip(new Blob(['not a zip at all, just some text here']))).rejects.toThrow(/zip/);
  });

  it('reads Spotify’s data export: playlists, liked songs and followed artists', async () => {
    const zip = await makeZip({
      'Spotify Account Data/Playlist1.json': PLAYLISTS,
      'Spotify Account Data/YourLibrary.json': LIBRARY,
      'Spotify Account Data/Userdata.json': '{"username":"mia123"}',
      'Spotify Account Data/StreamingHistory_music_0.json': '[{"trackName":"x"}]',
      'Spotify Account Data/Read Me First.pdf': '%PDF',
    });
    const b = await readSpotifyFiles([{ name: 'my_spotify_data.zip', blob: zip }]);
    expect(b).toEqual({
      account: 'mia123',
      playlists: [
        { name: 'Road trip', songs: [{ title: 'Midnight City', artist: 'M83', album: 'Hurry Up, We’re Dreaming' }, { title: 'One More Time', artist: 'Daft Punk', album: 'Discovery' }] },
        { name: 'Empty one', songs: [] },
      ],
      liked: [{ title: 'Hello', artist: 'Adele', album: '25' }],
      artists: ['Adele', 'M83'],
      skipped: [],
    });
  });

  it('reads Exportify’s export-all zip and loose files, without doubling up', async () => {
    const zip = await makeZip({ 'liked_songs.csv': EXPORTIFY, 'road_trip.csv': EXPORTIFY });
    const b = await readSpotifyFiles([
      { name: 'spotify_playlists.zip', blob: zip },
      { name: 'road_trip.csv', blob: new Blob([EXPORTIFY]) },
      { name: 'Playlist1.json', blob: new Blob([PLAYLISTS]) },
    ]);
    expect(b.liked.map((s) => s.title)).toEqual(['Hello', 'Get Lucky']);
    expect(b.playlists.map((p) => p.name)).toEqual(['road trip', 'Road trip', 'Empty one']);
  });
});
