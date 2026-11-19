import { useEffect, useState } from 'react';
import { useArtistMatch } from '../lib/artistMatches';
import { follow, followed, loadRadar, unfollow, useFollows } from '../lib/follows';
import { useHub } from '../store/hub';
import { IconPlus } from './Icons';

/**
 * Follow / Following for Release Radar (lib/follows.ts). With a Deezer `id` it follows that artist; with
 * only a `name` (a library artist) the Hub finds them on Deezer, unless an admin matched them by hand (Edit artist →
 * Match): then it's that Deezer artist, and there's no button for one matched to none. Hidden without a Hub that has
 * Release Radar.
 */
export function FollowButton({ id: given, name, picture, className = 'btn' }: { id?: number; name: string; picture?: string | null; className?: string }) {
  const matched = useArtistMatch(name).match?.deezer;
  const id = given ?? (typeof matched === 'number' ? matched : undefined);
  const signedIn = useHub((s) => !!s.token);
  const supported = useFollows((s) => s.supported);
  const mine = useFollows((s) => followed(s.follows, { id, name }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (signedIn && supported === undefined) void loadRadar();
  }, [signedIn, supported]);

  if (!signedIn || !supported || !name || (given === undefined && matched === 'none') || /^(various artists|unknown artist)$/i.test(name.trim())) return null;

  const toggle = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (mine) await unfollow(mine.id);
      else await follow({ id, name, picture });
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className={`${className} ${mine ? 'following' : ''}`} disabled={busy} onClick={(e) => { e.stopPropagation(); void toggle(); }}
      title={error ?? (mine ? `Stop following ${mine.name}` : `Follow ${name}: their new releases show up in your Release Radar`)}>
      {mine ? '✓ Following' : error ? 'Couldn’t follow, try again' : <><IconPlus /> Follow</>}
    </button>
  );
}
