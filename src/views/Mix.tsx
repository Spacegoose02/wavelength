import { useEffect, useState } from 'react';
import { Cover, Empty, Spinner, TrackList } from '../components/common';
import { IconPlay, IconShuffle } from '../components/Icons';
import { loadMixes, mixCovers, mixTracks, useMixes } from '../lib/mixes';
import { useFeature } from '../lib/features';
import type { HubMix } from '../sources/hub';
import type { Track } from '../sources/types';
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

/** One mix: its songs found in this library, to play, shuffle or save. */
function MixPage({ mix }: { mix: HubMix }) {
  const playTracks = usePlayer((s) => s.playTracks);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [looked, setLooked] = useState(0);
  const [note, setNote] = useState('');
  useEffect(() => {
    setTracks(null);
    setLooked(0);
    mixTracks(mix, 50, setLooked).then(setTracks).catch((e) => setNote(errText(e)));
  }, [mix]);
  const save = () => {
    if (!tracks?.length) return;
    const id = useLibrary.getState().createPlaylist(`${mix.name} (${new Date().toLocaleDateString()})`, tracks);
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
            <button className="btn primary" disabled={!tracks?.length} onClick={() => tracks && playTracks(tracks)}><IconPlay /> Play</button>
            <button className="btn" disabled={!tracks?.length} onClick={() => {
              if (!tracks) return;
              if (!usePlayer.getState().shuffle) usePlayer.getState().toggleShuffle();
              playTracks(tracks, Math.floor(Math.random() * tracks.length));
            }}><IconShuffle /> Shuffle</button>
            <button className="btn ghost" disabled={!tracks?.length} onClick={save}>Save as playlist</button>
          </div>
        </div>
      </header>
      {note && <div className="errors">{note}</div>}
      {!tracks ? (
        <p className="muted"><Spinner /> Finding the songs in your library… {looked}/{mix.songs.length}</p>
      ) : !tracks.length ? (
        <Empty title="None of these are in your library yet">Play more music and the mixes get better every day.</Empty>
      ) : (
        <TrackList tracks={tracks} showAlbum showCover />
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
      <p className="muted">A mix of what you and the people you pick listen to: songs by artists you share first, then each person’s favourites in turn. Everyone in a Blend has to turn Blends on, since it shows a little of what they play.</p>
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
