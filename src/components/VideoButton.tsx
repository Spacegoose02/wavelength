import { useEffect, useState } from 'react';
import { engine } from '../player/engine';
import { useFeature } from '../lib/features';
import type { Track } from '../sources/types';
import { hubClient, useHub } from '../store/hub';
import { usePlayer } from '../store/player';

type Found = { id: string; title: string } | null;
const found = new Map<string, Found>();

const keyOf = (t: Track) => (t.kind === 'episode' ? `episode|${t.album ?? ''}|${t.title}` : `${t.artist}|${t.title}`);

/**
 * The video for a song (its official video) or a podcast episode (the show's own upload), asked of the Hub once
 * and remembered. null when there isn't one, or no Hub to ask.
 */
export async function findVideo(t: Track): Promise<Found> {
  const key = keyOf(t);
  if (found.has(key)) return found.get(key)!;
  const c = hubClient();
  if (!c || (t.kind !== 'track' && t.kind !== 'episode')) return null;
  const ask = t.kind === 'episode' ? c.episodeVideo(t.album ?? t.artist, t.title, t.duration) : c.video(t.artist, t.title, t.duration);
  const v = await ask.then((r) => r.video && { id: r.video.id, title: r.video.title }, () => null);
  found.set(key, v);
  return v;
}

/** Pause the audio while a video plays, and carry on from the same spot when it's closed. */
function useVideoDialog() {
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null);
  const [resume, setResume] = useState(false);
  const watch = (v: { id: string; title: string }) => {
    const playing = usePlayer.getState().playing;
    if (playing) engine.pause();
    setResume(playing);
    setOpen(v);
  };
  const close = () => {
    setOpen(null);
    const p = usePlayer.getState();
    if (resume && !p.playing) p.toggle();
  };
  const dialog = open ? <VideoDialog id={open.id} title={open.title} onClose={close} /> : null;
  return { watch, dialog };
}

/**
 * Now Playing: the song's official video or the episode's video (hub/src/videos.ts), in a YouTube embed that
 * doesn't set cookies. The audio pauses while it plays and carries on from the same spot when it's closed.
 */
export function VideoButton({ track }: { track: Track }) {
  const on = useFeature('musicVideos');
  const key = keyOf(track);
  const [video, setVideo] = useState<Found | undefined>(found.get(key));
  const { watch, dialog } = useVideoDialog();
  useEffect(() => {
    setVideo(found.get(key));
    if (!on || found.has(key)) return;
    let alive = true;
    findVideo(track).then((v) => alive && setVideo(v));
    return () => {
      alive = false;
    };
  }, [key, on]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!on || !video) return null;
  return (
    <>
      <button className="chip" title={video.title} onClick={() => watch(video)}>Video</button>
      {dialog}
    </>
  );
}

/**
 * A podcast episode's row: "Video" looks for the episode on YouTube when pressed (one search per press, not one
 * per row), then plays it, or says there isn't one.
 */
export function EpisodeVideoChip({ track }: { track: Track }) {
  const on = useFeature('musicVideos');
  const hasHub = useHub((s) => !!s.token);
  const [state, setState] = useState<'idle' | 'looking' | 'none'>(() => (found.get(keyOf(track)) === null ? 'none' : 'idle'));
  const { watch, dialog } = useVideoDialog();
  if (!on || !hasHub || track.kind !== 'episode') return null;
  return (
    <>
      <button className="chip" disabled={state !== 'idle'} title={state === 'none' ? 'No video of this episode on YouTube' : 'Watch this episode on YouTube, if the show posted it'}
        onClick={async (e) => {
          e.stopPropagation();
          setState('looking');
          const v = await findVideo(track);
          if (v) {
            setState('idle');
            watch(v);
          } else setState('none');
        }}>
        {state === 'looking' ? 'Looking…' : state === 'none' ? 'No video' : 'Video'}
      </button>
      {dialog}
    </>
  );
}

function VideoDialog({ id, title, onClose }: { id: string; title: string; onClose(): void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="pin-backdrop" onClick={onClose}>
      <div className="video-dialog" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
        <div className="row gap">
          <span className="muted small grow">{title}</span>
          <button className="btn small" onClick={onClose}>Back to listening</button>
        </div>
      </div>
    </div>
  );
}
