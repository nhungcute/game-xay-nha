import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hourFromTimestamp, lighting, loadTimeOfDayMode, saveTimeOfDayMode } from './dayCycle';

describe('day/night lighting', () => {
  it('uses the requested phase boundaries', () => {
    expect(lighting(5).night).toBe(1);
    expect(lighting(7).night).toBe(0);
    expect(lighting(17).night).toBe(0);
    expect(lighting(19).night).toBe(1);
  });
  it('transitions continuously through dawn and dusk', () => {
    for (const boundary of [5, 7, 17, 19]) {
      const before = lighting(boundary - 0.001).night, after = lighting(boundary + 0.001).night;
      expect(Math.abs(after - before)).toBeLessThan(0.01);
    }
    expect(lighting(6).night).toBeCloseTo(0.5, 3);
    expect(lighting(18).night).toBeCloseTo(0.5, 3);
  });
  it('matches day/night physical parameters at boundaries', () => {
    const nightState = lighting(5);
    expect(nightState.night).toBe(1);
    expect(nightState.sunIntensity).toBeCloseTo(0.62, 2);
    expect(nightState.hemisphereIntensity).toBeCloseTo(0.78, 2);
    expect(nightState.exposure).toBeCloseTo(0.78, 2);

    const dayState = lighting(7);
    expect(dayState.night).toBe(0);
    expect(dayState.sunIntensity).toBeCloseTo(2.1, 2);
    expect(dayState.hemisphereIntensity).toBeCloseTo(1.25, 2);
    expect(dayState.exposure).toBeCloseTo(0.85, 2);

    const duskStart = lighting(17);
    expect(duskStart.night).toBe(0);
    expect(duskStart.sunIntensity).toBeCloseTo(2.1, 2);

    const nightSettled = lighting(19);
    expect(nightSettled.night).toBe(1);
    expect(nightSettled.sunIntensity).toBeCloseTo(0.62, 2);
  });
  it('supports forced day and night modes regardless of hour', () => {
    expect(lighting(22, 'day').night).toBe(0);
    expect(lighting(22, 'day').sunIntensity).toBeCloseTo(2.1, 2);
    expect(lighting(12, 'night').night).toBe(1);
    expect(lighting(12, 'night').sunIntensity).toBeCloseTo(0.62, 2);
    expect(lighting(0, 'day').night).toBe(0);
    expect(lighting(13, 'night').night).toBe(1);
  });
  it('wraps negative hours and hours above 24 smoothly', () => {
    expect(lighting(-1).night).toBe(lighting(23).night);
    expect(lighting(25).night).toBe(lighting(1).night);
    expect(lighting(48 + 13).night).toBe(lighting(13).night);
  });
  it('tints unlit materials like lit surfaces: neutral by day, dark moonlit blue at night, monotonic at dusk', () => {
    expect(lighting(13).unlitTint).toEqual([1, 1, 1]);
    expect(lighting(22, 'day').unlitTint).toEqual([1, 1, 1]);
    const [red, green, blue] = lighting(22).unlitTint;
    // Lit terrain measured ~11% of its 13:00 luminance at 22:00; unlit foliage must follow, not stay at ~57%.
    expect(0.2126 * red + 0.7152 * green + 0.0722 * blue).toBeGreaterThan(0.05);
    expect(0.2126 * red + 0.7152 * green + 0.0722 * blue).toBeLessThan(0.2);
    expect(blue).toBeGreaterThan(green); expect(green).toBeGreaterThan(red);
    expect(lighting(12, 'night').unlitTint).toEqual(lighting(22).unlitTint);
    let previous = 1;
    for (let hour = 17; hour <= 19; hour += 0.25) {
      const luma = lighting(hour).unlitTint[1];
      expect(luma).toBeLessThanOrEqual(previous + 1e-9);
      previous = luma;
    }
  });
  it('computes hour from timestamp accurately', () => {
    // 2026-10-12T13:30:00 local time
    const date = new Date(2026, 9, 12, 13, 30, 0);
    expect(hourFromTimestamp(date.getTime())).toBeCloseTo(13.5, 3);
  });
});

describe('time-of-day mode persistence', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      clear: () => store.clear(),
    });
  });
  it('defaults to auto when no preference is saved', () => {
    expect(loadTimeOfDayMode()).toBe('auto');
  });
  it('persists and loads valid modes', () => {
    saveTimeOfDayMode('night');
    expect(loadTimeOfDayMode()).toBe('night');
    saveTimeOfDayMode('day');
    expect(loadTimeOfDayMode()).toBe('day');
    saveTimeOfDayMode('auto');
    expect(loadTimeOfDayMode()).toBe('auto');
  });
  it('recovers gracefully from corrupt storage or storage exception', () => {
    store.set('xay-nha.time-of-day', 'invalid-mode');
    expect(loadTimeOfDayMode()).toBe('auto');

    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError: localStorage blocked'); },
      setItem: () => { throw new Error('SecurityError: localStorage blocked'); },
    });
    expect(loadTimeOfDayMode()).toBe('auto');
    expect(() => saveTimeOfDayMode('night')).not.toThrow();
  });
});
