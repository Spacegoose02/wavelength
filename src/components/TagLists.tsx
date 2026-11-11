import { useEffect, useState } from 'react';
import { useItemTags } from '../lib/itemTags';
import { hubClient } from '../store/hub';

/**
 * Suggestions for the tag editors (views/TagEditor.tsx, views/ArtistTagEditor.tsx): the artist and genre names
 * already in the library, from the Hub. Inputs pick them up with `list="tag-artists"` / `list="tag-genres"`.
 */

let cached: { at: number; artists: string[]; genres: string[] } | undefined;

/** The artist and genre names in the library, fetched from the Hub at most once a minute. */
export function useTagValues() {
  const [v, setV] = useState(cached);
  useEffect(() => {
    if (cached && Date.now() - cached.at < 60_000) return;
    hubClient()?.tagValues().then((r) => setV((cached = { at: Date.now(), ...r })), () => undefined);
  }, []);
  return v;
}

export function TagLists({ values }: { values?: typeof cached } = {}) {
  const own = useTagValues();
  const v = values ?? own;
  return (
    <>
      <datalist id="tag-artists">{v?.artists.map((a) => <option key={a} value={a} />)}</datalist>
      <datalist id="tag-genres">{v?.genres.map((g) => <option key={g} value={g} />)}</datalist>
    </>
  );
}

/** Suggestions for the Hub's styles, moods and collections (lib/itemTags.ts): `tag-styles`, `tag-moods`, `tag-collections`, and `tag-artist-genres`. */
export function HubTagLists() {
  const { values } = useItemTags();
  return (
    <>
      {(['style', 'mood', 'collection'] as const).map((f) => <datalist key={f} id={`tag-${f}s`}>{values[f]?.map((v) => <option key={v.name} value={v.name} />)}</datalist>)}
      <datalist id="tag-artist-genres">{values.genre?.map((v) => <option key={v.name} value={v.name} />)}</datalist>
    </>
  );
}

/** After a save: the next editor asks the Hub again, so new names show up. */
export const forgetTagValues = () => {
  cached = undefined;
};

/** Which list an input of this tag suggests from. */
export const tagList = (k: string) => (k === 'artist' || k === 'albumArtist' ? 'tag-artists' : k === 'genre' ? 'tag-genres' : undefined);
