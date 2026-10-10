import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestTemplate } from '@xay-nha/worldgen';
import { cloneState, createState } from '@xay-nha/sim';
import { commandSounds, SoundEffects, tickSounds } from './audio';

const NOW = 1_000_000;
const building = (status: 'CONSTRUCTING' | 'ACTIVE') => ({ id: 'b_1', defId: 'farmhouse', anchor: [72, 50] as [number, number], rotation: 0 as const, status,
  placedAt: NOW - 60_000, buildEndsAt: NOW, cashPaid: 500, materialsPaid: { cash: 500, wood: 10, stone: 5 }, investedValue: 750 });

describe('sound effects (docs/13 §4.8)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('maps command results to sounds; any rejection is the error sound', () => {
    const s = createState(createTestTemplate('farm'), NOW);
    expect(commandSounds('CLEAR_ENV', true, s, s)).toEqual(['chop']);
    expect(commandSounds('COLLECT', true, s, s)).toEqual(['coin']);
    expect(commandSounds('HARVEST', true, s, s)).toEqual(['harvest']);
    expect(commandSounds('PLACE_BUILDING', false, s, s)).toEqual(['error']);
    expect(commandSounds('REROLL_QUEST', true, s, s)).toEqual([]);
  });
  it('construction finishing and levelling up are heard, also when time passes', () => {
    const before = createState(createTestTemplate('farm'), NOW); before.snapshot.buildings.push(building('CONSTRUCTING'));
    const after = cloneState(before); after.snapshot.buildings[0]!.status = 'ACTIVE'; after.snapshot.progress.level = 2;
    expect(tickSounds(before, after)).toEqual(['complete', 'levelUp']);
    expect(commandSounds('CLAIM_QUEST', true, before, after)).toEqual(['coin', 'complete', 'levelUp']);
    const placed = cloneState(before); placed.snapshot.buildings.push({ ...building('ACTIVE'), id: 'b_new' });
    expect(tickSounds(before, placed)).toEqual([]); // an instantly active new building is the "build" sound, not "complete"
  });
  it('mute is remembered and muted play never creates an AudioContext', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
    const ctor = vi.fn(); vi.stubGlobal('AudioContext', ctor);
    const sfx = new SoundEffects(); expect(sfx.muted).toBe(false);
    sfx.setMuted(true); sfx.play(['coin']);
    expect(ctor).not.toHaveBeenCalled();
    expect(new SoundEffects().muted).toBe(true);
  });
  it('plays nothing (and does not throw) where WebAudio is missing', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
    vi.stubGlobal('AudioContext', undefined);
    expect(() => new SoundEffects().play(['levelUp'])).not.toThrow();
  });
});

describe('ambience water proximity', () => {
  it('is 1 on the shore, fades with distance and is 0 beyond the radius', async () => {
    const { waterNearby } = await import('./audio');
    const { GRID, Surface, cellIndex } = await import('@xay-nha/contracts');
    const surface = new Uint8Array(GRID * GRID);
    surface[cellIndex(60, 60)] = Surface.WATER;
    expect(waterNearby(surface, 60, 60)).toBe(1);
    expect(waterNearby(surface, 66, 60)).toBeCloseTo(0.5);
    expect(waterNearby(surface, 80, 60)).toBe(0);
    expect(waterNearby(surface, 0, 0)).toBe(0);
  });
});
