import { useHub } from '../store/hub';

/**
 * Feature switches a Hub admin sets in Settings → Features (hub/src/features.ts, which has the same keys).
 * The Hub works out what's on for the signed-in person (kids can have a feature off on its own) and sends it
 * with GET /api/me. With no Hub there's nobody to ask, so each feature that works without a Hub is on.
 */

export type FeatureKey =
  | 'homeMixes' | 'blend' | 'smartOffline' | 'sonic' | 'automix' | 'cast' | 'djVoice' | 'djWeb' | 'djMode' | 'artistInfo' | 'tourDates'
  | 'singMode' | 'musicVideos' | 'publicShares' | 'discordStatus' | 'mouthTuner' | 'exclusiveAudio';

export interface FeatureInfo {
  key: FeatureKey;
  label: string;
  help: string;
  /** what a device with no Hub gets */
  standalone: boolean;
}

/** In the order Settings → Features lists them. */
export const FEATURE_INFO: FeatureInfo[] = [
  { key: 'homeMixes', label: 'Home and Made for you mixes', help: 'A Home page with Daily Mixes, Discover Weekly, On Repeat and more, made each night from what each person plays.', standalone: false },
  { key: 'blend', label: 'Blend', help: 'A shared mix made from two or more people’s listening.', standalone: false },
  { key: 'smartOffline', label: 'Smart offline', help: 'Keeps favourites, recent plays and mixes downloaded on phones automatically.', standalone: true },
  { key: 'sonic', label: 'Sound-alike analysis', help: 'The Hub listens to every song once (tempo, key, energy, sound) for “Sounds like this” radio, mood filters and AutoMix. Needs the analysis container.', standalone: false },
  { key: 'automix', label: 'AutoMix', help: 'Blends songs on the beat instead of a plain crossfade.', standalone: true },
  { key: 'cast', label: 'Cast to speakers', help: 'Play on Chromecast, Google/Nest and DLNA/UPnP speakers and TVs.', standalone: true },
  { key: 'djVoice', label: 'Talking AI DJ', help: 'The AI DJ introduces songs out loud between tracks. Uses the AI DJ’s key and limits; each device reads it with its own voice. People turn it on in Settings → Playback.', standalone: false },
  { key: 'djMode', label: 'DJ mode', help: 'A station that runs itself: the AI DJ plays your favourites, new finds, throwbacks and top hits in segments, introduces each one, and changes course when you ask. Songs come from your mixes and the charts; the AI writes the intros (one short call per segment, counted toward the AI DJ limits).', standalone: false },
  { key: 'djWeb', label: 'AI DJ web search', help: 'The AI DJ can search the web and read pages: today’s top hits, a festival or DJ setlist, a playlist page someone pasted. Searches cost about 1 cent each and count toward the AI DJ limits; the cap per step is under Settings → AI DJ.', standalone: false },
  { key: 'artistInfo', label: 'Artist bios and credits', help: 'Artist stories and facts from Wikipedia and MusicBrainz, and who wrote and produced each song.', standalone: true },
  { key: 'tourDates', label: 'Tour dates', help: 'Upcoming concerts for artists people follow. Needs a Ticketmaster or Bandsintown key.', standalone: false },
  { key: 'singMode', label: 'Sing mode', help: 'Turns the lead vocal down so people can sing along with the lyrics.', standalone: true },
  { key: 'musicVideos', label: 'Music videos', help: 'Finds a song’s official video on YouTube (with the Hub’s yt-dlp) and plays it from Now Playing.', standalone: false },
  { key: 'publicShares', label: 'Share links for anyone', help: 'Links to a song, album or playlist that people without an account can open in a browser.', standalone: false },
  { key: 'discordStatus', label: 'Discord status', help: 'Shows “Listening to …” on Discord from the Windows app (each person still turns it on).', standalone: true },
  { key: 'mouthTuner', label: 'Critter mouth tuner', help: 'Lets people tune how the critters’ mouths follow the singing. Off puts everyone back on the defaults.', standalone: true },
  { key: 'exclusiveAudio', label: 'Bit-perfect output (Windows)', help: 'Plays files at their own sample rate and bit depth straight to the sound card (WASAPI exclusive). People turn it on in Settings → Playback; the equalizer and visualizers are off while it’s in use.', standalone: true },
];

const STANDALONE = Object.fromEntries(FEATURE_INFO.map((f) => [f.key, f.standalone])) as Record<FeatureKey, boolean>;

function pick(key: FeatureKey, hub: boolean, features: Partial<Record<string, boolean>> | undefined, role: string | undefined): boolean {
  if (!hub) return STANDALONE[key];
  const v = features?.[key];
  if (v !== undefined) return v;
  // not heard from the Hub yet (an older Hub, or first start offline): kids get nothing extra until it says so
  return role === 'kid' ? false : STANDALONE[key];
}

/** Whether a feature is on for whoever is using the app now. */
export function featureOn(key: FeatureKey): boolean {
  const { token, features, user } = useHub.getState();
  return pick(key, !!token, features, user?.role);
}

/** The same, as a hook that re-renders when the Hub's answer changes. */
export function useFeature(key: FeatureKey): boolean {
  return useHub((s) => pick(key, !!s.token, s.features, s.user?.role));
}
