import { useEffect, useState } from 'react';
import { engine } from '../player/engine';
import { useFeature } from '../lib/features';
import type { Track } from '../sources/types';
import { hubClient } from '../store/hub';
import { usePlayer } from '../store/player';

type Found = { id: string; title: string } | null;
const found = new Map<string, Found>();

/**
 * Now Playing: the song's official video (hub/src/videos.ts), in a YouTube embed that doesn't set cookies. The
 * music pauses while it plays and carries on from the same spot when it's closed.
 */
export function VideoButton({ track }: { track: Track }) {
  const on = useFeature('musicVideos');
  const key = `${track.artist}|${track.title}`;
  const [video, setVideo] = useState<Found | undefined>(found.get(key));
  const [open, setOpen] = useState(false);
  const [resume, setResume] = useState(false);
  useEffect(() => {
    setVideo(found.get(key));
    const c = hubClient();
    if (!on || !c || track.kind !== 'track' || found.has(key)) return;
    let alive = true;
    c.video(track.artist, track.title, track.duration)
      .then((r) => r.video && { id: r.video.id, title: r.video.title }, () => null)
      .then((v) => {
        found.set(key, v);
        if (alive) setVideo(v);
      });
    return () => {
      alive = false;
    };
  }, [key, on]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!on || !video) return null;

  const watch = () => {
    const playing = usePlayer.getState().playing;
    if (playing) engine.pause();
    setResume(playing);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    const p = usePlayer.getState();
    if (resume && !p.playing) p.toggle();
  };
  return (
    <>
      <button className="chip" title={video.title} onClick={watch}>Video</button>
      {open && <VideoDialog id={video.id} title={video.title} onClose={close} />}
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
          <button className="btn small" onClick={onClose}>Back to the music</button>
        </div>
      </div>
    </div>
  );
}
