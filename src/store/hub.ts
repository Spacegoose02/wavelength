import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { secretStorage } from '../lib/secrets';
import { isAndroid, isIOS, isLinux, isMac } from '../lib/platform';
import { isTauri, setHubFetch } from '../lib/http';
import { HubClient, HubError, type HubDevice, type HubPermission, type HubService, type HubSession, type HubUser } from '../sources/hub';

/**
 * Signed-in Wavelength Hub account (docs/HUB.md). Optional: with no Hub the app works exactly as before.
 * The signed-in profile is cached, so the app still opens into it (and plays downloads) when the Hub
 * can't be reached; only a 401 from the Hub signs the device out.
 */
interface HubState {
  url: string;
  token?: string;
  user?: HubUser;
  permissions: HubPermission[];
  device?: HubDevice;
  /** Last successful contact with the Hub. */
  lastSeen?: number;
  /** Set when the last call couldn't reach the Hub (offline, server down). */
  offline: boolean;
  /** Server logins the Hub hands this device (lib/hubServices.ts applies them to Settings). */
  services: HubService[];
  /** A parent's kids (hub/src/family.ts): their requests come to this person to approve. */
  kids: { id: number; displayName: string }[];
  /** Feature switches that are on for this person (lib/features.ts); unset until the Hub first answers. */
  features?: Partial<Record<string, boolean>>;
  /**
   * Values the Hub shares with this person's family or the whole Hub (hub/src/families.ts) that the device uses
   * itself. They win over anything typed into the device.
   */
  shared?: { discordAppId?: string | null };
  /**
   * Other people signed in on this device (a TV the household shares), to switch to without signing in again.
   * The active one is the fields above; each of these keeps its own device token, in the keychain.
   */
  profiles: SavedProfile[];
  /** The active profile's PIN hash, when it has one (SavedProfile.pin). */
  pin?: string;
  /**
   * A kid profile the Hub signed out (device revoked, account disabled): their name. The app stays locked
   * (components/KidLock.tsx KidSignedOutScreen) until someone signs in again, instead of opening unfiltered.
   */
  kidSignedOut?: string;
  setUrl(url: string): void;
  signedIn(s: HubSession): void;
  /** Sign in one more person on this device, and switch to them. */
  addProfile(s: HubSession): void;
  /** Switch to someone in `profiles`; the current person goes into the list. */
  switchProfile(userId: number): void;
  /** Sign someone in `profiles` out of this device. */
  removeProfile(userId: number): Promise<void>;
  /** A PIN (hashed, this device only) to ask for before switching to this profile; '' removes it. */
  setProfilePin(userId: number, pin: string): Promise<void>;
  /** Refresh the profile and permissions; a revoked or disabled account signs out here. */
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

export interface SavedProfile {
  token: string;
  user: HubUser;
  permissions: HubPermission[];
  device?: HubDevice;
  /** SHA-256 of the PIN, when one is set (profilePinHash). */
  pin?: string;
}

/**
 * Whether two people may switch to each other on a device: never across families (hub/src/families.ts). People
 * with no family on both sides (a Hub without families, or an older Hub) switch as before.
 */
export const sameFamily = (a?: Pick<HubUser, 'familyId'>, b?: Pick<HubUser, 'familyId'>) => (a?.familyId ?? null) === (b?.familyId ?? null);

/** A PIN only keeps the household from switching into each other's profiles by accident; the Hub isn't involved. */
export async function profilePinHash(userId: number, pin: string): Promise<string> {
  const data = new TextEncoder().encode(`wavelength-profile:${userId}:${pin}`);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const asProfile = (s: { token?: string; user?: HubUser; permissions: HubPermission[]; device?: HubDevice }, pin?: string): SavedProfile | null =>
  s.token && s.user ? { token: s.token, user: s.user, permissions: s.permissions, device: s.device, ...(pin && { pin }) } : null;

export const useHub = create<HubState>()(
  persist(
    (set) => ({
      url: '',
      permissions: [],
      offline: false,
      services: [],
      kids: [],
      profiles: [],
      setUrl: (url) => set({ url }),
      signedIn: (s) => set({ token: s.token, user: s.user, permissions: s.permissions, device: s.device, kids: [], features: undefined, shared: undefined, lastSeen: Date.now(), offline: false, kidSignedOut: undefined }),
      addProfile: (n) =>
        set((st) => {
          const cur = asProfile(st, st.pin);
          localStorage.removeItem(STAMPS_KEY);
          return {
            profiles: [...st.profiles.filter((p) => p.user.id !== n.user.id && p.user.id !== cur?.user.id), ...(cur ? [cur] : [])],
            token: n.token, user: n.user, permissions: n.permissions, device: n.device, pin: undefined, kids: [], features: undefined, shared: undefined, services: [], lastSeen: Date.now(), offline: false, kidSignedOut: undefined,
          };
        }),
      switchProfile: (userId) =>
        set((st) => {
          const next = st.profiles.find((p) => p.user.id === userId);
          // never into another family's profile, even one still signed in here from before
          if (!next || !sameFamily(st.user, next.user)) return st;
          const cur = asProfile(st, st.pin);
          // each person's settings sync from scratch (hubSync.ts); their playlists follow the owner (librarySync.ts)
          localStorage.removeItem(STAMPS_KEY);
          return {
            profiles: [...st.profiles.filter((p) => p.user.id !== userId), ...(cur ? [cur] : [])],
            token: next.token, user: next.user, permissions: next.permissions, device: next.device, pin: next.pin, kids: [], features: undefined, shared: undefined, services: [], offline: false,
          };
        }),
      removeProfile: async (userId) => {
        const p = useHub.getState().profiles.find((x) => x.user.id === userId);
        if (!p) return;
        await new HubClient(useHub.getState().url, p.token).logout().catch(() => undefined);
        set((st) => ({ profiles: st.profiles.filter((x) => x.user.id !== userId) }));
      },
      setProfilePin: async (userId, pin) => {
        const hash = pin ? await profilePinHash(userId, pin) : undefined;
        set((st) => (st.user?.id === userId ? ({ pin: hash }) : { profiles: st.profiles.map((p) => (p.user.id === userId ? { ...p, pin: hash } : p)) }));
      },
      refresh: async () => {
        const c = hubClient();
        if (!c) return;
        try {
          const me = await c.me();
          set({ user: me.user, permissions: me.permissions, device: me.device, kids: me.kids ?? [], features: me.features, shared: me.shared, lastSeen: Date.now(), offline: false });
        } catch (e) {
          if (e instanceof HubError && e.status === 401) {
            // a kid's device the Hub signed out stays locked rather than opening with no kid filters
            const was = useHub.getState().user;
            set({ token: undefined, user: undefined, permissions: [], device: undefined, offline: false, services: [], shared: undefined, ...(was?.role === 'kid' && { kidSignedOut: was.displayName }) });
          }
          else set({ offline: true });
        }
      },
      signOut: async () => {
        const c = hubClient();
        // tell the Hub when we can; sign out locally either way
        await c?.logout().catch(() => undefined);
        localStorage.removeItem(STAMPS_KEY);
        // someone else signed in on this device carries on
        // someone else in the same family signed in on this device carries on; other families' profiles stay put
        const { profiles, user: was } = useHub.getState();
        const next = profiles.find((p) => sameFamily(was, p.user));
        const rest = profiles.filter((p) => p !== next);
        if (next) set({ token: next.token, user: next.user, permissions: next.permissions, device: next.device, pin: next.pin, profiles: rest, kids: [], features: undefined, shared: undefined, offline: false, services: [] });
        else set({ token: undefined, user: undefined, permissions: [], device: undefined, offline: false, services: [], kids: [], features: undefined, shared: undefined });
      },
    }),
    {
      name: 'tonearm.hub',
      partialize: (st) => {
        const { url, token, user, permissions, device, lastSeen, services, kids, profiles, features, shared } = st;
        return { url, token, user, permissions, device, lastSeen, services, kids, profiles, features, shared, pin: st.pin, kidSignedOut: st.kidSignedOut };
      },
      // the device token, and the server logins the Hub hands out, live in the OS keychain (lib/secrets.ts)
      storage: createJSONStorage(() =>
        secretStorage<Partial<HubState>>({
          strip: ({ token, services, profiles, ...rest }) => {
            const secrets: Record<string, string> = token ? { 'hub.token': token } : {};
            services?.forEach((x) => {
              if (Object.keys(x.secrets ?? {}).length) secrets[`hub.service.${x.id}`] = JSON.stringify(x.secrets);
            });
            profiles?.forEach((p) => {
              secrets[`hub.profile.${p.user.id}`] = p.token;
            });
            return { state: { ...rest, services: services?.map((x) => ({ ...x, secrets: {} })), profiles: profiles?.map((p) => ({ ...p, token: '' })) }, secrets };
          },
          fill: (state, get) => ({
            ...state,
            token: get('hub.token') ?? state.token,
            profiles: state.profiles?.map((p) => ({ ...p, token: get(`hub.profile.${p.user.id}`) ?? p.token })).filter((p) => !!p.token),
            services: state.services?.map((x) => {
              const v = get(`hub.service.${x.id}`);
              return v ? { ...x, secrets: JSON.parse(v) } : x;
            }),
          }),
          owns: (k) => k.startsWith('hub.'),
        }),
      ),
    },
  ),
);

// in a browser, public APIs without CORS go through the Hub (lib/http.ts)
setHubFetch(() => {
  const { url, token } = useHub.getState();
  return url && token ? { url, token } : undefined;
});

/** Where hubSync.ts keeps when each synced setting was last changed on this device. */
export const STAMPS_KEY = 'tonearm.hubStamps';

/** A client for the signed-in Hub, or null when not signed in. */
export function hubClient(): HubClient | null {
  const { url, token } = useHub.getState();
  return url && token ? new HubClient(url, token) : null;
}

/** Whether the signed-in Hub user may do this. Without a Hub there are no limits (standalone mode). */
export function useCan(perm: HubPermission): boolean {
  return useHub((s) => !s.token || s.permissions.includes(perm));
}

export function thisDevice(): { deviceName: string; platform: string } {
  const tv = typeof document !== 'undefined' && document.documentElement.classList.contains('tv');
  if (isAndroid) return tv ? { deviceName: 'Android TV', platform: 'android-tv' } : { deviceName: 'Android', platform: 'android' };
  if (isIOS && isTauri) return /iPad/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent) ? { deviceName: 'iPad', platform: 'ios' } : { deviceName: 'iPhone', platform: 'ios' };
  if (isTauri && isMac) return { deviceName: 'Mac', platform: 'macos' };
  if (isTauri && isLinux) return { deviceName: 'Linux PC', platform: 'linux' };
  if (isTauri) return { deviceName: 'Windows PC', platform: 'windows' };
  return { deviceName: 'Browser', platform: 'web' };
}
