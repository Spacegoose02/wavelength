import { useEffect, useState } from 'react';
import { hubClient } from '../store/hub';

/**
 * Suggestions for the tag editors (views/TagEditor.tsx, views/ArtistTagEditor.tsx): the artist and genre names
 * already in the library, from the Hub. Inputs pick them up with `list="tag-artists"` / `list="tag-genres"`.
 */

let cached: { at: number; artists: string[]; genres: string[] } | undefined;

export function TagLists() {
  const [v, setV] = useState(cached);
  useEffect(() => {
    if (cached && Date.now() - cached.at < 60_000) return;
    hubClient()?.tagValues().then((r) => setV((cached = { at: Date.now(), ...r })), () => undefined);
  }, []);
  return (
    <>
      <datalist id="tag-artists">{v?.artists.map((a) => <option key={a} value={a} />)}</datalist>
      <datalist id="tag-genres">{v?.genres.map((g) => <option key={g} value={g} />)}</datalist>
    </>
  );
}

/** After a save: the next editor asks the Hub again, so new names show up. */
export const forgetTagValues = () => {
  cached = undefined;
};

/** Which list an input of this tag suggests from. */
export const tagList = (k: string) => (k === 'artist' || k === 'albumArtist' ? 'tag-artists' : k === 'genre' ? 'tag-genres' : undefined);
