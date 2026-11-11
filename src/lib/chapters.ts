/** Audiobook and podcast chapters (pure helpers for lib/spoken.ts and the sleep timer). */
import type { Chapter, Track } from '../sources/types';

/** Where the player is in the whole book or episode, in seconds (a book's parts each start at their `bookOffset`). */
export const bookPosition = (t: Track, position: number) => (t.bookOffset ?? 0) + position;

/** The chapter at `abs` seconds into the book or episode, and its number (from 0). */
export function chapterAt(chapters: Chapter[] | undefined, abs: number): { chapter: Chapter; index: number } | undefined {
  if (!chapters?.length) return undefined;
  let index = -1;
  for (let i = 0; i < chapters.length; i++) if (abs + 0.25 >= chapters[i].start) index = i;
  return index < 0 ? undefined : { chapter: chapters[index], index };
}
