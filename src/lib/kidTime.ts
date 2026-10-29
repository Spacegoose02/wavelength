import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { KidRules } from '../sources/hub';
import { hubClient, useHub } from '../store/hub';
import { usePlayer } from '../store/player';
import { isKid } from './kids';

/**
 * Bedtime and the daily listening limit on kid profiles (docs/USERS-AND-ADMIN.md §6.5). The Hub keeps the
 * rules and adds up listening from all the kid's devices; this device counts while music plays, reports it
 * every minute, and stops the music (with a "time for bed" screen) when it's bedtime or time is up. The
 * grown-up PIN unlocks another half hour. Rules are kept on the device so bedtime still works offline.
 */

export type KidLock = 'bedtime' | 'limit' | null;

interface KidTimeState {
  rules: KidRules | null;
  /** Seconds listened today, from the Hub plus what this device hasn't reported yet. */
  used: number;
  day: string;
  pinSet: boolean;
  /** A grown-up typed the PIN: no lock until then (ms epoch). */
  unlockedUntil: number;
  lock: KidLock;
}

export const useKidTime = create<KidTimeState>()(
  persist((): KidTimeState => ({ rules: null, used: 0, day: '', pinSet: false, unlockedUntil: 0, lock: null }), {
    name: 'tonearm.kidTime',
    partialize: ({ rules, used, day, pinSet, unlockedUntil }) => ({ rules, used, day, pinSet, unlockedUntil }),
  }),
);

const pad = (n: number) => String(n).padStart(2, '0');
export const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Inside bedtime? Handles a bedtime that runs past midnight (20:30 → 07:00). */
export function inBedtime(rules: KidRules | null, d = new Date()): boolean {
  if (!rules?.bedtimeFrom || !rules.bedtimeTo) return false;
  const now = d.getHours() * 60 + d.getMinutes();
  const from = minutesOf(rules.bedtimeFrom);
  const to = minutesOf(rules.bedtimeTo);
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

function lockNow(s: KidTimeState): KidLock {
  if (!isKid() || Date.now() < s.unlockedUntil) return null;
  if (inBedtime(s.rules)) return 'bedtime';
  if (s.rules?.dailyMinutes && s.used >= s.rules.dailyMinutes * 60) return 'limit';
  return null;
}

let pending = 0;

async function sync() {
  const c = hubClient();
  if (!c || !isKid()) return;
  const day = today();
  const send = pending;
  pending = 0;
  try {
    if (send) await c.listened(day, send);
  } catch {
    pending += send;
  }
  try {
    const st = await c.kidStatus(day);
    // the Hub's total covers every device; add what this one still has to report
    useKidTime.setState({ rules: st.rules, pinSet: st.pinSet, day, used: st.usedSeconds + pending });
  } catch {
    /* offline: keep counting here, report later */
  }
  check();
}

function check() {
  const s = useKidTime.getState();
  const lock = lockNow(s);
  if (lock !== s.lock) useKidTime.setState({ lock });
  if (lock && usePlayer.getState().playing) usePlayer.getState().toggle();
}

const TICK = 15;
let started = false;
/** Count listening on kid profiles and enforce bedtime and the daily limit. */
export function startKidTime() {
  if (started) return;
  started = true;
  sync();
  let ticks = 0;
  setInterval(() => {
    if (!isKid()) return useKidTime.getState().lock && useKidTime.setState({ lock: null });
    const day = today();
    // a new day: start counting from zero
    if (useKidTime.getState().day !== day) {
      pending = 0;
      useKidTime.setState({ day, used: 0 });
    }
    if (usePlayer.getState().playing) {
      pending += TICK;
      useKidTime.setState((s) => ({ used: s.used + TICK }));
    }
    check();
    if (++ticks % 4 === 0) sync();
  }, TICK * 1000);
  // pressing play while locked stops again at once
  usePlayer.subscribe((s, prev) => s.playing && !prev.playing && check());
  useHub.subscribe((s, prev) => s.user?.id !== prev.user?.id && sync());
}

/** Check the grown-up PIN with the Hub. Throws with the Hub's message when it's wrong. */
export async function checkPin(pin: string) {
  const c = hubClient();
  if (!c) throw new Error('Not signed in to a Hub');
  await c.kidUnlock(pin);
}

/** PIN accepted on the lock screen: 30 more minutes. */
export async function unlockKidTime(pin: string) {
  await checkPin(pin);
  useKidTime.setState({ unlockedUntil: Date.now() + 30 * 60_000, lock: null });
}
