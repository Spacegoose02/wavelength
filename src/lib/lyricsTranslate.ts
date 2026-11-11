import type { Track } from '../sources/types';
import { hubClient } from '../store/hub';
import { sharedKey } from './lyrics';

/**
 * Translate lyrics, or write them in Latin letters (hub POST /api/lyrics/translate, through the AI DJ's model or
 * Ollama). The Hub keeps each answer for the house; this keeps it for the session too.
 */
export type LyricsMode = 'translate' | 'romanize';

/** This device's language by name, in English ("English", "Spanish"), which the Hub's prompt uses. */
export function deviceLanguage(): string {
  const code = (typeof navigator !== 'undefined' ? navigator.language : 'en').split('-')[0] || 'en';
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? 'English';
  } catch {
    return 'English';
  }
}

const NON_LATIN = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Georgian}\p{Script=Armenian}]/u;

/** Worth offering "In Latin letters": a few lines are written in another script. */
export const needsRomanizing = (lines: string[]) => lines.filter((l) => NON_LATIN.test(l)).length >= Math.min(3, lines.length);

const memo = new Map<string, string[]>();

export async function translateLyrics(t: Pick<Track, 'title' | 'artist' | 'duration'>, lines: string[], mode: LyricsMode): Promise<string[]> {
  const c = hubClient();
  if (!c) throw new Error('Translating lyrics needs a Wavelength Hub');
  const key = sharedKey(t) ?? `${t.artist}|${t.title}`;
  const to = mode === 'translate' ? deviceLanguage() : '';
  const k = `${mode}|${to}|${key}`;
  const hit = memo.get(k);
  if (hit?.length === lines.length) return hit;
  const r = await c.translateLyrics({ key, lines, mode, to });
  memo.set(k, r.lines);
  return r.lines;
}
