import type { Album } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { hubClient } from '../store/hub';

/**
 * Admins: delete albums from Navidrome through the Hub (hub/src/routes/trash.ts). Their files go to the Hub's
 * trash and can be put back under Settings → Server → Deleted albums for 30 days. Each one leaves this device's
 * library straight away; Navidrome forgets it on its rescan.
 */
export async function deleteAlbum(album: Album) {
  const r = await hubClient()!.deleteAlbum(album.id);
  forget([album]);
  return r;
}

/** Delete several, one after the other. `onEach` hears how each one went. */
export async function deleteAlbums(albums: Album[], onEach?: (a: Album, result: { files: number } | { error: string }) => void) {
  let deleted = 0;
  for (const a of albums) {
    try {
      const r = await deleteAlbum(a);
      deleted++;
      onEach?.(a, { files: r.files });
    } catch (e) {
      onEach?.(a, { error: String((e as Error).message ?? e) });
    }
  }
  return deleted;
}

function forget(gone: Album[]) {
  const is = (x: Album) => gone.some((g) => g.sourceId === x.sourceId && g.id === x.id);
  useCatalog.setState((s) => ({
    albums: s.albums.flatMap((a) => {
      const refs = (a.refs ?? [a]).filter((x) => !is(x));
      return refs.length === (a.refs ?? [a]).length ? [a] : refs.length ? [{ ...a, ...refs[0], refs }] : [];
    }),
    recent: s.recent.filter((a) => !is(a)),
  }));
}
