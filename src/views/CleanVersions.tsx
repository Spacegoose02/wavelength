import { useEffect, useState } from 'react';
import { getAllClean, getClean, offerCover, offerStatus, previewTracks, refreshCleanQueue, useCleanOffers, useCleanVersions, wanted, type CleanOffer } from '../lib/cleanVersions';
import { useMustRequest } from '../lib/inbox';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { Cover, Empty } from '../components/common';
import { IconDownload, IconPause, IconPlay } from '../components/Icons';

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
      <Empty title="No clean versions found yet">
        Run the library check under <button className="link" onClick={() => useUi.getState().go({ view: 'settings', tab: 'users' })}>Settings → Users → Kid-safe music</button>.
        Explicit albums that Deezer also has a clean version of show up here.
      </Empty>
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
