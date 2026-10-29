import { engine } from '../player/engine';
import type { HubRemoteCommand } from '../sources/hub';
import { hubClient, useHub } from '../store/hub';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { forHub, fromHub } from './librarySync';

/**
 * Remote control and handoff (hub/src/routes/remote.ts): while signed in to a Hub, this device tells the Hub
 * what it's playing and waits for commands from the person's other devices (components/Devices.tsx).
 * Settings → Account → "Let my other devices control this one" turns it off for this device.
 */

let started = false;
let loop = 0;
let lastSent = '';

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const enabled = () => !!hubClient() && useSettings.getState().remoteControl;

/** Run one command from another device. */
export function applyRemote(c: HubRemoteCommand) {
  const p = usePlayer.getState();
  switch (c.action) {
    case 'toggle': return p.toggle();
    case 'play': return void (p.current() && engine.el.paused && p.toggle());
    case 'pause': return void (!engine.el.paused && engine.pause());
    case 'next': return p.next();
    case 'prev': return p.prev();
    case 'seek': return c.value !== undefined && p.seek(c.value);
    case 'volume': return c.value !== undefined && p.setVolume(c.value);
    case 'jump': return c.index !== undefined && p.jump(c.index);
    case 'load':
      if (!c.queue?.length) return;
      p.playTracks(c.queue.map(fromHub), c.index ?? 0, c.position ?? 0);
      if (c.play === false) setTimeout(() => engine.pause(), 500);
  }
}

/** Tell the Hub what's playing here. Skipped when nothing changed in the last 15 seconds. */
export async function sendState(force = false) {
  const c = hubClient();
  if (!c || !useSettings.getState().remoteControl) return;
  const { queue, index, position, duration, playing, volume } = usePlayer.getState();
  // the queue around what's playing, so a long one still fits
  const from = Math.max(0, index - 50);
  const near = queue.slice(from, from + 300);
  const key = `${near.length}:${queue[index]?.id}:${index}:${playing}:${volume}:${Math.round(position / 15)}`;
  if (!force && key === lastSent) return;
  lastSent = key;
  await c.remoteState({ queue: near.map(forHub), index: index - from, position, duration, playing, volume }).catch(() => {
    lastSent = '';
  });
}

async function waitLoop() {
  const me = ++loop;
  await sendState(true);
  while (me === loop && enabled()) {
    try {
      const { commands } = await hubClient()!.remoteWait();
      if (me !== loop) break;
      for (const cmd of commands) applyRemote(cmd);
      if (commands.length) setTimeout(() => sendState(true), 1200);
    } catch {
      await sleep(10_000);
    }
  }
}

export function startRemote() {
  if (started) return;
  started = true;
  if (enabled()) void waitLoop();
  const restart = () => {
    loop++;
    lastSent = '';
    if (enabled()) void waitLoop();
  };
  useHub.subscribe((s, prev) => s.token !== prev.token && restart());
  useSettings.subscribe((s, prev) => {
    if (s.remoteControl === prev.remoteControl) return;
    if (!s.remoteControl) void hubClient()?.remoteLeave().catch(() => {});
    restart();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  usePlayer.subscribe((s, prev) => {
    if (s.playing === prev.playing && s.index === prev.index && s.queue === prev.queue && s.volume === prev.volume) return;
    clearTimeout(timer);
    timer = setTimeout(() => void sendState(), 800);
  });
  setInterval(() => usePlayer.getState().playing && void sendState(), 15_000);
}
