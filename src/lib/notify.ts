import type { HubNotice } from '../sources/hub';
import { hubClient, useHub } from '../store/hub';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { isTauri } from './http';
import { isAndroid } from './platform';

/**
 * Inbox news as system notifications (docs/USERS-AND-ADMIN.md §6.8): a request that's ready or was turned
 * down, something shared with you, and (admins) a new request. The Hub keeps a list per person
 * (hub/src/notify.ts); each device remembers the last one it saw and asks for newer ones whenever the
 * Inbox badge is refreshed. Nothing pops up while Wavelength is in front: the badge says it then.
 *
 * Windows and Android use tauri-plugin-notification, the web app the browser's notifications. Android only
 * checks while the app is running, which includes the background while music plays.
 */

const KEY = 'tonearm.notifyAfter';

/** The cursor belongs to one account on one Hub. */
function cursorFor(who: string): number | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { who: string; after: number } | null;
    return v?.who === who ? v.after : undefined;
  } catch {
    return undefined;
  }
}
function saveCursor(who: string, after: number) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ who, after }));
  } catch {
    /* storage full or blocked: ask again next time */
  }
}

const webOk = () => !isTauri && typeof Notification !== 'undefined';

/** May this device show notifications? Asks only when `ask` (on the web it must follow a click). */
export async function notifyAllowed(ask = false): Promise<boolean> {
  if (isTauri) {
    const n = await import('@tauri-apps/plugin-notification');
    if (await n.isPermissionGranted()) return true;
    return ask && (await n.requestPermission()) === 'granted';
  }
  if (!webOk()) return false;
  if (Notification.permission === 'granted') return true;
  return ask && Notification.permission !== 'denied' && (await Notification.requestPermission()) === 'granted';
}

/** Whether this device can show them at all (an old browser, or a page not on https, can't). */
export const notifySupported = () => isTauri || (webOk() && window.isSecureContext);

let running = false;

/** Fetch what's new from the Hub and show it. Quietly does nothing when signed out, offline or switched off. */
export async function checkNotifications() {
  const c = hubClient();
  const { url, user } = useHub.getState();
  if (!c || !user || running) return;
  running = true;
  try {
    const who = `${url}#${user.id}`;
    const after = cursorFor(who);
    const r = await c.notifications(after);
    saveCursor(who, r.last);
    if (after === undefined || !r.notifications.length || !useSettings.getState().notifications) return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return;
    if (!(await notifyAllowed())) return;
    await show(r.notifications);
  } catch {
    /* offline, or notifications blocked: the Inbox badge still says it */
  } finally {
    running = false;
  }
}

async function show(list: HubNotice[]) {
  // a pile of them (back from a few days away) becomes one
  const items = list.length > 3 ? [{ title: 'Wavelength', body: `${list.length} new things in your Inbox` }] : list;
  if (isTauri) {
    const { sendNotification } = await import('@tauri-apps/plugin-notification');
    // The Android icon goes on each notification: a `plugins.notification` block in tauri.conf.json
    // stops the app from starting (the plugin's Rust side takes no config).
    const icon = isAndroid ? { icon: 'ic_notification', iconColor: '#22D3EE' } : {};
    for (const n of items) sendNotification({ title: n.title, body: n.body, ...icon });
    return;
  }
  for (const n of items) {
    const w = new Notification(n.title, { body: n.body, tag: 'id' in n ? `wl-${n.id}` : 'wl-many' });
    w.onclick = () => {
      window.focus();
      useUi.getState().go({ view: 'inbox' });
      w.close();
    };
  }
}
