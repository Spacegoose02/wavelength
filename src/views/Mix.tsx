import { useEffect, useState } from 'react';
import { Cover, Empty, Spinner, TrackList } from '../components/common';
import { IconDownload, IconPlay, IconShuffle } from '../components/Icons';
import { deemixClient } from '../lib/hubServices';
import { mustRequest, requestMusic, useMustRequest } from '../lib/inbox';
import { loadMixes, mixCovers, mixRows, mixTracks, useMixes, type MixRow } from '../lib/mixes';
import { useFeature } from '../lib/features';
import { useSettings } from '../store/settings';
import type { HubMix } from '../sources/hub';
import { hubClient } from '../store/hub';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';

const errText = (e: unknown) => String((e as Error)?.message ?? e);

/** A mix's picture: a mosaic of its first four covers. */
export function MixArt({ mix, className }: { mix: HubMix; className?: string }) {
  const covers = mixCovers(mix);
  if (covers.length === 4) {
    return (
      <div className={`cover mosaic mix-art ${className ?? ''}`} data-kind={mix.kind}>
        {covers.map((c) => <img key={c} src={c} alt="" loading="lazy" />)}
        <span className="mix-label">{mix.name.replace(/^Blend: /, 'Blend')}</span>
      </div>
    );
  }
  return (
    <div className={`mix-art-wrap ${className ?? ''}`} data-kind={mix.kind}>
      <Cover src={covers[0]} alt={mix.name} className={className} />
      <span className="mix-label">{mix.name}</span>
    </div>
  );
}

/**
 * Songs of Discover Weekly the library doesn't have: 30-second Deezer clips, each with Get (deemix) or Request,
 * like the Weekly Mix in Release Radar.
 */
function ClipRows({ rows, onPlay }: { rows: MixRow[]; onPlay: (r: MixRow) => void }) {
  const [status, setStatus] = useState<Record<string, string>>({});
  const deemix = useSettings((s) => s.deemix);
  const ask = useMustRequest();
  const get = async (r: MixRow) => {
    const k = r.track.id;
    if (!r.link) return;
    setStatus((s) => ({ ...s, [k]: '…' }));
    try {
      if (mustRequest()) {
        await requestMusic({ link: r.link, kind: 'track', title: r.song.title, artist: r.song.artist, cover: r.song.coverUrl });
        setStatus((s) => ({ ...s, [k]: 'Requested' }));
      } else {
        await deemixClient().addToQueue(r.link, deemix.bitrate);
        setStatus((s) => ({ ...s, [k]: 'Queued' }));
      }
    } catch (e) {
      setStatus((s) => ({ ...s, [k]: errText(e) }));
    }
  };
  return (
    <ol className="mix-list">
      {rows.map((r) => {
        const st = status[r.track.id];
        return (
          <li key={r.track.id} className="mix-row">
            <button className="icon-btn" title="Play preview" onClick={() => onPlay(r)}><IconPlay /></button>
            <Cover src={r.song.coverUrl} alt={r.song.album ?? r.song.title} />
            <div className="mix-text">
              <div className="ellipsis" title={r.song.title}>{r.song.title}</div>
              <div className="muted small ellipsis">{r.song.artist}{r.song.because && <> · {r.song.because}</>}</div>
            </div>
            <button className="btn small" disabled={!r.link || (!deemix.url && !ask) || st === '…' || st === 'Queued' || st === 'Requested'} title={st} onClick={() => get(r)}>
              <IconDownload /> {st && st.length < 12 ? st : ask ? 'Request' : 'Get'}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One mix: its songs found in this library, to play, shuffle or save. Discover Weekly is songs new to you, so
 * the library rarely has many: it also lists the rest as Deezer clips to play and Get (lib/mixes.ts mixRows).
 */
function MixPage({ mix }: { mix: HubMix }) {
  const playTracks = usePlayer((s) => s.playTracks);
  const [rows, setRows] = useState<MixRow[] | null>(null);
  const [looked, setLooked] = useState(0);
  const [note, setNote] = useState('');
  useEffect(() => {
    let alive = true;
    setRows(null);
    setLooked(0);
    setNote('');
    const got = mix.kind === 'discover'
      ? mixRows(mix, 50, (n) => alive && setLooked(n))
      : mixTracks(mix, 50, (n) => alive && setLooked(n)).then((ts) => ts.map((track): MixRow => ({ song: { title: track.title, artist: track.artist ?? '' }, track, owned: true })));
    got.then((r) => alive && setRows(r)).catch((e) => alive && setNote(errText(e)));
    return () => {
      alive = false;
    };
  }, [mix]);
  const owned = rows?.filter((r) => r.owned).map((r) => r.track) ?? [];
  const clips = rows?.filter((r) => !r.owned) ?? [];
  // what Play plays: the library's songs, then the clips, as the page lists them
  const tracks = [...owned, ...clips.map((r) => r.track)];
  const save = () => {
    if (!owned.length) return;
    const id = useLibrary.getState().createPlaylist(`${mix.name} (${new Date().toLocaleDateString()})`, owned);
    useUi.getState().go({ view: 'playlist', id });
  };
  return (
    <div className="page">
      <header className="hero">
        <MixArt mix={mix} className="hero-art" />
        <div>
          <div className="kicker">{mix.kind === 'blend' ? 'Blend' : 'Made for you'}</div>
          <h1>{mix.name}</h1>
          <div className="muted">{mix.description}</div>
          <div className="hero-actions">
            <button className="btn primary" disabled={!tracks.length} onClick={() => playTracks(tracks)}><IconPlay /> Play</button>
            <button className="btn" disabled={!tracks.length} onClick={() => {
              if (!usePlayer.getState().shuffle) usePlayer.getState().toggleShuffle();
              playTracks(tracks, Math.floor(Math.random() * tracks.length));
            }}><IconShuffle /> Shuffle</button>
            <button className="btn ghost" disabled={!owned.length} title={clips.length ? 'Saves the songs in your library' : undefined} onClick={save}>Save as playlist</button>
          </div>
        </div>
      </header>
      {note && <div className="errors">{note}</div>}
      {!rows ? (
        <p className="muted"><Spinner /> Finding the songs in your library… {looked}/{mix.songs.length}</p>
      ) : !rows.length ? (
        <Empty title="None of these are in your library yet">Play more music and the mixes get better every day.</Empty>
      ) : (
        <>
          {owned.length > 0 && <TrackList tracks={owned} showAlbum showCover />}
          {clips.length > 0 && (
            <section className="mix-clips">
              <h2>Not in your library yet</h2>
              <p className="muted small">30-second previews. Get one to add the full song to your library.</p>
              <ClipRows rows={clips} onPlay={(r) => playTracks(tracks, tracks.indexOf(r.track))} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

export function MixView({ id }: { id: string }) {
  const mix = useMixes((s) => s.mixes.find((m) => m.id === id));
  const on = useFeature('homeMixes');
  useEffect(() => {
    if (!mix) loadMixes().catch(() => undefined);
  }, [mix]);
  if (!on) return <Empty title="Mixes are off">A Hub admin turned Made for you mixes off.</Empty>;
  if (!mix) return <div className="page"><Spinner /></div>;
  return <MixPage mix={mix} />;
}

/** Blend: pick people who said yes, get a mix of what you all play. */
export function BlendView() {
  const on = useFeature('blend');
  const [data, setData] = useState<{ optedIn: boolean; people: { id: number; displayName: string; optedIn: boolean }[] }>();
  const [pick, setPick] = useState<number[]>([]);
  const [mix, setMix] = useState<HubMix>();
  const [err, setErr] = useState('');
  const c = hubClient();
  const load = () => c?.blendPeople().then(setData).catch((e) => setErr(errText(e)));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!on || !c) return <Empty title="Blend is off">Sign in to a Wavelength Hub, and ask an admin to turn Blend on.</Empty>;
  if (mix) return (
    <>
      <div className="page-top-actions"><button className="btn ghost" onClick={() => setMix(undefined)}>← Pick other people</button></div>
      <MixPage mix={mix} />
    </>
  );
  const toggleMe = async (v: boolean) => {
    try {
      await c.setBlendOptIn(v);
      load();
    } catch (e) {
      setErr(errText(e));
    }
  };
  const ready = data?.people.filter((p) => p.optedIn) ?? [];
  return (
    <div className="page narrow">
      <header className="page-head"><h1>Blend</h1></header>
      <p className="muted">A mix of what you and the people you pick listen to: songs by artists you share first, then each person’s favorites in turn. Everyone in a Blend has to turn Blends on, since it shows a little of what they play.</p>
      {err && <div className="errors">{err}</div>}
      {!data ? <Spinner /> : (
        <>
          <label className="check">
            <span className="switch"><input type="checkbox" checked={data.optedIn} onChange={(e) => toggleMe(e.target.checked)} /><span /></span>
            <span>Let people in the house make Blends with me</span>
          </label>
          {data.optedIn && (
            <>
              <h2>Blend with</h2>
              {!data.people.length && <p className="muted">There’s nobody to blend with yet.</p>}
              <div className="chips">
                {data.people.map((p) => (
                  <button key={p.id} className={`chip ${pick.includes(p.id) ? 'on' : ''}`} disabled={!p.optedIn} title={p.optedIn ? '' : `${p.displayName} hasn’t turned Blends on`}
                    onClick={() => setPick((x) => (x.includes(p.id) ? x.filter((i) => i !== p.id) : [...x, p.id]))}>
                    {p.displayName}{!p.optedIn && ' (not on yet)'}
                  </button>
                ))}
              </div>
              {!ready.length && data.people.length > 0 && <p className="muted small">Nobody else has turned Blends on yet. Ask them to open Home → Blend.</p>}
              <button className="btn primary" disabled={!pick.length} onClick={async () => {
                try {
                  setMix((await c.blend(pick)).mix);
                } catch (e) {
                  setErr(errText(e));
                }
              }}>Make the Blend</button>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Home's "Made for you" shelf. */
export function MadeForYou() {
  const on = useFeature('homeMixes');
  const blendOn = useFeature('blend');
  const signedIn = !!hubClient();
  const mixes = useMixes((s) => s.mixes);
  const go = useUi((s) => s.go);
  useEffect(() => {
    if (on && signedIn) loadMixes().catch(() => undefined);
  }, [on, signedIn]);
  if (!signedIn || (!on && !blendOn)) return null;
  if (on && !mixes.length && !blendOn) return null;
  return (
    <section>
      <h2>Made for you</h2>
      {on && !mixes.length && <p className="muted small">Your mixes appear here once you’ve played some music. They’re made fresh every day.</p>}
      <div className="row-scroll">
        {mixes.map((m) => (
          <button key={m.id} className="card" onClick={() => go({ view: 'mix', id: m.id })}>
            <MixArt mix={m} />
            <div className="card-title">{m.name}</div>
            <div className="card-sub"><span>{m.description}</span></div>
          </button>
        ))}
        {blendOn && (
          <button className="card" onClick={() => go({ view: 'blend' })}>
            <div className="cover mix-art blend-art"><span className="mix-label">Blend</span></div>
            <div className="card-title">Blend</div>
            <div className="card-sub"><span>Mix your taste with someone in the house</span></div>
          </button>
        )}
      </div>
    </section>
  );
}
