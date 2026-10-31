import { useEffect, useState } from 'react';
import { getAllClean, getClean, offerCover, offerStatus, previewTracks, refreshCleanQueue, useCleanOffers, useCleanVersions, wanted, type CleanOffer } from '../lib/cleanVersions';
import { useMustRequest } from '../lib/inbox';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { Cover, Empty } from '../components/common';
import { DeemixActivity } from '../components/DeemixQueue';
import { IconDownload, IconPause, IconPlay } from '../components/Icons';
import { checkCleanVersions, useCleanCheck, type Suspect } from '../lib/cleanCopies';
import { deleteAlbums } from '../lib/deleteAlbums';
import { albumVersion, setFlag } from '../lib/kids';
import { useCan } from '../store/hub';
import { useSettings } from '../store/settings';

const STATUS_CLASS = { have: 'ready', done: 'ready', busy: 'approved', queued: 'approved', error: 'failed', new: '' } as const;

/**
 * Inbox → Clean versions: explicit albums in the library that Deezer has a clean version of (from the library
 * check), with a preview and a download button each, and "Download selected" for the ticked ones.
 */
export function CleanVersions() {
  const offers = useCleanOffers();
  const state = useCleanVersions();
  const request = useMustRequest();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState<string>();
  const [previewErr, setPreviewErr] = useState<Record<string, string>>({});
  const nowId = usePlayer((s) => s.queue[s.index]?.id);
  const playing = usePlayer((s) => s.playing);
  const nowAlbum = usePlayer((s) => s.queue[s.index]?.album);

  // follow deemix while something sent from here may still be downloading
  const sentAny = offers.some((o) => state.sent[o.link] && !o.have);
  useEffect(() => {
    if (request || !sentAny) return;
    refreshCleanQueue();
    const h = window.setInterval(refreshCleanQueue, 5000);
    return () => window.clearInterval(h);
  }, [request, sentAny]);

  if (!offers.length) {
    return (
      <>
      <CleanCheck />
      <Empty title="No clean versions found yet">
        Run the library check under <button className="link" onClick={() => useUi.getState().go({ view: 'settings', tab: 'users' })}>Settings → Users → Kid-safe music</button>.
        Explicit albums that Deezer also has a clean version of show up here.
      </Empty>
      </>
    );
  }

  const open = offers.filter((o) => wanted(o, state));
  const allPicked = open.length > 0 && open.every((o) => picked.has(o.link));
  const toggle = (o: CleanOffer, on: boolean) => setPicked((p) => {
    const n = new Set(p);
    if (on) n.add(o.link);
    else n.delete(o.link);
    return n;
  });
  const downloadAll = async (list: CleanOffer[]) => {
    setBusy(true);
    try {
      await getAllClean(list);
    } finally {
      setBusy(false);
      setPicked(new Set());
    }
  };
  const preview = async (o: CleanOffer) => {
    const on = previewing === o.link && nowId?.startsWith('preview:') && nowAlbum === `${o.album} (clean preview)`;
    if (on) return usePlayer.getState().toggle();
    try {
      const tracks = await previewTracks(o);
      if (!tracks.length) return setPreviewErr((e) => ({ ...e, [o.link]: 'No preview on Deezer' }));
      setPreviewing(o.link);
      usePlayer.getState().playTracks(tracks);
    } catch (e) {
      setPreviewErr((x) => ({ ...x, [o.link]: String((e as Error).message ?? e) }));
    }
  };
  const selected = open.filter((o) => picked.has(o.link));
  const verb = request ? 'Request' : 'Download';

  return (
    <>
      <CleanCheck />
      <p className="muted small">
        Explicit albums in your library that Deezer has a clean version of, from the library check. Preview one to hear
        it, then {request ? 'request' : 'download'} the ones you want. Albums already in your library, or already sent, are skipped.
      </p>
      <div className="row clean-bar">
        <label className="check">
          <input type="checkbox" checked={allPicked} disabled={!open.length || busy}
            onChange={(e) => setPicked(e.target.checked ? new Set(open.map((o) => o.link)) : new Set())} />
          Select all
        </label>
        <span className="muted small">{open.length} of {offers.length} still to get</span>
        {!request && <DeemixActivity />}
        <span className="grow" />
        <button className="btn" disabled={busy || !selected.length} onClick={() => downloadAll(selected)}>
          {verb} selected{selected.length ? ` (${selected.length})` : ''}
        </button>
        <button className="btn primary" disabled={busy || !open.length} onClick={() => downloadAll(open)}>
          {busy ? 'Sending…' : `${verb} all`}
        </button>
      </div>
      <div className="tracklist">
        {offers.map((o) => {
          const st = offerStatus(o, state);
          const canGet = st.kind === 'new' || st.kind === 'error';
          const on = previewing === o.link && nowId?.startsWith('preview:') && nowAlbum === `${o.album} (clean preview)`;
          return (
            <div key={o.link} className="station-row clean-row">
              <input type="checkbox" aria-label={`Select ${o.album}`} checked={picked.has(o.link)} disabled={!canGet || busy}
                onChange={(e) => toggle(o, e.target.checked)} />
              <Cover src={offerCover(o)} alt={o.album} className="tiny" />
              <div className="track-main">
                <div className="track-title"><a href={o.link} target="_blank" rel="noreferrer">{o.album}</a></div>
                <div className="track-sub">{o.artist} · clean version</div>
                {previewErr[o.link] && <div className="muted small">{previewErr[o.link]}</div>}
              </div>
              {st.label && <span className={`req-status ${STATUS_CLASS[st.kind]}`} title={st.kind === 'error' ? st.label : undefined}>{st.kind === 'error' ? 'Failed' : st.label}</span>}
              <div className="share-actions">
                <button className={`icon-btn preview-btn ${on ? 'on' : ''}`} title="Preview the clean version (30-second clips)" onClick={() => preview(o)}>
                  {on && playing ? <IconPause /> : <IconPlay />}
                </button>
                <button className="btn small" disabled={!canGet || busy || st.kind === 'busy'} title={canGet ? `${verb} the clean version` : st.label}
                  onClick={() => getClean(o).then(refreshCleanQueue)}>
                  <IconDownload /> {st.kind === 'error' ? 'Retry' : verb}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * Admins: check the clean versions on offer and the clean copies already downloaded (lib/cleanCopies.ts), and
 * delete or hide from kids the ones that aren't really clean.
 */
function CleanCheck() {
  const can = useCan('library.edit');
  const { running, step, suspects, error } = useCleanCheck();
  const sources = useSettings((s) => s.sources);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string>();
  const [done, setDone] = useState<Record<string, string>>({});
  if (!can) return null;
  const id = (x: Suspect) => `${x.album.sourceId}:${x.album.id}`;
  const open = (suspects ?? []).filter((x) => !done[id(x)]);
  const chosen = open.filter((x) => picked.has(id(x)));
  const onNavidrome = (x: Suspect) => sources.find((s) => s.id === x.album.sourceId)?.kind === 'navidrome';
  const toggle = (x: Suspect, on: boolean) => setPicked((p) => {
    const n = new Set(p);
    if (on) n.add(id(x));
    else n.delete(id(x));
    return n;
  });
  const remove = async () => {
    const list = chosen.filter(onNavidrome);
    if (!list.length) return;
    if (!confirm(`Delete ${list.length} clean cop${list.length === 1 ? 'y' : 'ies'} that may not be clean from your server?\n\nTheir files go to the Hub's trash; Settings → Server → Deleted albums can put them back for 30 days. The explicit albums stay.`)) return;
    setBusy('Deleting…');
    await deleteAlbums(list.map((x) => x.album), (a, r) => setDone((d) => ({ ...d, [`${a.sourceId}:${a.id}`]: 'error' in r ? r.error : 'Deleted' })));
    setBusy(undefined);
    setPicked(new Set());
  };
  const hide = async () => {
    setBusy('Hiding…');
    for (const x of chosen) {
      try {
        await setFlag('album', x.album.artist, x.album.title, albumVersion(x.album), 'block');
        setDone((d) => ({ ...d, [id(x)]: 'Hidden from kids' }));
      } catch (e) {
        setDone((d) => ({ ...d, [id(x)]: String((e as Error).message ?? e) }));
      }
    }
    setBusy(undefined);
    setPicked(new Set());
  };

  return (
    <section className="clean-check">
      <div className="row">
        <span className="muted small grow">
          Some clean versions found before Wavelength 0.17.2 weren’t really clean. Check them, and the clean copies you already downloaded.
        </span>
        <button className="btn small" disabled={running} onClick={() => void checkCleanVersions()}>{running ? 'Checking…' : 'Check clean versions'}</button>
      </div>
      {step && <p className="muted small">{step}</p>}
      {error && <div className="errors">{error}</div>}
      {suspects && !suspects.length && <p className="muted small">All your clean copies look clean.</p>}
      {suspects && suspects.length > 0 && (
        <>
          <div className="row clean-bar">
            <label className="check">
              <input type="checkbox" checked={open.length > 0 && chosen.length === open.length} disabled={!open.length || !!busy}
                onChange={(e) => setPicked(e.target.checked ? new Set(open.map(id)) : new Set())} />
              Select all
            </label>
            <span className="muted small">{suspects.length} clean cop{suspects.length === 1 ? 'y' : 'ies'} to look at</span>
            <span className="grow" />
            <button className="btn" disabled={!chosen.length || !!busy} onClick={() => void hide()}>Hide selected from kids</button>
            <button className="btn danger" disabled={!chosen.some(onNavidrome) || !!busy} onClick={() => void remove()}>{busy ?? `Delete selected${chosen.length ? ` (${chosen.length})` : ''}`}</button>
          </div>
          <div className="tracklist">
            {suspects.map((x) => (
              <div key={id(x)} className={`station-row clean-row ${done[id(x)] === 'Deleted' ? 'off' : ''}`}>
                <input type="checkbox" aria-label={`Select ${x.album.title}`} checked={picked.has(id(x))} disabled={!!done[id(x)] || !!busy}
                  onChange={(e) => toggle(x, e.target.checked)} />
                <Cover src={x.album.coverUrl} alt={x.album.title} className="tiny" />
                <div className="track-main">
                  <button className="link track-title" onClick={() => useUi.getState().go({ view: 'album', album: { ...x.album, refs: [x.album] } })}>{x.album.title}</button>
                  <div className="track-sub">{x.album.artist} · {x.reasons.join(' · ')}</div>
                </div>
                {done[id(x)] && <span className="muted small">{done[id(x)]}</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
