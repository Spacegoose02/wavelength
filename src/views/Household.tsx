import { useEffect, useState, type FormEvent } from 'react';
import { sharedTrack } from '../lib/inbox';
import { findInLibrary, pool } from '../lib/match';
import type { HouseholdEntry, HouseholdPlaylist } from '../sources/hub';
import type { Track } from '../sources/types';
import { hubClient, useHub } from '../store/hub';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { Cover, Empty, Spinner, TrackList } from '../components/common';
import { IconPlay, IconShuffle, IconX } from '../components/Icons';

/**
 * Household playlists (hub/src/routes/household.ts): one list the whole house adds to. The Hub keeps each
 * song's title and artist; every person's app finds it in their own library to play it.
 */

const errText = (e: unknown) => String((e as Error)?.message ?? e);

/** Grown-up profiles on a Hub. */
export const useHousehold = () => useHub((s) => !!s.token && s.user?.role !== 'kid');

/** Playlists → Household: the list, and making a new one. */
export function HouseholdPlaylists() {
  const on = useHousehold();
  const [list, setList] = useState<HouseholdPlaylist[]>();
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    if (on) hubClient()?.householdPlaylists().then((r) => setList(r.playlists), (e) => setErr(errText(e)));
  }, [on]);
  if (!on) return null;
  const make = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const { playlist } = await hubClient()!.createHouseholdPlaylist(name.trim());
      setName('');
      useUi.getState().go({ view: 'household', id: playlist.id });
    } catch (x) {
      setErr(errText(x));
    }
  };
  return (
    <section>
      <h2>Household <small className="muted">playlists everyone in the house adds to</small></h2>
      {err && <div className="errors">{err}</div>}
      {list === undefined && !err ? <Spinner /> : (
        <div className="smart-list">
          {list?.map((p) => (
            <button key={p.id} className="source-row as-button" onClick={() => useUi.getState().go({ view: 'household', id: p.id })}>
              <Cover src={p.cover ?? undefined} alt={p.name} className="row-cover" />
              <div className="track-main">
                <div className="track-title">{p.name}</div>
                <div className="track-sub">{p.songs} song{p.songs === 1 ? '' : 's'}{p.owner ? ` · started by ${p.owner.displayName}` : ''}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      <form className="row gap" onSubmit={make} style={{ marginTop: 8 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New household playlist, e.g. Saturday cleaning" maxLength={120} />
        <button className="btn" disabled={!name.trim()}>Start it</button>
      </form>
    </section>
  );
}

/** "Add to household…" on a playlist, album or the song playing. */
export function AddToHousehold({ tracks, label = 'Add to household…' }: { tracks: Track[]; label?: string }) {
  const on = useHousehold();
  const [list, setList] = useState<HouseholdPlaylist[]>([]);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (on) hubClient()?.householdPlaylists().then((r) => setList(r.playlists), () => undefined);
  }, [on]);
  const songs = tracks.filter((t) => t.kind === 'track');
  if (!on || !list.length || !songs.length) return null;
  return (
    <>
      <select className="btn" value="" aria-label={label} onChange={async (e) => {
        const id = Number(e.target.value);
        if (!id) return;
        try {
          const { added } = await hubClient()!.addToHousehold(id, songs.map(sharedTrack));
          setMsg(`✓ Added ${added}`);
        } catch (x) {
          setMsg(errText(x));
        }
      }}>
        <option value="">{label}</option>
        {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {msg && <span className="muted small">{msg}</span>}
    </>
  );
}

export function HouseholdPlaylistView({ id }: { id: number }) {
  const me = useHub((s) => s.user);
  const admin = useHub((s) => s.permissions.includes('users.manage'));
  const myPlaylists = useLibrary((s) => s.playlists);
  const playTracks = usePlayer((s) => s.playTracks);
  const playing = usePlayer((s) => s.queue[s.index]);
  const [data, setData] = useState<{ playlist: HouseholdPlaylist; tracks: HouseholdEntry[] }>();
  /** Each entry's song in this person's library, once looked up (null: not there). */
  const [found, setFound] = useState<Record<number, Track | null>>({});
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    try {
      const d = await hubClient()!.householdPlaylist(id);
      setData(d);
      const find = findInLibrary();
      const todo = d.tracks.filter((e) => !(e.id in found));
      const hits = await pool(todo, 4, (e) => find(e.track));
      setFound((f) => ({ ...f, ...Object.fromEntries(todo.map((e, i) => [e.id, hits[i] ?? null])) }));
    } catch (e) {
      setErr(errText(e));
    }
  };
  useEffect(() => {
    void load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err && !data) return <div className="page"><div className="errors">{err}</div></div>;
  if (!data) return <div className="page"><Spinner /></div>;
  const { playlist: p, tracks: entries } = data;
  const mine = p.owner?.id === me?.id || admin;
  const here = entries.filter((e) => found[e.id]);
  const tracks = here.map((e) => found[e.id]!);
  const missing = entries.filter((e) => found[e.id] === null);
  const looking = entries.some((e) => !(e.id in found));

  const act = async (f: () => Promise<unknown>, done?: string) => {
    try {
      await f();
      setMsg(done ?? '');
      await load();
    } catch (e) {
      setMsg(errText(e));
    }
  };
  const add = (list: Track[], what: string) => act(() => hubClient()!.addToHousehold(p.id, list.filter((t) => t.kind === 'track').map(sharedTrack)), `✓ Added ${what}`);
  const move = (i: number, to: number) => {
    const order = here.map((e) => e.id);
    const [x] = order.splice(i, 1);
    order.splice(to, 0, x);
    // songs not in this person's library keep their place after these
    void act(() => hubClient()!.orderHousehold(p.id, order));
  };

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-art"><Cover src={p.cover ?? undefined} alt={p.name} /></div>
        <div>
          <div className="kicker">Household playlist{p.owner ? ` · started by ${p.owner.displayName}` : ''}</div>
          <h1>{p.name}</h1>
          <div className="muted">{entries.length} song{entries.length === 1 ? '' : 's'}{looking ? ' · finding them in your library…' : missing.length ? ` · ${missing.length} not in your library` : ''}</div>
          <div className="hero-actions">
            <button className="btn primary" disabled={!tracks.length} onClick={() => playTracks(tracks)}><IconPlay /> Play</button>
            <button className="btn" disabled={!tracks.length} onClick={() => {
              if (!usePlayer.getState().shuffle) usePlayer.getState().toggleShuffle();
              playTracks(tracks, Math.floor(Math.random() * tracks.length));
            }}><IconShuffle /> Shuffle</button>
            {playing?.kind === 'track' && <button className="btn" onClick={() => void add([playing], `“${playing.title}”`)}>+ What's playing</button>}
            {myPlaylists.length > 0 && (
              <select className="btn" value="" aria-label="Add songs from one of your playlists" onChange={(e) => {
                const pl = myPlaylists.find((x) => x.id === e.target.value);
                if (pl) void add(pl.tracks, `songs from ${pl.name}`);
              }}>
                <option value="">+ From my playlist…</option>
                {myPlaylists.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            )}
            {mine && <button className="btn ghost" onClick={() => {
              const name = prompt('Rename the playlist', p.name);
              if (name?.trim()) void act(() => hubClient()!.renameHouseholdPlaylist(p.id, name.trim()));
            }}>Rename</button>}
            {mine && <button className="btn ghost" onClick={async () => {
              if (!confirm(`Delete “${p.name}” for everyone?`)) return;
              await act(() => hubClient()!.deleteHouseholdPlaylist(p.id));
              useUi.getState().go({ view: 'playlists' });
            }}>Delete</button>}
          </div>
          {msg && <p className="muted small">{msg}</p>}
        </div>
      </header>
      {!entries.length ? (
        <Empty title="Nothing here yet">Add the song that's playing, or songs from one of your playlists. Everyone in the house can add theirs.</Empty>
      ) : (
        <>
          <TrackList tracks={tracks} showAlbum showCover
            meta={(_t, i) => <span className="muted small">{here[i]?.addedBy?.displayName ?? ''}</span>}
            onRemove={(i) => void act(() => hubClient()!.removeFromHousehold(p.id, here[i].id))}
            onMove={move} />
          {missing.length > 0 && (
            <>
              <h3>Not in your library</h3>
              <div className="tracklist">
                {missing.map((e) => (
                  <div key={e.id} className="source-row">
                    <div className="track-main">
                      <div className="track-title">{e.track.title}</div>
                      <div className="track-sub">{e.track.artist}{e.addedBy ? ` · added by ${e.addedBy.displayName}` : ''}</div>
                    </div>
                    <button className="icon-btn" title="Take it off" onClick={() => void act(() => hubClient()!.removeFromHousehold(p.id, e.id))}><IconX /></button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
