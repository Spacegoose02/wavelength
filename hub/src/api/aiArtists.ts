/**
 * The app–Hub contract for AI-generated artists (src/lib/aiArtists.ts, hub/src/aiArtists.ts). Types only. Admins
 * mark artists on the Hub; each person's choices are a synced setting (`settings.aiArtists` in their prefs), so the
 * Hub reads `outOfPicks` to keep those artists out of their mixes and DJ mode.
 */
export interface AiArtist {
  /** the name as the admin marked it ("Velvet Sundown"); matched on the main artist, ignoring case, accents and punctuation */
  name: string;
  /** who marked them (their display name), or null when that account is gone */
  setBy: string | null;
  setAt: number;
}

/** One person's choices, in Settings → Playback → AI artists. Both start off. */
export interface AiArtistPrefs {
  /** leave them out of Discover: the charts, Release Radar and who to follow */
  hideInDiscover: boolean;
  /** leave them out of what Wavelength picks: radio, Smart Shuffle, DJ mode and Made for you mixes (like Don't play) */
  outOfPicks: boolean;
}
