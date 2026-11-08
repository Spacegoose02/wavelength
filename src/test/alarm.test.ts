import { describe, expect, test } from 'vitest';
import { daysText, fadeInLevel, nextAlarm } from '../lib/alarmTime';

// local time, whatever zone the tests run in
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe('wake-up alarm', () => {
  test('once: later today, or tomorrow when the time has passed', () => {
    expect(nextAlarm({ time: '07:30', days: [] }, at(2026, 11, 9, 6, 0))).toBe(at(2026, 11, 9, 7, 30));
    expect(nextAlarm({ time: '07:30', days: [] }, at(2026, 11, 9, 7, 30))).toBe(at(2026, 11, 10, 7, 30));
  });
  test('weekdays skip the weekend', () => {
    // Friday 2026-11-13 after the alarm → Monday the 16th
    expect(nextAlarm({ time: '06:45', days: [1, 2, 3, 4, 5] }, at(2026, 11, 13, 8))).toBe(at(2026, 11, 16, 6, 45));
  });
  test('a bad time gives nothing', () => {
    expect(nextAlarm({ time: '25:00', days: [] }, Date.now())).toBeUndefined();
    expect(nextAlarm({ time: '', days: [] }, Date.now())).toBeUndefined();
  });
  test('day names', () => {
    expect(daysText([5, 4, 3, 2, 1])).toBe('Weekdays');
    expect(daysText([0, 6])).toBe('Weekends');
    expect(daysText([])).toBe('Once');
    expect(daysText([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(daysText([2, 4])).toBe('Tue, Thu');
  });
  test('the fade-in starts quiet and reaches full volume', () => {
    expect(fadeInLevel(0, 60)).toBeCloseTo(0.05);
    expect(fadeInLevel(30, 60)).toBeGreaterThan(0.2);
    expect(fadeInLevel(30, 60)).toBeLessThan(0.5);
    expect(fadeInLevel(60, 60)).toBe(1);
    expect(fadeInLevel(5, 0)).toBe(1);
  });
});
