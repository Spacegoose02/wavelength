import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { secretStorage } from '../lib/secrets';
import { isAndroid } from '../lib/platform';
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
  setUrl(url: string): void;
  signedIn(s: HubSession): void;
  /** Refresh the profile and permissions; a revoked or disabled account signs out here. */
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

export const useHub = create<HubState>()(
  persist(
    (set) => ({
      url: '',
      permissions: [],
      offline: false,
      services: [],
      setUrl: (url) => set({ url }),
      signedIn: (s) => set({ token: s.token, user: s.user, permissions: s.permissions, device: s.device, lastSeen: Date.now(), offline: false }),
      refresh: async () => {
        const c = hubClient();
        if (!c) return;
        try {
          const me = await c.me();
          set({ user: me.user, permissions: me.permissions, device: me.device, lastSeen: Date.now(), offline: false });
        } catch (e) {
          if (e instanceof HubError && e.status === 401) set({ token: undefined, user: undefined, permissions: [], device: undefined, offline: false, services: [] });
          else set({ offline: true });
        }
      },
      signOut: async () => {
        const c = hubClient();
        // tell the Hub when we can; sign out locally either way
        await c?.logout().catch(() => undefined);
        set({ token: undefined, user: undefined, permissions: [], device: undefined, offline: false, services: [] });
        localStorage.removeItem(STAMPS_KEY);
      },
    }),
    {
      name: 'tonearm.hub',
      partialize: ({ url, token, user, permissions, device, lastSeen, services }) => ({ url, token, user, permissions, device, lastSeen, services }),
      // the device token, and the server logins the Hub hands out, live in the OS keychain (lib/secrets.ts)
      storage: createJSONStorage(() =>
        secretStorage<Partial<HubState>>({
          strip: ({ token, services, ...rest }) => {
            const secrets: Record<string, string> = token ? { 'hub.token': token } : {};
            services?.forEach((x) => {
              if (Object.keys(x.secrets ?? {}).length) secrets[`hub.service.${x.id}`] = JSON.stringify(x.secrets);
            });
            return { state: { ...rest, services: services?.map((x) => ({ ...x, secrets: {} })) }, secrets };
          },
          fill: (state, get) => ({
            ...state,
            token: get('hub.token') ?? state.token,
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
  if (isTauri) return { deviceName: 'Windows PC', platform: 'windows' };
  return { deviceName: 'Browser', platform: 'web' };
}
