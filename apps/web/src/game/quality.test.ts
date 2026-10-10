import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepInLow, loadQuality, pixelRatio, saveQuality } from './quality';

const media = (coarse: boolean) => vi.stubGlobal('matchMedia', (query: string) => ({ matches: coarse && query.includes('coarse') }));
const store = () => { const data = new Map<string, string>(); vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }); };

describe('graphics quality (docs/11 §8 low-graphics mode)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('defaults to low on touch devices and high on desktop, then remembers the choice', () => {
    store(); media(true); expect(loadQuality()).toBe('low');
    media(false); expect(loadQuality()).toBe('high');
    saveQuality('low'); expect(loadQuality()).toBe('low');
  });
  it('still works when storage is blocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    media(false); expect(loadQuality()).toBe('high'); expect(() => saveQuality('low')).not.toThrow();
  });
  it('caps the pixel ratio (desktop 2 / 1.5, mobile 1.5 / 1.25)', () => {
    media(false); expect(pixelRatio('high', 3)).toBe(2); expect(pixelRatio('low', 3)).toBe(1.5); expect(pixelRatio('high', 1)).toBe(1);
    media(true); expect(pixelRatio('high', 3)).toBe(1.5); expect(pixelRatio('low', 3)).toBe(1.25);
  });
  it('keeps trees and rocks, drops flowers and reeds, keeps about half the bushes deterministically', () => {
    expect(keepInLow('tree_conifer_01', 'e1')).toBe(true); expect(keepInLow('rock_02', 'e1')).toBe(true);
    expect(keepInLow('flower_01', 'e1')).toBe(false); expect(keepInLow('reed_03', 'e1')).toBe(false);
    const kept = Array.from({ length: 400 }, (_, i) => keepInLow('bush_01', `env_${i}`)).filter(Boolean).length;
    expect(kept).toBeGreaterThan(140); expect(kept).toBeLessThan(260);
    expect(keepInLow('bush_01', 'env_7')).toBe(keepInLow('bush_01', 'env_7'));
  });
});
