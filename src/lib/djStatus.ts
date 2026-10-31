import { useEffect } from 'react';
import { create } from 'zustand';
import { hubClient, useHub } from '../store/hub';

/**
 * Whether the AI DJ is on for the signed-in person (the admin turns it on per account, on the Hub). Asked
 * once per sign-in and again every half hour, so the menu item comes and goes without a restart.
 */
const useDj = create<{ available: boolean; for?: string }>()(() => ({ available: false }));

let timer: number | undefined;
async function check() {
  const c = hubClient();
  const who = useHub.getState().user?.username;
  if (!c || !who) return useDj.setState({ available: false, for: undefined });
  try {
    const s = await c.djStatus();
    useDj.setState({ available: s.available, for: who });
  } catch {
    // an older Hub without the DJ, or offline: keep what we knew for this person
    if (useDj.getState().for !== who) useDj.setState({ available: false, for: who });
  }
}

export function useDjAvailable(): boolean {
  const user = useHub((s) => s.user?.id);
  const token = useHub((s) => s.token);
  useEffect(() => {
    check();
    window.clearInterval(timer);
    timer = window.setInterval(check, 30 * 60_000);
    return () => window.clearInterval(timer);
  }, [user, token]);
  return useDj((s) => s.available);
}
