/**
 * Sing mode: turn the lead vocal down (player/engine.ts setVocalCut) and show the lyrics, so you can sing over
 * the band. Kept on this device; it switches itself off when an admin turns the feature off.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { engine } from '../player/engine';
import { useHub } from '../store/hub';
import { featureOn } from './features';

interface SingState {
  on: boolean;
  /** 0..1: how far the vocal goes down. */
  amount: number;
  set(p: Partial<Pick<SingState, 'on' | 'amount'>>): void;
}

export const useSing = create<SingState>()(
  persist((set) => ({ on: false, amount: 0.85, set: (p) => set(p) }), {
    name: 'wavelength-sing',
    partialize: (s) => ({ on: s.on, amount: s.amount }),
  }),
);

function apply() {
  const s = useSing.getState();
  engine.setVocalCut(s.on && featureOn('singMode') ? s.amount : 0);
}

export function startSingMode() {
  apply();
  useSing.subscribe(apply);
  useHub.subscribe((h, prev) => {
    if (h.features !== prev.features || h.token !== prev.token) apply();
  });
}
