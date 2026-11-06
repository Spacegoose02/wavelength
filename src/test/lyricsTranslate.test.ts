import { describe, expect, it } from 'vitest';
import { needsRomanizing } from '../lib/lyricsTranslate';

describe('lyrics translation', () => {
  it('offers Latin letters only for lyrics in another script', () => {
    expect(needsRomanizing(['안녕하세요', '사랑해', '보고 싶어', 'oh oh'])).toBe(true);
    expect(needsRomanizing(['君の名は', '夢を見た', 'ずっと'])).toBe(true);
    expect(needsRomanizing(['Hola', 'Te quiero', 'Corazón'])).toBe(false);
    expect(needsRomanizing(['Hello', 'one line of 日本'])).toBe(false);
  });
});
