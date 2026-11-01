/**
 * Discord status: "Listening to <song> by <artist>" on your Discord profile while music plays, from the desktop
 * app (src-tauri/src/discord.rs talks to the Discord app on this computer). Cleared when paused. Only a public
 * cover goes to Discord, never a link with a server login in it.
 */
import { invoke } from '@tauri-apps/api/core';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { featureOn } from './features';
import { isTauri } from './http';
import { activityFor } from './discordActivity';
import { isAndroid } from './platform';

export const canDiscord = isTauri && !isAndroid;

/** The last problem (Discord not running, a wrong ID), for Settings. */
export let discordProblem = '';
const listeners = new Set<() => void>();
export const onDiscordProblem = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));
const problem = (p: string) => {
  if (p === discordProblem) return;
  discordProblem = p;
  listeners.forEach((fn) => fn());
};

let timer: ReturnType<typeof setTimeout> | undefined;
let last = '';
let shown = false;

function update() {
  const { on, appId } = useSettings.getState().discord;
  const p = usePlayer.getState();
  const t = p.queue[p.index];
  const want = canDiscord && on && !!appId && featureOn('discordStatus') && p.playing && !!t && t.kind !== 'book';
  if (!want) {
    if (shown) {
      shown = false;
      last = '';
      void invoke('discord_clear').catch(() => undefined);
    }
    return;
  }
  const activity = activityFor(t, p.position, p.duration || t.duration || 0);
  // the same song from the same start: nothing to send (a seek moves the start by more than a few seconds)
  const key = `${appId}|${activity.details}|${activity.state}|${Math.round(activity.timestamps.start / 5000)}`;
  if (key === last) return;
  last = key;
  invoke('discord_set', { clientId: appId.trim(), activity }).then(
    () => { shown = true; problem(''); },
    (e: unknown) => { last = ''; problem(String((e as Error)?.message ?? e)); },
  );
}

export function startDiscord() {
  if (!canDiscord) return;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(update, 1200);
  };
  usePlayer.subscribe((s, prev) => {
    if (s.index !== prev.index || s.playing !== prev.playing || s.queue !== prev.queue || Math.abs(s.position - prev.position) > 3) soon();
  });
  useSettings.subscribe((s, prev) => s.discord !== prev.discord && soon());
  soon();
}
