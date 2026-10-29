import { useEffect, useState } from 'react';
import { fromHub } from '../lib/librarySync';
import { rewindCard, rewindTitle, shareImage } from '../lib/rewindCard';
import type { HubRewind } from '../sources/hub';
import type { Track } from '../sources/types';
import { hubClient, useHub } from '../store/hub';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { Cover, Empty, Spinner } from '../components/common';
import { IconPlay } from '../components/Icons';

/**
 * Wavelength Rewind: your year or month of listening, from the plays your devices send the Hub
 * (hub/src/rewind.ts). Music only; minutes come from each song's length.
 */

type Period = { year: number; month?: number };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2000, i, 15)).toLocaleString(undefined, { month: 'short', timeZone: 'UTC' }));
const n = (x: number) => x.toLocaleString();
const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

function Bars({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="rewind-bars" role="img" aria-label={values.map((v, i) => `${labels[i]}: ${v}`).join(', ')}>
      {values.map((v, i) => (
        <div key={i} title={`${labels[i]}: ${v} play${v === 1 ? '' : 's'}`}>
          <span style={{ height: `${(v / max) * 100}%` }} />
          <small>{labels[i]}</small>
        </div>
      ))}
    </div>
  );
}

export function Rewind() {
  const c = hubClient();
  const who = useHub((s) => s.user?.displayName ?? '');
  const [periods, setPeriods] = useState<{ year: number; month: number; plays: number }[]>();
  const [pick, setPick] = useState<Period>({ year: new Date().getFullYear() });
  const [r, setR] = useState<HubRewind>();
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    c?.rewindPeriods().then((p) => setPeriods(p.periods), (e) => setErr(String((e as Error).message ?? e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!c) return;
    let alive = true;
    setR(undefined);
    c.rewind(pick.year, pick.month).then((x) => alive && setR(x), (e) => alive && setErr(String((e as Error).message ?? e)));
    return () => {
      alive = false;
    };
  }, [pick.year, pick.month]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!c) {
    return (
      <div className="page">
        <header className="page-head"><h1>Rewind</h1></header>
        <Empty title="Rewind needs a Wavelength Hub">Sign in to a Hub under Settings → Account. It keeps your plays from every device, so your year adds up.</Empty>
      </div>
    );
  }

  const years = [...new Set([new Date().getFullYear(), ...(periods ?? []).map((p) => p.year)])].sort((a, b) => b - a);
  const months = (periods ?? []).filter((p) => p.year === pick.year).map((p) => p.month).sort((a, b) => a - b);
  const play = (tracks: Track[], i = 0) => usePlayer.getState().playTracks(tracks.map(fromHub), i);
  const title = r ? rewindTitle(r) : '';

  const share = async () => {
    if (!r) return;
    setMsg('Drawing…');
    try {
      const how = await shareImage(await rewindCard(r, who || 'My'), `Wavelength Rewind ${title}.png`);
      setMsg(how === 'saved' ? 'Saved the picture' : how === 'shared' ? 'Shared' : '');
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    }
  };

  return (
    <div className="page rewind">
      <header className="page-head">
        <h1>Rewind <small>{title}</small></h1>
      </header>
      <div className="chips">
        {years.map((y) => <button key={y} className={`chip ${pick.year === y && !pick.month ? 'on' : ''}`} onClick={() => setPick({ year: y })}>{y}</button>)}
        {months.length > 0 && <span className="muted small" style={{ alignSelf: 'center' }}>·</span>}
        {months.map((m) => <button key={m} className={`chip ${pick.month === m ? 'on' : ''}`} onClick={() => setPick({ year: pick.year, month: m })}>{MONTHS[m - 1]}</button>)}
      </div>
      {err && <div className="errors">{err}</div>}
      {!r ? <Spinner /> : !r.plays ? (
        <Empty title={`Nothing played in ${title} yet`}>Songs count once you've heard half of them, on any device signed in to your Hub.</Empty>
      ) : (
        <>
          <section className="rewind-hero">
            <div><b>{n(r.minutes)}</b><span>minutes</span></div>
            <div><b>{n(r.plays)}</b><span>plays</span></div>
            <div><b>{n(r.songs)}</b><span>songs</span></div>
            <div><b>{n(r.artists)}</b><span>artists</span></div>
            <div><b>{n(r.daysListened)}</b><span>days listened</span></div>
          </section>
          <div className="row gap wrap">
            <button className="btn primary" onClick={() => play(r.playlist)}><IconPlay /> Play your top songs</button>
            <button className="btn" onClick={() => {
              const id = useLibrary.getState().createPlaylist(`Rewind ${title}`, r.playlist.map(fromHub));
              useUi.getState().go({ view: 'playlist', id });
            }}>Save as playlist</button>
            <button className="btn" onClick={share}>Share as a picture</button>
            {msg && <span className="small">{msg}</span>}
          </div>

          <div className="rewind-cols">
            <section>
              <h2>Top artists</h2>
              {r.topArtists.map((a, i) => (
                <div key={a.artist} className="source-row">
                  <span className="rewind-rank">{i + 1}</span>
                  <Cover src={fromHub(a.track).coverUrl} alt={a.artist} round className="tiny" />
                  <div className="track-main">
                    <div className="track-title">{a.artist}</div>
                    <div className="track-sub">{n(a.plays)} plays · {n(a.minutes)} min</div>
                  </div>
                </div>
              ))}
            </section>
            <section>
              <h2>Top songs</h2>
              {r.topSongs.map((s, i) => (
                <div key={`${s.title}|${s.artist}`} className="source-row clickable" onClick={() => play(r.topSongs.map((x) => x.track), i)}>
                  <span className="rewind-rank">{i + 1}</span>
                  <Cover src={fromHub(s.track).coverUrl} alt={s.title} className="tiny" />
                  <div className="track-main">
                    <div className="track-title">{s.title}</div>
                    <div className="track-sub">{s.artist} · {n(s.plays)} plays</div>
                  </div>
                </div>
              ))}
            </section>
          </div>

          {r.topAlbums.length > 0 && (
            <section>
              <h2>Top albums</h2>
              <div className="row-scroll">
                {r.topAlbums.map((a) => (
                  <div key={`${a.album}|${a.artist}`} className="card">
                    <Cover src={fromHub(a.track).coverUrl} alt={a.album} />
                    <div className="card-title">{a.album}</div>
                    <div className="card-sub">{a.artist} · {n(a.plays)} plays</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="server-grid rewind-facts">
            {r.favourite && (
              <div><span className="muted">Your song</span><b>{r.favourite.title}</b>
                <span className="small">{r.favourite.artist} · {n(r.favourite.plays)} plays{r.favourite.firstPlayedAt ? ` · first played ${new Date(r.favourite.firstPlayedAt).toLocaleDateString()}` : ''}</span></div>
            )}
            {r.busiestDay && <div><span className="muted">Busiest day</span><b>{new Date(`${r.busiestDay.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</b><span className="small">{n(r.busiestDay.plays)} plays</span></div>}
            <div><span className="muted">Longest streak</span><b>{r.streak} day{r.streak === 1 ? '' : 's'} in a row</b></div>
            <div><span className="muted">New artists</span><b>{n(r.newArtists.count)}</b>{r.newArtists.top.length > 0 && <span className="small">{r.newArtists.top.map((a) => a.artist).join(', ')}</span>}</div>
            <div><span className="muted">Favourite time</span><b>{hourLabel(r.byHour.indexOf(Math.max(...r.byHour)))}</b><span className="small">on {DAYS[r.byWeekday.indexOf(Math.max(...r.byWeekday))]}s most</span></div>
          </section>

          {r.byMonth && (
            <section>
              <h2>Month by month</h2>
              <Bars values={r.byMonth} labels={MONTHS} />
            </section>
          )}
          <section>
            <h2>Time of day</h2>
            <Bars values={r.byHour} labels={r.byHour.map((_, h) => (h % 3 ? '' : hourLabel(h)))} />
          </section>
        </>
      )}
    </div>
  );
}
