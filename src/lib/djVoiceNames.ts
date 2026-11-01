/** Friendly names for the talking DJ's Hub voices (hub/src/dj/voice.ts), for the pickers. */
import type { HubVoiceEngine } from '../sources/hub';

const KOKORO_LANG: Record<string, string> = { a: 'American', b: 'British', e: 'Spanish', f: 'French', h: 'Hindi', i: 'Italian', j: 'Japanese', p: 'Brazilian', z: 'Mandarin' };

/** "am_michael" → "Michael (American, male)"; OpenAI's "coral" → "Coral". */
export function voiceLabel(name: string, engine: HubVoiceEngine): string {
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const m = engine === 'kokoro' ? /^([a-z])([fm])_([a-z]+)$/.exec(name) : null;
  if (m) return `${cap(m[3])} (${KOKORO_LANG[m[1]] ?? m[1]}, ${m[2] === 'f' ? 'female' : 'male'})`;
  return engine === 'openai' ? cap(name) : name;
}
