/**
 * The app–Hub contract for house activity (hub/src/routes/activity.ts). Types only: see docs/ARCHITECTURE.md
 * "The app–Hub contract".
 */

/** What one device tells the Hub it's playing: names only, never a link. */
export interface ActivityReport {
  title: string;
  artist: string;
  album?: string;
  playing: boolean;
}

/** Someone in the house and what they're playing now. */
export interface HouseListener {
  userId: number;
  displayName: string;
  title: string;
  artist: string;
  album?: string;
  playing: boolean;
  device: string;
  /** When they last reported, ms */
  at: number;
}

export interface HouseActivity {
  listeners: HouseListener[];
}
