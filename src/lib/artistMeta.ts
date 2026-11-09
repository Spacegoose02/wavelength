import { useEffect } from 'react';
import { create } from 'zustand';
import type { HubArtistMeta } from '../sources/hub';
import { hubClient, useHub } from '../store/hub';

/**
 * What an admin set on an artist in Edit artist that has no file tag (hub/src/routes/artistMeta.ts): their
 * biography and how their albums are ordered. Read once per artist per session; Edit artist puts what it saved
 * here so the page changes straight away.
 */
interface MetaState {
  byName: Record<string, HubArtistMeta | null>;
  put(meta: HubArtistMeta): void;
}

const key = (name: string) => name.trim().toLowerCase();

export const useArtistMetaStore = create<MetaState>()((set) => ({
  byName: {},
  put: (meta) => set((s) => ({ byName: { ...s.byName, [key(meta.name)]: meta } })),
}));

/** The artist's details from the Hub; undefined while loading or without a Hub, null when the Hub has none. */
export function useArtistMeta(name: string): HubArtistMeta | null | undefined {
  const signedIn = useHub((s) => !!s.token);
  const meta = useArtistMetaStore((s) => s.byName[key(name)]);
  useEffect(() => {
    if (!signedIn || !name || meta !== undefined) return;
    hubClient()?.artistMeta(name).then(
      (m) => useArtistMetaStore.getState().put(m),
      () => useArtistMetaStore.setState((s) => ({ byName: { ...s.byName, [key(name)]: null } })),
    );
  }, [signedIn, name, meta]);
  return meta;
}
