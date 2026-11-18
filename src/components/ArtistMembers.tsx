import { type MemberEntry, useArtistMembers } from '../lib/artistMembers';
import { useUi } from '../store/ui';
import { ArtistCard, Cover, Grid } from './common';

const MAX = 24;

/**
 * Artist page, under the music: a group's Members (Hot Boy$: Lil Wayne, Turk, Juvenile, B.G.) and the groups an
 * artist is in (Member of), as artist cards. Set in Edit artist → General → Members; a group nobody set shows
 * MusicBrainz's (lib/artistMembers.ts). Someone not in the library gets a card that searches for them.
 */
export function ArtistMembers({ name }: { name: string }) {
  const { members, membersFrom, memberOf } = useArtistMembers(name);
  return (
    <>
      {members.length > 0 && (
        <section className="artist-members">
          <h2>Members {membersFrom === 'musicbrainz' && <small className="muted">from MusicBrainz</small>}</h2>
          <MemberGrid list={members} />
        </section>
      )}
      {memberOf.length > 0 && (
        <section className="artist-members">
          <h2>Member of</h2>
          <MemberGrid list={memberOf} />
        </section>
      )}
    </>
  );
}

function MemberGrid({ list }: { list: MemberEntry[] }) {
  const go = useUi((s) => s.go);
  // people in the library first, keeping each group's order
  const shown = [...list.filter((m) => m.artist), ...list.filter((m) => !m.artist)].slice(0, MAX);
  return (
    <Grid>
      {shown.map((m) => m.artist ? (
        <ArtistCard key={m.name} artist={m.artist} onOpen={(a) => go({ view: 'artist', artist: a })} />
      ) : (
        <button key={m.name} className="card member-elsewhere" title={`${m.name} isn’t in your library. Search for them`} onClick={() => go({ view: 'search', q: m.name })}>
          <Cover alt={m.name} round />
          <div className="card-title center">{m.name}</div>
          <div className="card-sub center muted">{[m.years, 'Not in your library'].filter(Boolean).join(' · ')}</div>
        </button>
      ))}
    </Grid>
  );
}
