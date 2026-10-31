import { useEffect, useMemo, useState } from 'react';
import { useCatalog } from '../store/catalog';
import { useCan } from '../store/hub';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { usePlayer } from '../store/player';
import { sourceFor, mergeAlbums } from '../sources/registry';
import { stationToTrack } from '../sources/radio';
import type { Album, Artist, Track } from '../sources/types';
import { SOURCE_COLORS } from '../sources/types';
import { AlbumCard, ArtistCard, Cover, Rating, Empty, Grid, SourceDots, Spinner, TrackList, fmtTime } from '../components/common';
import { IconPlay, IconShuffle } from '../components/Icons';
import { AddToPlaylist } from '../components/AddToPlaylist';
import { ShareButton } from '../components/ShareButton';
import { shareOfArtist, shareOfTracks } from '../lib/inbox';
import { albumVersion, explicitOfAlbum, explicitOfTrack, useHidden, useIsKid, useRatings } from '../lib/kids';
import { hasBoth, preferredRef, useVersionHidden, useVersionPref, versionOf, versionsOf } from '../lib/versions';
import { CleanVersionButton, KidFlagButton } from '../components/KidFlag';
import { deleteAlbum, deleteAlbums } from '../lib/deleteAlbums';
import { applyMerge, navidromeRefs, planAlbums, planArtists, type MergePlan } from '../lib/merge';
import { SelectBar, useSelection, type Selection } from '../components/Selection';
import { QueueAllOnSubwave } from '../components/TrackButtons';
import { DownloadButton } from '../components/DownloadButton';
import { ArtworkButton } from '../components/ArtworkButton';
import { albumArt, artistArt, useArtworkList } from '../lib/artwork';
import { FollowButton } from '../components/FollowButton';
import { SongRadioButton } from '../components/SongRadioButton';

const openAlbum = (album: Album) => useUi.getState().go({ view: 'album', album });

export function Home() {
  const { recent, albums, loading, loaded, errors } = useCatalog();
  const sources = useSettings((s) => s.sources);
  const stations = useSettings((s) => s.stations);
  const go = useUi((s) => s.go);
  const playTracks = usePlayer((s) => s.playTracks);
  const subwave = sources.filter((s) => s.kind === 'subwave' && s.enabled);
  // stable pick: the same 12 all day (no reshuffling on every render/visit), new set tomorrow
  const [shuffleSeed, setShuffleSeed] = useState(rediscoverSeed);
  const rediscover = useMemo(() => pickDaily(albums, 12, shuffleSeed), [albums.length, shuffleSeed]);

  if (!sources.length) {
    return (
      <Empty title="Welcome to Wavelength">
        <p>Add your Navidrome, Plex, Audiobookshelf and SubWave servers to build one catalog.</p>
        <button className="btn primary" onClick={() => go({ view: 'settings' })}>Add a source</button>
      </Empty>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Good {greeting()}</h1>
        {loading && <Spinner />}
      </header>
      <ErrorList errors={errors} />

      {(subwave.length > 0 || stations.length > 0) && (
        <section>
          <h2>On air</h2>
          <div className="shelf">
            {subwave.map((cfg) => (
              <button key={cfg.id} className="station-hero" onClick={async () => {
                const [st] = await sourceFor(cfg).getStations!();
                playTracks([stationToTrack(st)]);
              }}>
                <span className="live-dot" /> <b>{cfg.name}</b><small>Agentic radio</small>
              </button>
            ))}
            {stations.slice(0, 8).map((st) => (
              <button key={st.id} className="station-pill" onClick={() => playTracks([stationToTrack(st)])}>
                <Cover src={st.favicon} alt={st.name} className="tiny" /> {st.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <h2>Recently added <button className="link small" onClick={() => go({ view: 'recent' })}>See all →</button></h2>
          <div className="row-scroll">{recent.map((a) => <AlbumCard key={`${a.sourceId}:${a.id}`} album={a} onOpen={openAlbum} />)}</div>
        </section>
      )}
      {rediscover.length > 0 && (
        <section>
          <h2>Rediscover <button className="link small" onClick={() => setShuffleSeed((rediscoverSeed += 1))}>Shuffle ↻</button></h2>
          <div className="row-scroll">{rediscover.map((a) => <AlbumCard key={`${a.sourceId}:${a.id}`} album={a} onOpen={openAlbum} />)}</div>
        </section>
      )}
      {loaded && !albums.length && !loading && <Empty title="No albums yet">Check your sources in Settings.</Empty>}
    </div>
  );
}

let rediscoverSeed = 0;

/** Deterministic shuffle keyed on today's date (+ a reshuffle counter). */
function pickDaily<T extends { id: string; sourceId: string }>(items: T[], n: number, extra: number): T[] {
  const day = new Date().toISOString().slice(0, 10);
  const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  return [...items]
    .map((a) => ({ a, k: hash(`${day}:${extra}:${a.sourceId}:${a.id}`) }))
    .sort((x, y) => x.k - y.k)
    .slice(0, n)
    .map((x) => x.a);
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

export function ErrorList({ errors }: { errors: Record<string, string> }) {
  const entries = Object.entries(errors);
  if (!entries.length) return null;
  return (
    <div className="errors">
      {entries.map(([name, msg]) => <div key={name}><b>{name}:</b> {msg}</div>)}
    </div>
  );
}

export function Albums() {
  const { albums, loading } = useCatalog();
  const sources = useSettings((s) => s.sources);
  const [filter, setFilter] = useState('');
  const [only, setOnly] = useState<string | null>(null);
  const hidden = useHidden();
  const kid = useIsKid();
  const [busy, setBusy] = useState<string>();
  const shown = useMemo(() => {
    const f = filter.toLowerCase();
    return albums.filter(
      (a) => (!f || a.title.toLowerCase().includes(f) || a.artist.toLowerCase().includes(f)) &&
        (!only || (a.refs ?? [a]).some((r) => r.sourceId === only)) && !hidden.album(a),
    );
  }, [albums, filter, only, hidden]);
  const musicSources = sources.filter((s) => s.enabled && (s.kind === 'navidrome' || s.kind === 'plex'));
  const cardKey = (a: Album) => `${a.sourceId}:${a.id}`;
  // what can be ticked: the cards on screen (a version hidden by Settings → Playback isn't)
  const otherVersion = useVersionHidden();
  const selectable = useMemo(() => shown.slice(0, 600).filter((a) => !otherVersion(a)), [shown, otherVersion]);
  const sel = useSelection(selectable, cardKey);
  return (
    <div className="page">
      <header className="page-head">
        <h1>Albums <small>{shown.length}</small></h1>
        {loading && <Spinner />}
        {!kid && <button className="btn small" title="Duplicates and missing albums" onClick={() => useUi.getState().go({ view: 'libraryCare' })}>Library care</button>}
        <button className={`btn small ${sel.selecting ? 'primary' : ''}`} onClick={sel.selecting ? sel.stop : sel.start}>{sel.selecting ? 'Done' : 'Select'}</button>
        <input className="filter" placeholder="Filter albums…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </header>
      {sel.selecting && (
        <SelectBar sel={sel} all={selectable} filtered={!!filter || !!only} name={(a) => a.title} status={busy}>
          <AlbumSelectActions sel={sel} busy={busy} setBusy={setBusy} />
        </SelectBar>
      )}
      {musicSources.length > 1 && (
        <div className="chips">
          <button className={`chip ${!only ? 'on' : ''}`} onClick={() => setOnly(null)}>All sources</button>
          {musicSources.map((s) => (
            <button key={s.id} className={`chip ${only === s.id ? 'on' : ''}`} onClick={() => setOnly(s.id)}>
              <i className="dot" style={{ background: SOURCE_COLORS[s.kind] }} /> {s.name}
            </button>
          ))}
        </div>
      )}
      <Grid>{shown.slice(0, 600).map((a) => (
        <AlbumCard key={cardKey(a)} album={a} onOpen={(x, e) => sel.click(x, e) || openAlbum(x)} onPick={sel.pick}
          selected={sel.isPicked(a)} badge={sel.badge(a)} />
      ))}</Grid>
      {shown.length > 600 && <p className="muted center">Showing 600 of {shown.length} — filter to narrow down.</p>}
    </div>
  );
}

export function Artists() {
  const { artists } = useCatalog();
  const go = useUi((s) => s.go);
  const [filter, setFilter] = useState('');
  const hidden = useHidden();
  const kid = useIsKid();
  const canEdit = useCan('library.edit');
  const [busy, setBusy] = useState<string>();
  const shown = useMemo(() => artists.filter((a) => a.name.toLowerCase().includes(filter.toLowerCase()) && !hidden.artist(a)), [artists, filter, hidden]);
  const selectable = useMemo(() => shown.slice(0, 600), [shown]);
  const sel = useSelection(selectable, (a: Artist) => `${a.sourceId}:${a.id}`);
  const chosen = sel.chosen;
  const play = (how: PlayHow) => withBusy(setBusy, 'Loading songs…', async () => playAll(await tracksOfArtists(chosen), how));
  const merge = () => withBusy(setBusy, 'Reading tags…', async () => {
    const plan = await planArtists(chosen);
    if (await confirmMerge(plan, chosen.slice(1).map((a) => a.name), setBusy)) {
      forgetArtists(chosen.slice(1));
      sel.clear();
    }
  });
  return (
    <div className="page">
      <header className="page-head">
        <h1>Artists <small>{shown.length}</small></h1>
        <button className={`btn small ${sel.selecting ? 'primary' : ''}`} onClick={sel.selecting ? sel.stop : sel.start}>{sel.selecting ? 'Done' : 'Select'}</button>
        <input className="filter" placeholder="Filter artists…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </header>
      {sel.selecting && (
        <SelectBar sel={sel} all={selectable} filtered={!!filter} name={(a) => a.name} status={busy}>
          <SelectionPlayButtons disabled={!chosen.length || !!busy} play={play} />
          {canEdit && !kid && <button className="btn" disabled={chosen.length < 2 || !!busy} title="Merge the others into the first one you ticked" onClick={merge}>Merge{chosen.length > 1 ? ` (${chosen.length})` : ''}</button>}
        </SelectBar>
      )}
      <Grid>
        {selectable.map((a) => (
          <ArtistCard key={`${a.sourceId}:${a.id}`} artist={a} onOpen={(x, e) => sel.click(x, e) || go({ view: 'artist', artist: x })} onPick={sel.pick}
            selected={sel.isPicked(a)} badge={sel.badge(a)} />
        ))}
      </Grid>
    </div>
  );
}

// ---- what the select bar does (components/Selection.tsx) ----

/** Play, Merge and Delete for ticked albums (Albums, and an artist's page). */
function AlbumSelectActions({ sel, busy, setBusy }: { sel: Selection<Album>; busy?: string; setBusy(s?: string): void }) {
  const kid = useIsKid();
  const canEdit = useCan('library.edit') && !kid;
  const pref = useVersionPref();
  const chosen = sel.chosen;
  const removeChosen = async () => {
    const copies = chosen.flatMap((a) => navidromeRefs(a));
    if (!copies.length) return alert('None of these are on a Navidrome server the Hub can delete from.');
    const names = chosen.slice(0, 8).map((a) => `• ${a.title} – ${a.artist}`).join('\n') + (chosen.length > 8 ? `\n…and ${chosen.length - 8} more` : '');
    if (!confirm(`Delete ${chosen.length} album${chosen.length === 1 ? '' : 's'} (${copies.length} cop${copies.length === 1 ? 'y' : 'ies'}) from your server?\n\n${names}\n\nTheir files go to the Hub's trash. You can put them back under Settings → Server → Deleted albums for 30 days.`)) return;
    const failed: string[] = [];
    let n = 0;
    await deleteAlbums(copies, (a, r) => {
      setBusy(`Deleting… ${++n} of ${copies.length}`);
      if ('error' in r) failed.push(`${a.title}: ${r.error}`);
    });
    setBusy(undefined);
    sel.clear();
    alert(failed.length ? `Deleted ${copies.length - failed.length} of ${copies.length}. These couldn't be deleted:\n${failed.slice(0, 10).join('\n')}` : `Deleted ${copies.length} album${copies.length === 1 ? '' : 's'}. They're in the Hub's trash for 30 days.`);
  };
  const play = (how: PlayHow) => withBusy(setBusy, 'Loading songs…', async () => playAll(await tracksOfAlbums(chosen, pref), how));
  const merge = () => withBusy(setBusy, 'Reading tags…', async () => {
    const plan = await planAlbums(chosen);
    if (await confirmMerge(plan, chosen.slice(1).map((a) => `${a.title} – ${a.artist}`), setBusy)) {
      forgetAlbums(chosen.slice(1));
      sel.clear();
    }
  });
  return (
    <>
      <SelectionPlayButtons disabled={!chosen.length || !!busy} play={play} />
      {canEdit && <button className="btn" disabled={chosen.length < 2 || !!busy} title="Merge the others into the first one you ticked" onClick={merge}>Merge{chosen.length > 1 ? ` (${chosen.length})` : ''}</button>}
      {canEdit && <button className="btn danger" disabled={!chosen.length || !!busy} onClick={() => void removeChosen()}>Delete selected{chosen.length ? ` (${chosen.length})` : ''}</button>}
    </>
  );
}

type PlayHow = 'play' | 'shuffle' | 'next' | 'queue';

function SelectionPlayButtons({ disabled, play }: { disabled: boolean; play(how: PlayHow): void }) {
  return (
    <>
      <button className="btn primary" disabled={disabled} onClick={() => play('play')}><IconPlay /> Play</button>
      <button className="btn" disabled={disabled} onClick={() => play('shuffle')}><IconShuffle /> Shuffle</button>
      <button className="btn" disabled={disabled} onClick={() => play('next')}>Play next</button>
      <button className="btn" disabled={disabled} onClick={() => play('queue')}>Add to queue</button>
    </>
  );
}

async function withBusy(setBusy: (s?: string) => void, label: string, fn: () => Promise<void>) {
  setBusy(label);
  try {
    await fn();
  } catch (e) {
    alert(String((e as Error).message ?? e));
  } finally {
    setBusy(undefined);
  }
}

function playAll(tracks: Track[], how: PlayHow) {
  if (!tracks.length) return alert('No songs found on those.');
  const p = usePlayer.getState();
  if (how === 'next') return p.playNext(tracks);
  if (how === 'queue') return p.enqueue(tracks);
  if (how === 'shuffle' && !p.shuffle) p.toggleShuffle();
  if (how === 'play' && p.shuffle) p.toggleShuffle();
  p.playTracks(tracks, how === 'shuffle' ? Math.floor(Math.random() * tracks.length) : 0);
}

/** The ticked albums' songs, in the order ticked, each from the copy its page would open on. */
async function tracksOfAlbums(albums: Album[], pref: ReturnType<typeof useVersionPref>) {
  const sources = useSettings.getState().sources;
  const out: Track[] = [];
  for (const a of albums.slice(0, 100)) {
    const ref = preferredRef(a, pref) ?? (a.refs ?? [a])[0];
    const cfg = sources.find((s) => s.id === ref.sourceId);
    if (cfg) out.push(...await sourceFor(cfg).getAlbumTracks!(ref.id).catch(() => []));
  }
  return out;
}

/** The ticked artists' songs: all their albums, newest first, artist by artist. */
async function tracksOfArtists(artists: Artist[]) {
  const sources = useSettings.getState().sources;
  const out: Track[] = [];
  for (const artist of artists.slice(0, 30)) {
    const lists = await Promise.all((artist.refs ?? [artist]).map(async (r) => {
      const cfg = sources.find((s) => s.id === r.sourceId);
      return cfg ? (await sourceFor(cfg).getArtistAlbums?.(r.id).catch(() => [])) ?? [] : [];
    }));
    const albums = mergeAlbums(lists).sort((a, b) => (b.year ?? 0) - (a.year ?? 0)).slice(0, 40);
    for (const a of albums) {
      const cfg = sources.find((s) => s.id === a.sourceId);
      if (cfg) out.push(...await sourceFor(cfg).getAlbumTracks!(a.id).catch(() => []));
    }
  }
  return out;
}

/** Show what a merge will change, ask, and save it. True when it was saved. */
async function confirmMerge(plan: MergePlan, others: string[], setBusy: (s?: string) => void) {
  if (!plan.changes.length) {
    alert(`Nothing to change: ${others.join(', ')} already ${others.length === 1 ? 'has' : 'have'} the same tags as ${plan.into}.${plan.missing.length ? ` (${plan.missing.length} files weren't found in the Hub's music folder.)` : ''}`);
    return false;
  }
  const list = others.slice(0, 8).map((x) => `• ${x}`).join('\n') + (others.length > 8 ? `\n…and ${others.length - 8} more` : '');
  const missing = plan.missing.length ? `\n\n${plan.missing.length} file${plan.missing.length === 1 ? ' isn’t' : 's aren’t'} in the Hub's music folder and will be left out.` : '';
  if (!confirm(`Merge into ${plan.into}?\n\n${list}\n\nThis rewrites the tags of ${plan.changes.length} song${plan.changes.length === 1 ? '' : 's'}. The audio isn't touched, and you can undo it under Settings → Server → Tag edits.${missing}`)) return false;
  setBusy('Merging…');
  const r = await applyMerge(plan);
  alert(`Merged: ${r.changed.length} song${r.changed.length === 1 ? '' : 's'} retagged${r.failed.length ? `; ${r.failed.length} failed (${r.failed[0].error})` : ''}. Navidrome rescans in a minute or two to show it.`);
  // the library refreshes once Navidrome has had time to rescan
  window.setTimeout(() => void useCatalog.getState().load(), 120_000);
  return r.changed.length > 0;
}

/** Take merged albums and artists off the lists now; the refresh after the rescan shows the result. */
function forgetAlbums(gone: Album[]) {
  const keys = new Set(gone.flatMap((a) => navidromeRefs(a)).map((r) => `${r.sourceId}:${r.id}`));
  const keep = (a: Album) => {
    const refs = (a.refs ?? [a]).filter((r) => !keys.has(`${r.sourceId}:${r.id}`));
    return refs.length === (a.refs ?? [a]).length ? [a] : refs.length ? [{ ...a, ...refs[0], refs }] : [];
  };
  useCatalog.setState((s) => ({ albums: s.albums.flatMap(keep), recent: s.recent.flatMap(keep) }));
}

function forgetArtists(gone: Artist[]) {
  const keys = new Set(gone.flatMap((a) => navidromeRefs(a)).map((r) => `${r.sourceId}:${r.id}`));
  useCatalog.setState((s) => ({
    artists: s.artists.flatMap((a) => {
      const refs = (a.refs ?? [a]).filter((r) => !keys.has(`${r.sourceId}:${r.id}`));
      return refs.length === (a.refs ?? [a]).length ? [a] : refs.length ? [{ ...a, ...refs[0], refs }] : [];
    }),
  }));
}

function useSourceCfg() {
  const sources = useSettings((s) => s.sources);
  return (id: string) => sources.find((s) => s.id === id);
}

export function ArtistView({ artist }: { artist: Artist }) {
  const cfgOf = useSourceCfg();
  const canEditTags = useCan('library.edit');
  const [albums, setAlbums] = useState<Album[] | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all(
      (artist.refs ?? [artist]).map(async (ref) => {
        const cfg = cfgOf(ref.sourceId);
        try {
          return cfg ? (await sourceFor(cfg).getArtistAlbums?.(ref.id)) ?? [] : [];
        } catch {
          return [];
        }
      }),
    ).then((lists) => alive && setAlbums(mergeAlbums(lists).sort((a, b) => (b.year ?? 0) - (a.year ?? 0))));
    return () => {
      alive = false;
    };
  }, [artist]);
  const hidden = useHidden();
  useArtworkList();
  const [busy, setBusy] = useState<string>();
  const otherVersion = useVersionHidden();
  const selectable = useMemo(() => (albums ?? []).filter((a) => !otherVersion(a)), [albums, otherVersion]);
  const sel = useSelection(selectable, (a: Album) => `${a.sourceId}:${a.id}`);
  if (hidden.artist(artist)) return <div className="page"><Empty title="Not available">Ask a grown-up about this one.</Empty></div>;

  return (
    <div className="page">
      <header className="hero">
        <Cover src={artistArt(artist)} alt={artist.name} round className="hero-art" />
        <div>
          <div className="kicker">Artist</div>
          <h1>{artist.name}</h1>
          <SourceDots sourceIds={(artist.refs ?? [artist]).map((r) => r.sourceId)} />
          <div className="hero-actions">
            <FollowButton name={artist.name} />
            <SongRadioButton artist={artist.name} />
            <ShareButton what={() => shareOfArtist(artist.name, artistArt(artist))} />
            <KidFlagButton kind="artist" artist={artist.name} />
            <ArtworkButton kind="artist" artist={artist.name} current={artistArt(artist)} />
            {canEditTags && (artist.refs ?? [artist]).some((r) => cfgOf(r.sourceId)?.kind === 'navidrome') && (
              <button className="btn" title="Rename this artist, or merge two spellings, in all their songs' tags" onClick={() => useUi.getState().go({ view: 'artistTags', artist })}>Edit artist</button>
            )}
          </div>
        </div>
      </header>
      {albums && albums.length > 1 && (
        <div className="row">
          <button className={`btn small ${sel.selecting ? 'primary' : ''}`} onClick={sel.selecting ? sel.stop : sel.start}>{sel.selecting ? 'Done' : 'Select'}</button>
        </div>
      )}
      {sel.selecting && (
        <SelectBar sel={sel} all={selectable} filtered={false} name={(a) => a.title} status={busy}>
          <AlbumSelectActions sel={sel} busy={busy} setBusy={setBusy} />
        </SelectBar>
      )}
      {!albums ? <Spinner /> : (
        <Grid>{albums.map((a) => (
          <AlbumCard key={`${a.sourceId}:${a.id}`} album={a} onOpen={(x, e) => sel.click(x, e) || openAlbum(x)} onPick={sel.pick}
            selected={sel.isPicked(a)} badge={sel.badge(a)} />
        ))}</Grid>
      )}
    </div>
  );
}

export function AlbumView({ album, focus }: { album: Album; focus?: { id: string; sourceId: string; title?: string } }) {
  const cfgOf = useSourceCfg();
  const refs = album.refs ?? [album];
  const [refIdx, setRefIdx] = useState(0);
  const pref = useVersionPref();
  // a version picked on the Explicit / Clean switch (or the preferred one), which can be another album's copy
  const [pick, setPick] = useState<Album | undefined>(() => preferredRef(album, pref));
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [error, setError] = useState<string>();
  const playTracks = usePlayer((s) => s.playTracks);
  const ref = pick ?? refs[refIdx];
  const hidden = useHidden();
  useRatings((s) => s.ratings);
  useArtworkList();
  const art = albumArt(album, ref.coverUrl ?? album.coverUrl);
  useCatalog((s) => s.albums);
  const versions = versionsOf(album);
  const both = hasBoth(versions);
  const shown = versionOf(ref);
  const canEditTags = useCan('library.edit');
  const kid = useIsKid();

  // Navidrome can list one album as two, e.g. when a song was downloaded on its own into another folder: the
  // parts on this server (of the same version) are shown, played and counted together
  const parts = splitParts(ref, both ? [ref, ...versions.map((v) => v.ref)] : refs);
  const partsKey = parts.map((p) => `${p.sourceId}:${p.id}`).join(',');
  useEffect(() => {
    let alive = true;
    setTracks(null);
    setError(undefined);
    const cfg = cfgOf(ref.sourceId);
    if (!cfg) return;
    const src = sourceFor(cfg);
    Promise.all(parts.map((p) => src.getAlbumTracks!(p.id)))
      .then((lists) => alive && setTracks(parts.length > 1 ? byPosition(lists.flat()) : lists[0]))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [ref, partsKey]);

  const total = tracks?.reduce((s, t) => s + (t.duration ?? 0), 0) ?? 0;
  // the copy on screen: the version picked on the switch, or the album opened
  const shownAlbum = both ? ref : album;
  if (hidden.album(shownAlbum)) return <div className="page"><Empty title="Not available">Ask a grown-up about this one.</Empty></div>;
  return (
    <div className="page">
      <header className="hero">
        <Cover src={art} alt={album.title} className="hero-art" />
        <div>
          <div className="kicker">Album{album.year ? ` · ${album.year}` : ''}</div>
          <h1>{both ? ref.title : album.title} <Rating explicit={both ? shown : explicitOfAlbum(album)} /></h1>
          <button className="link" onClick={() => {
            const artist = useCatalog.getState().artists.find((a) => (a.refs ?? [a]).some((r) => r.id === ref.artistId && r.sourceId === ref.sourceId));
            if (artist) useUi.getState().go({ view: 'artist', artist });
          }}>{album.artist}</button>
          <div className="muted">{tracks ? `${tracks.length} tracks · ${fmtTime(total)}` : ''}</div>
          <div className="hero-actions">
            <button className="btn primary" disabled={!tracks?.length} onClick={() => tracks && playTracks(tracks)}><IconPlay /> Play</button>
            <button className="btn" disabled={!tracks?.length} onClick={() => {
              if (!tracks) return;
              if (!usePlayer.getState().shuffle) usePlayer.getState().toggleShuffle();
              playTracks(tracks, Math.floor(Math.random() * tracks.length));
            }}><IconShuffle /> Shuffle</button>
            {tracks?.length ? <AddToPlaylist tracks={tracks} label="Add to playlist" className="btn" /> : null}
            {tracks?.length ? <QueueAllOnSubwave tracks={tracks} albumBlock /> : null}
            {tracks?.length ? <ShareButton what={() => shareOfTracks('album', album.title, tracks, album.artist, art)} /> : null}
            {/* the version on screen: with the Explicit / Clean switch that can be another album's copy */}
            <KidFlagButton kind="album" artist={album.artist} title={shownAlbum.title} version={albumVersion(shownAlbum)}
              explicit={explicitOfAlbum(shownAlbum) === 'explicit' || tracks?.some((t) => explicitOfTrack(t) === 'explicit')} />
            {!both && albumVersion(album) !== 'clean' && <CleanVersionButton artist={album.artist} album={album.title} />}
            {both && !kid && (
              <div className="chips inline" role="group" aria-label="Version">
                {(['explicit', 'clean'] as const).map((v) => (
                  <button key={v} className={`chip ${shown === v ? 'on' : ''}`} onClick={() => setPick(versions.find((x) => x.version === v)?.ref)}>
                    {v === 'explicit' ? 'Explicit' : 'Clean'}
                  </button>
                ))}
              </div>
            )}
            <ArtworkButton kind="album" artist={album.artist} album={album.title} current={art} />
            {canEditTags && cfgOf(ref.sourceId)?.kind === 'navidrome' && (
              <button className="btn" title="Fix this album's tags in its files" onClick={() => useUi.getState().go({ view: 'tags', album: { ...ref, refs: [ref] } })}>Edit tags</button>
            )}
            {canEditTags && cfgOf(ref.sourceId)?.kind === 'navidrome' && <DeleteAlbumButton album={ref} />}
            {tracks?.length ? (
              <DownloadButton id={`album:${ref.sourceId}:${ref.id}`} kind="album" name={album.title} subtitle={album.artist}
                cover={art} tracks={tracks} />
            ) : null}
            {new Set(refs.map((r) => r.sourceId)).size > 1 && (
              <div className="chips inline">
                {refs.map((r, i) => refs.findIndex((x) => x.sourceId === r.sourceId) !== i ? null : (
                  <button key={`${r.sourceId}:${r.id}`} className={`chip ${!pick && i === refIdx ? 'on' : ''}`} onClick={() => { setPick(undefined); setRefIdx(i); }}>
                    <i className="dot" style={{ background: SOURCE_COLORS[cfgOf(r.sourceId)?.kind ?? 'radio'] }} />
                    {cfgOf(r.sourceId)?.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>
      {error && <div className="errors">{error}</div>}
      {!tracks && !error ? <Spinner /> : tracks && <TrackList tracks={tracks} focus={focus} />}
    </div>
  );
}

/** The copies of `ref`'s album on its server with the same version: Navidrome's parts of one album. */
function splitParts(ref: Album, copies: Album[]): Album[] {
  const clean = versionOf(ref) === 'clean';
  const seen = new Set<string>();
  return [ref, ...copies].filter((r) => {
    const id = `${r.sourceId}:${r.id}`;
    if (seen.has(id) || r.sourceId !== ref.sourceId || (versionOf(r) === 'clean') !== clean) return false;
    seen.add(id);
    return true;
  });
}

/** Songs from several parts of one album, in disc and track order, each once. */
export function byPosition(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks
    .filter((t) => !seen.has(t.id) && !!seen.add(t.id))
    .sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 999) - (b.trackNumber ?? 999));
}

/**
 * Admins: delete an album from the server (hub/src/routes/trash.ts). Its files go to the Hub's trash and can be
 * put back under Settings → Server → Deleted albums for 30 days.
 */
function DeleteAlbumButton({ album }: { album: Album }) {
  const [busy, setBusy] = useState(false);
  const del = async () => {
    if (!confirm(`Delete ${album.title} by ${album.artist} from your server?\n\nIts files go to the Hub's trash. You can put it back under Settings → Server → Deleted albums for 30 days.`)) return;
    setBusy(true);
    try {
      const r = await deleteAlbum(album);
      alert(`Deleted ${r.label} (${r.files} song${r.files === 1 ? '' : 's'})${r.failed.length ? `. ${r.failed.length} couldn't be moved: ${r.failed[0]}` : ''}`);
      useUi.getState().back();
    } catch (e) {
      alert(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return <button className="btn ghost danger" disabled={busy} onClick={del}>{busy ? 'Deleting…' : 'Delete album'}</button>;
}
