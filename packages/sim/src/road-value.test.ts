import { describe, expect, it } from 'vitest';
import { cellIndex, type CommandType } from '@xay-nha/contracts';
import { economy } from '@xay-nha/content';
import { createTestTemplate } from '@xay-nha/worldgen';
import { createState, writeDeltas, type SimState } from './state';
import { execute } from './engine';
import { costValue, netWorth, recompute } from './economy';
import { roadPaidKey, roadPaidValue } from './road-value';
import { stateHash, validateSnapshot } from './snapshot';

let sequence = 0;
const NOW = 1000000;
function state(): SimState {
  const result = createState(createTestTemplate(), NOW); result.snapshot.progress.level = 8;
  result.snapshot.progress.xp = economy.xp.cumulative.farm[8]!; result.snapshot.wallet.cash = 100000;
  result.snapshot.wallet.stone = 100; result.snapshot.unlockedZones.push(44);
  for (let z = 80; z < 96; z++) result.flags[cellIndex(70, z)] = 0;
  writeDeltas(result); recompute(result); return result;
}
function apply(s: SimState, type: CommandType, payload: unknown): SimState {
  const result = execute(s, { commandId: `00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, '0')}`,
    expectedRevision: s.snapshot.revision, worldId: s.snapshot.worldId, clientTime: NOW, type, payload }, NOW);
  expect(result.result.accepted, JSON.stringify(result.result)).toBe(true); return result.state;
}
const natural: [number, number] = [70, 80], fresh: [number, number] = [74, 74];
describe('actual paid value of remaining roads', () => {
  it('initial natural roads are free assets', () => {
    const initial = createState(createTestTemplate(), NOW);
    expect(netWorth(initial)).toBe(2500); expect(roadPaidValue(initial, cellIndex(...natural))).toBe(0);
  });
  it('new road and upgrades retain the total actual cash/material payment', () => {
    let s = state(); s = apply(s, 'BUILD_ROAD', { tier: 1, cells: [fresh] });
    expect(roadPaidValue(s, cellIndex(...fresh))).toBe(costValue(economy.roadTiers[1].cost));
    s = apply(s, 'BUILD_ROAD', { tier: 3, cells: [fresh] });
    expect(roadPaidValue(s, cellIndex(...fresh))).toBe(costValue(economy.roadTiers[3].cost));
  });
  it('upgrade on a free natural road counts only the paid tier difference', () => {
    let s = state(); s = apply(s, 'BUILD_ROAD', { tier: 2, cells: [natural] });
    expect(roadPaidValue(s, cellIndex(...natural))).toBe(costValue(economy.roadTiers[2].cost) - costValue(economy.roadTiers[1].cost));
    s = apply(s, 'BUILD_ROAD', { tier: 3, cells: [natural] });
    expect(roadPaidValue(s, cellIndex(...natural))).toBe(costValue(economy.roadTiers[3].cost) - costValue(economy.roadTiers[1].cost));
  });
  it('removed and rebuilt natural road counts its full new payment', () => {
    let s = state(); s = apply(s, 'REMOVE_ROAD', { cells: [natural] });
    expect(roadPaidValue(s, cellIndex(...natural))).toBe(0);
    s = apply(s, 'BUILD_ROAD', { tier: 1, cells: [natural] });
    expect(roadPaidValue(s, cellIndex(...natural))).toBe(costValue(economy.roadTiers[1].cost));
    s = apply(s, 'BUILD_ROAD', { tier: 3, cells: [natural] });
    expect(roadPaidValue(s, cellIndex(...natural))).toBe(costValue(economy.roadTiers[3].cost));
    const saved = JSON.parse(JSON.stringify(s.snapshot));
    const result = validateSnapshot(s, saved, NOW);
    expect(result.ok).toBe(true); if (result.ok) expect(stateHash(result.state)).toBe(stateHash(s));
  });
  it('removed road investment is deleted and repeated rebuilds never accumulate past remaining road value', () => {
    let s = state();
    for (let i = 0; i < 3; i++) {
      s = apply(s, 'BUILD_ROAD', { tier: 2, cells: [fresh] });
      expect(roadPaidValue(s, cellIndex(...fresh))).toBe(costValue(economy.roadTiers[2].cost));
      s = apply(s, 'REMOVE_ROAD', { cells: [fresh] });
      expect(s.snapshot.progress.questProgress[roadPaidKey(cellIndex(...fresh))]).toBeUndefined();
    }
  });
  it('payment metadata does not inflate the connected-road tutorial objective', () => {
    const s = createState(createTestTemplate('city'), NOW); s.snapshot.progress.questIndex = 1;
    const next = apply(s, 'BUILD_ROAD', { tier: 1, cells: [[48, 69]] });
    expect(next.snapshot.progress.questProgress['city-2']).toBe(1);
    expect(Object.keys(next.snapshot.progress.questProgress).filter(key => key.startsWith('road_'))).toHaveLength(1);
    expect(next.snapshot.progress.questProgress[roadPaidKey(cellIndex(48, 69))]).toBe(costValue(economy.roadTiers[1].cost));
  });
  it('rejects forged road value and orphaned payment metadata', () => {
    const s = apply(state(), 'BUILD_ROAD', { tier: 1, cells: [fresh] }), before = stateHash(s);
    for (const [key, paid] of [[roadPaidKey(cellIndex(...fresh)), 999], [roadPaidKey(cellIndex(10, 10)), 5]] as const) {
      const saved = JSON.parse(JSON.stringify(s.snapshot)); saved.progress.questProgress[key] = paid;
      const result = validateSnapshot(s, saved, NOW);
      expect(result.ok).toBe(false); if (!result.ok) expect(result.errors.some(error => error.startsWith('ROAD_PAYMENT'))).toBe(true);
    }
    expect(stateHash(s)).toBe(before);
  });
});

describe('removing roads refunds 50% of what was paid (docs/16 §5)', () => {
  it('a player-built road returns half its paid value in cash; a free template road returns nothing', () => {
    let s = state(); s = apply(s, 'BUILD_ROAD', { tier: 2, cells: [fresh] });
    const before = s.snapshot.wallet.cash;
    s = apply(s, 'REMOVE_ROAD', { cells: [fresh] });
    expect(s.snapshot.wallet.cash - before).toBe(Math.floor(costValue(economy.roadTiers[2].cost) * economy.construction.refund));
    const cash = s.snapshot.wallet.cash;
    s = apply(s, 'REMOVE_ROAD', { cells: [natural] });
    expect(s.snapshot.wallet.cash).toBe(cash);
  });
  it('build → remove never gains money', () => {
    let s = state(); const start = s.snapshot.wallet.cash + s.snapshot.wallet.stone * economy.materialPrices.stone + s.snapshot.wallet.wood * economy.materialPrices.wood;
    for (let i = 0; i < 3; i++) { s = apply(s, 'BUILD_ROAD', { tier: 3, cells: [fresh] }); s = apply(s, 'REMOVE_ROAD', { cells: [fresh] }); }
    const end = s.snapshot.wallet.cash + s.snapshot.wallet.stone * economy.materialPrices.stone + s.snapshot.wallet.wood * economy.materialPrices.wood;
    expect(end).toBeLessThan(start);
  });
});
