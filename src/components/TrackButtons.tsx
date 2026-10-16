import { useState } from 'react';
import { sourceFor } from '../sources/registry';
import type { SubWaveSource } from '../sources/subwave';
import type { Track } from '../sources/types';
import { useSettings } from '../store/settings';
import { IconHeart } from './Icons';

/** Heart = Navidrome star (SubWave mirrors its likes into these too). */
export function FavButton({ track }: { track: Track }) {
  const cfg = useSettings((s) => s.sources.find((x) => x.id === track.sourceId));
  const [on, setOn] = useState(!!track.starred);
  const [busy, setBusy] = useState(false);
  const src = cfg ? sourceFor(cfg) : undefined;
  if (!src?.setFavorite || track.kind !== 'track') return null;
  return (
    <button className={`icon-btn fav ${on ? 'on' : ''}`} title={on ? 'Remove from favorites' : 'Add to favorites'} disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        setOn(!on);
        try {
          await src.setFavorite!(track, !on);
          track.starred = !on;
        } catch {
          setOn(on);
        } finally {
          setBusy(false);
        }
      }}>
      <IconHeart />
    </button>
  );
}

/** SubWave sources we can push to (admin creds set). */
export function useSubwaveAdmins() {
  const sources = useSettings((s) => s.sources);
  return sources.filter((s) => s.kind === 'subwave' && s.enabled && s.username && s.password);
}

/**
 * Queue a whole list (album, playlist, chart…) onto SUB/WAVE in order. Navidrome tracks go
 * straight in; anything else is matched onto the Navidrome library SubWave plays from.
 */
export function QueueAllOnSubwave({ tracks, albumBlock, className = 'btn' }: { tracks: Track[] | (() => Track[]); albumBlock?: boolean; className?: string }) {
  const stations = useSubwaveAdmins();
  const sources = useSettings((s) => s.sources);
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (!stations.length) return null;

  const run = async (stationId: string) => {
    const cfg = stations.find((s) => s.id === stationId)!;
    const sw = sourceFor(cfg) as SubWaveSource;
    const list = (typeof tracks === 'function' ? tracks() : tracks).filter((t) => t.kind === 'track');
    const nav = sources.find((s) => s.kind === 'navidrome' && s.enabled);
    if (!list.length) return;
    setBusy(true);
    try {
      // a whole Navidrome album: one block request keeps it together on air
      if (albumBlock && sources.find((s) => s.id === list[0].sourceId)?.kind === 'navidrome') {
        const r = await sw.queueBlock('album', list[0].id);
        setMsg(`Queued album${Array.isArray(r?.queued) ? ` (${r.queued.length})` : ''}`);
        return;
      }
      const { findTrackOnSource } = await import('../lib/match');
      let ok = 0;
      let missing = 0;
      for (const [i, t] of list.entries()) {
        setMsg(`Queueing ${i + 1}/${list.length}…`);
        let id = sources.find((s) => s.id === t.sourceId)?.kind === 'navidrome' ? t.id : undefined;
        if (!id && nav) id = (await findTrackOnSource(sourceFor(nav), t).catch(() => undefined))?.id;
        if (!id) {
          missing++;
          continue;
        }
        await sw.queueTrack({ id, title: t.title, artist: t.artist, album: t.album });
        ok++;
      }
      setMsg(`Queued ${ok}${missing ? `, ${missing} not in the station's library` : ''}`);
    } catch (e) {
      setMsg(`Failed: ${(e as Error).message ?? e}`);
    } finally {
      setBusy(false);
      window.setTimeout(() => setMsg(undefined), 5000);
    }
  };

  return (
    <>
      {stations.map((cfg) => (
        <button key={cfg.id} className={`${className} wave`} disabled={busy} onClick={(e) => { e.stopPropagation(); run(cfg.id); }}
          title={`Add these to ${cfg.name}'s queue`}>
          {msg ?? `→ Queue on ${cfg.name}`}
        </button>
      ))}
    </>
  );
}

/**
 * Queue a Navidrome track onto SUB/WAVE's air. SubWave plays from the same Navidrome
 * library, so the Subsonic id is all it needs.
 */
export function QueueOnSubwave({ track }: { track: Track }) {
  const stations = useSubwaveAdmins();
  const kind = useSettings((s) => s.sources.find((x) => x.id === track.sourceId)?.kind);
  const [msg, setMsg] = useState<string>();
  if (!stations.length || kind !== 'navidrome' || track.kind !== 'track') return null;
  return (
    <>
      {stations.map((cfg) => (
        <button key={cfg.id} className="chip wave" title={`Play this on ${cfg.name} next`}
          onClick={async (e) => {
            e.stopPropagation();
            setMsg('…');
            try {
              const r = await (sourceFor(cfg) as SubWaveSource).queueTrack({ id: track.id, title: track.title, artist: track.artist, album: track.album });
              setMsg(r?.queuePosition != null ? `#${r.queuePosition}` : 'Queued');
            } catch (err) {
              setMsg('Failed');
              console.warn(err);
            }
            window.setTimeout(() => setMsg(undefined), 2500);
          }}>
          {msg ?? `→ ${cfg.name}`}
        </button>
      ))}
    </>
  );
}
