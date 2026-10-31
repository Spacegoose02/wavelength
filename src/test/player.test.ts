import { describe, expect, test } from 'vitest';
import { currentLine, maskForKids, parseLrc } from '../lib/lyrics';
import { replayGainFactor, UNTAGGED_DB } from '../player/replayGain';

describe('lyrics', () => {
  test('LRC lines are timed, sorted and shifted by [offset]', () => {
    const lines = parseLrc('[ar:Band]\n[offset:+500]\n[00:12.50]Second\n[00:01.00][00:20]Twice\n[01:02:30]Late');
    expect(lines.map((l) => [l.time, l.text])).toEqual([[0.5, 'Twice'], [12, 'Second'], [19.5, 'Twice'], [61.8, 'Late']]);
  });

  test('the line being sung', () => {
    const lines = parseLrc('[00:05]a\n[00:10]b\n[00:15]c');
    expect(currentLine(lines, 2)).toBe(-1);
    expect(currentLine(lines, 10)).toBe(1);
    expect(currentLine(lines, 99)).toBe(2);
  });

  test('kid profiles see strong words hidden, not names that contain them', () => {
    expect(maskForKids('what the fuck')).toBe('what the f•••');
    expect(maskForKids('Charles Dickens, hell and damn')).toBe('Charles Dickens, hell and damn');
  });
});

describe('ReplayGain', () => {
  test('off leaves the level alone', () => {
    expect(replayGainFactor({ trackGain: -10 }, 'off')).toBe(1);
  });

  test('track and album gain, with the other as a fallback', () => {
    const rg = { trackGain: -6, albumGain: -3 };
    expect(replayGainFactor(rg, 'track')).toBeCloseTo(10 ** (-6 / 20));
    expect(replayGainFactor(rg, 'album')).toBeCloseTo(10 ** (-3 / 20));
    expect(replayGainFactor({ trackGain: -6 }, 'album')).toBeCloseTo(10 ** (-6 / 20));
  });

  test('untagged songs are turned down, and peaks never clip', () => {
    expect(replayGainFactor(undefined, 'track')).toBeCloseTo(10 ** (UNTAGGED_DB / 20));
    expect(replayGainFactor({ trackGain: 6, trackPeak: 0.9 }, 'track')).toBeCloseTo(1 / 0.9);
  });
});
