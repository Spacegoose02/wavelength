import { albumGenres } from '../lib/browse';
import { type Facets, FACET_LABELS, useAlbumTags, useArtistTags } from '../lib/itemTags';
import type { Album } from '../sources/types';
import type { HubFacet } from '../sources/hub';
import { useUi } from '../store/ui';

/**
 * The genres, styles, moods and collections of an album or artist, as rows of chips under the page's title (Plex
 * shows the same on its album and artist pages). Genres open Browse; the rest come from the Hub (lib/itemTags.ts).
 */
function Rows({ genres, facets }: { genres: string[]; facets: Facets }) {
  const rows: [HubFacet, string[]][] = [['genre', genres], ['style', facets.style ?? []], ['mood', facets.mood ?? []], ['collection', facets.collection ?? []]];
  if (!rows.some(([, v]) => v.length)) return null;
  return (
    <dl className="tag-rows">
      {rows.filter(([, v]) => v.length).map(([f, v]) => (
        <div key={f}>
          <dt>{FACET_LABELS[f]}</dt>
          <dd className="chips inline">
            {v.slice(0, 12).map((name) => f === 'genre'
              ? <button key={name} className="chip" onClick={() => useUi.getState().go({ view: 'browse', genre: name })}>{name}</button>
              : <span key={name} className="chip">{name}</span>)}
            {v.length > 12 && <span className="muted small">+{v.length - 12}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function AlbumTagChips({ album }: { album: Album }) {
  return <Rows genres={albumGenres(album)} facets={useAlbumTags(album.artist, album.title)} />;
}

/** An artist's own genres from the Hub, else none (their albums' genres are on Browse). */
export function ArtistTagChips({ name }: { name: string }) {
  const facets = useArtistTags(name);
  return <Rows genres={facets.genre ?? []} facets={facets} />;
}
