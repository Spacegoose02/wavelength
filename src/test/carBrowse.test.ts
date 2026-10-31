import { describe, expect, test } from 'vitest';
import { parseId } from '../lib/carIds';

describe('Android Auto ids', () => {
  test('say what to play, keeping colons in server ids', () => {
    expect(parseId('pl:abc:1')).toEqual({ kind: 'pl', rest: 'abc:1' });
    expect(parseId('al:nav1:al-2:x')).toEqual({ kind: 'al', source: 'nav1', rest: 'al-2:x' });
    expect(parseId('st:radio:42')).toEqual({ kind: 'st', source: 'radio', rest: '42' });
    expect(parseId('fav')).toEqual({ kind: 'fav', rest: '' });
  });
});
