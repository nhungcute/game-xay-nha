import { describe, expect, it } from 'vitest';
import {
  CellFlag, GRID, Surface, cellIndex, decodeUint8, encodeInt16, encodeUint8,
  type Cell, type CommandPayload, type CommandType, type MapKind, type PlacedBuilding,
} from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { createTestTemplate } from '@xay-nha/worldgen';
import { addXp, cashXp, RuleError } from './common';
import { advanceTime, capHours, costValue, distance, netWorth, populationAndJobs, recompute, settle } from './economy';
import { execute } from './engine';
import { createState, rebuildOccupancy, type SimState } from './state';

const NOW = 10_000_000_000;
const HOUR = 3_600_000;

function initial(mapKind: MapKind = 'city'): SimState {
  // A flat economy fixture isolates timing and rate formulas from terrain constraints.
  const template = createTestTemplate(mapKind);
  template.water = { lakes: [], rivers: [], waterfalls: [] };
  template.env = { catalogVersion: 1, anchors: [], scatter: [] };
  const surface = decodeUint8(template.layers.surface);
  surface.forEach((value, index) => { if (value === Surface.WATER) surface[index] = Surface.GRASS; });
  template.layers.surface = encodeUint8(surface);
  template.layers.heightsDm = encodeInt16(new Int16Array(129 * 129).fill(20));
  return createState(template, NOW);
}
function setup(): SimState {
  const s = initial();
  s.snapshot.wallet = { cash: 1_000_000, wood: 1000, stone: 1000 };
  s.snapshot.progress = { xp: economy.xp.cumulative.city[20]!, level: 20, questIndex: 12, questProgress: {}, tutorialDone: true };
  for (let x = 49; x <= 110; x++) {
    s.roadTier[cellIndex(x, 70)] = 1;
    s.surface[cellIndex(x, 70)] = Surface.ROAD;
  }
  recompute(s);
  return s;
}
function building(s: SimState, defId: string, anchor: Cell, status: 'ACTIVE' | 'CONSTRUCTING' = 'ACTIVE', endsAt = NOW): PlacedBuilding {
  const def = catalog.buildings[defId]!;
  const b: PlacedBuilding = {
    id: `b_${s.snapshot.buildings.length}`, defId, anchor, rotation: 0,
    status, placedAt: endsAt - def.buildSeconds * 1000, buildEndsAt: endsAt,
    cashPaid: def.cost.cash, materialsPaid: { ...def.cost }, investedValue: costValue(def.cost),
    accrued: 0, settledAt: NOW,
  };
  s.snapshot.buildings.push(b);
  rebuildOccupancy(s);
  recompute(s);
  return b;
}
function apply<T extends CommandType>(s: SimState, type: T, payload: CommandPayload[T], now: number): SimState {
  const result = execute(s, { type, payload, worldId: s.snapshot.worldId, expectedRevision: s.snapshot.revision,
    commandId: `00000000-0000-4000-8000-${String(s.snapshot.revision).padStart(12, '0')}`, clientTime: now }, now);
  expect(result.result.accepted).toBe(true);
  return result.state;
}

describe('income rates and spatial bonuses', () => {
  it('applies min(1,population/jobs) only to employers', () => {
    const s = setup(), house = building(s, 'house_small', [48, 68]);
    const first = building(s, 'shop_grocery', [52, 68]), second = building(s, 'shop_grocery', [55, 68]);
    expect(populationAndJobs(s)).toEqual({ population: 4, jobs: 6 });
    expect(s.rates[house.id]).toBe(170);
    expect(s.rates[first.id]).toBeCloseTo(380 * 4 / 6);
    expect(s.rates[second.id]).toBeCloseTo(380 * 4 / 6);
  });
  it('caps labour efficiency at 100% and grants none without population', () => {
    const s = setup(), shop = building(s, 'shop_grocery', [52, 68]);
    expect(s.rates[shop.id]).toBe(0);
    building(s, 'house_small', [48, 68]);
    expect(s.rates[shop.id]).toBe(380);
    building(s, 'house_small', [55, 68]);
    expect(s.rates[shop.id]).toBe(380);
  });
  it('excludes constructing and disconnected population/jobs/bonuses', () => {
    const s = setup(), house = building(s, 'house_small', [48, 68], 'CONSTRUCTING', NOW + 30_000);
    building(s, 'shop_grocery', [52, 68]);
    building(s, 'deco_garden', [48, 67]);
    expect(populationAndJobs(s)).toEqual({ population: 0, jobs: 3 });
    expect(s.rates[house.id]).toBe(0);
  });
  it('disconnected buildings earn no income', () => {
    const s = setup(), b = building(s, 'house_small', [72, 50]);
    expect(s.rates[b.id]).toBe(0);
    settle(s, NOW + HOUR);
    expect(b.accrued).toBe(0);
  });
  it.each([[1, 1], [2, 1.1], [3, 1.2]] as const)('connected tier %s multiplies income by %s', (tier, multiplier) => {
    const s = setup(), b = building(s, 'house_small', [52, 68]);
    s.roadTier[cellIndex(53, 70)] = tier;
    recompute(s);
    expect(s.rates[b.id]).toBeCloseTo(170 * multiplier);
  });
  it('uses highest connected adjacent tier, excluding an isolated higher tier', () => {
    const s = setup(), b = building(s, 'house_small', [52, 68]);
    s.roadTier[cellIndex(51, 68)] = 3; s.surface[cellIndex(51, 68)] = Surface.ROAD;
    recompute(s);
    expect(s.connected[cellIndex(51, 68)]).toBe(0);
    expect(s.rates[b.id]).toBe(170);
  });
  it('caps summed decoration at 30%', () => {
    const s = setup(), b = building(s, 'house_small', [52, 68]);
    for (const x of [48, 50, 51, 54, 55, 56, 57]) building(s, 'deco_garden', [x, 69]);
    expect(s.rates[b.id]).toBeCloseTo(170 * 1.3);
  });
  it('combines capped decoration, water and road multiplicatively to 1.68', () => {
    const s = setup(), b = building(s, 'house_small', [52, 68]);
    for (const x of [48, 50, 51, 54, 55, 56, 57]) building(s, 'deco_garden', [x, 69]);
    s.flags[cellIndex(52, 73)] = CellFlag.EMBANKED;
    s.surface[cellIndex(52, 74)] = Surface.WATER;
    s.roadTier[cellIndex(53, 70)] = 3;
    recompute(s);
    expect(s.rates[b.id]).toBeCloseTo(170 * 1.68);
  });
  it('measures water radius from any footprint cell and uses inclusive boundary', () => {
    const s = setup(), b = building(s, 'house_small', [52, 68]);
    s.flags[cellIndex(52, 74)] = CellFlag.EMBANKED;
    recompute(s); expect(s.rates[b.id]).toBe(170);
    s.flags[cellIndex(52, 74)] = 0; s.flags[cellIndex(52, 73)] = CellFlag.EMBANKED;
    recompute(s); expect(s.rates[b.id]).toBeCloseTo(187);
  });
  it('hotel overrides water bonus to 20%', () => {
    const s = setup(); building(s, 'house_apartment', [48, 66]);
    const hotel = building(s, 'hotel', [58, 65]);
    s.flags[cellIndex(58, 73)] = CellFlag.EMBANKED;
    recompute(s);
    expect(s.rates[hotel.id]).toBeCloseTo(7480 * 1.2);
  });
  it('computes footprint distance using Chebyshev distance', () => {
    expect(distance([[0, 0], [1, 1]], [[5, 4]])).toBe(4);
    expect(distance([[1, 1]], [[2, 2]])).toBe(1);
  });
});

describe('fake-clock settlement and ordered completion', () => {
  it('settles income in milliseconds and repeated settle at same time adds nothing', () => {
    const s = setup(), b = building(s, 'house_small', [52, 68]);
    settle(s, NOW); expect(b.accrued).toBe(0);
    settle(s, NOW + HOUR); expect(b.accrued).toBe(170);
    settle(s, NOW + HOUR); expect(b.accrued).toBe(170);
    settle(s, NOW + 3 * HOUR); expect(b.accrued).toBe(510);
  });
  it('stops accumulation at six hours without bank', () => {
    const s = setup(), b = building(s, 'house_small', [52, 68]);
    advanceTime(s, NOW + 24 * HOUR);
    expect(b.accrued).toBe(1020);
    advanceTime(s, NOW + 48 * HOUR);
    expect(b.accrued).toBe(1020);
  });
  it('never removes accrued money when the road is disconnected (rate drops to 0)', () => {
    const s = setup(), b = building(s, 'house_small', [52, 68]);
    advanceTime(s, NOW + 5 * HOUR);
    expect(b.accrued).toBe(850);
    for (let x = 49; x <= 110; x++) { s.roadTier[cellIndex(x, 70)] = 0; s.surface[cellIndex(x, 70)] = Surface.GRASS; }
    recompute(s);
    expect(s.rates[b.id]).toBe(0);
    advanceTime(s, NOW + 9 * HOUR);
    expect(b.accrued).toBe(850);
  });
  it('never removes accrued money when the cap shrinks below the stored amount', () => {
    const s = setup(), house = building(s, 'house_small', [48, 68]);
    const bank = building(s, 'bank', [52, 67]);
    advanceTime(s, NOW + 8 * HOUR);
    expect(capHours(s)).toBe(8);
    expect(house.accrued).toBe(170 * 8);
    s.snapshot.buildings.splice(s.snapshot.buildings.indexOf(bank), 1);
    rebuildOccupancy(s); recompute(s);
    expect(capHours(s)).toBe(6);
    advanceTime(s, NOW + 10 * HOUR);
    expect(house.accrued).toBe(170 * 8);
  });
  it('collect still works after a cap shrink, then accrual resumes up to the new cap', () => {
    let s = setup(); const house = building(s, 'house_small', [48, 68]);
    house.accrued = 170 * 8;
    s = apply(s, 'COLLECT', { buildingIds: [house.id] }, NOW + HOUR);
    const collected = s.snapshot.buildings.find(b => b.id === house.id)!;
    expect(collected.accrued).toBeLessThan(1);
    advanceTime(s, NOW + 20 * HOUR);
    expect(collected.accrued).toBeCloseTo(170 * 6, 6);
  });
  it.each([[0, 6], [1, 8], [2, 10], [3, 12], [4, 14], [5, 14]])('%s connected banks give cap %s hours', (count, expected) => {
    const s = setup();
    for (let i = 0; i < count; i++) building(s, 'bank', [52 + i * 4, 67]);
    expect(capHours(s)).toBe(expected);
  });
  it('constructing and disconnected banks do not increase cap', () => {
    const s = setup();
    building(s, 'bank', [52, 67], 'CONSTRUCTING', NOW + 1_800_000);
    building(s, 'bank', [72, 50]);
    expect(capHours(s)).toBe(6);
  });
  it('settles old six-hour cap before bank completion then accrues under new eight-hour cap', () => {
    const s = setup(), house = building(s, 'house_small', [48, 68]);
    house.accrued = 1020;
    const bank = building(s, 'bank', [52, 67], 'CONSTRUCTING', NOW + HOUR / 2);
    advanceTime(s, NOW + HOUR);
    expect(bank.status).toBe('ACTIVE');
    expect(capHours(s)).toBe(8);
    expect(house.accrued).toBe(1020 + 170 / 2);
  });
  it('orders two completions by timestamp even when snapshot array is reversed', () => {
    const s = setup();
    const shop = building(s, 'shop_grocery', [52, 68], 'CONSTRUCTING', NOW + 60_000);
    const house = building(s, 'house_small', [48, 68], 'CONSTRUCTING', NOW + 30_000);
    const beforeXp = s.snapshot.progress.xp;
    advanceTime(s, NOW + 120_000);
    expect(house.accrued).toBeCloseTo(170 * 90 / 3600);
    expect(shop.accrued).toBeCloseTo(380 * 60 / 3600);
    expect(s.snapshot.progress.xp - beforeXp).toBe(39 + 48);
  });
  it('applies decoration only after exact construction completion timestamp', () => {
    const s = setup(), house = building(s, 'house_small', [52, 68]);
    building(s, 'deco_park', [55, 67], 'CONSTRUCTING', NOW + 600_000);
    advanceTime(s, NOW + 3 * HOUR);
    expect(house.accrued).toBeCloseTo(170 * 10 / 60 + 187 * (3 - 10 / 60));
  });
  it('settles before demolition changes decoration and preserves fractional collect remainder', () => {
    let s = setup(); building(s, 'house_small', [52, 68]);
    const garden = building(s, 'deco_garden', [54, 69]);
    const houseId = s.snapshot.buildings[0]!.id;
    s = apply(s, 'DEMOLISH', { buildingId: garden.id }, NOW + HOUR);
    expect(s.snapshot.buildings[0]!.accrued).toBeCloseTo(178.5);
    const before = s.snapshot.wallet.cash;
    s = apply(s, 'COLLECT', { buildingIds: [houseId] }, NOW + 3 * HOUR);
    expect(s.snapshot.wallet.cash - before).toBe(518);
    expect(s.snapshot.buildings[0]!.accrued).toBeCloseTo(0.5);
    expect(Number.isInteger(s.snapshot.wallet.cash)).toBe(true);
  });
  it('completes at boundary without granting precompletion income and cannot repeat XP', () => {
    const s = setup(), b = building(s, 'house_small', [52, 68], 'CONSTRUCTING', NOW + 30_000);
    const xp = s.snapshot.progress.xp;
    advanceTime(s, NOW + 29_999); expect(b.status).toBe('CONSTRUCTING'); expect(s.snapshot.progress.xp).toBe(xp);
    advanceTime(s, NOW + 30_000); expect(b.status).toBe('ACTIVE'); expect(b.accrued).toBe(0);
    expect(s.snapshot.progress.xp).toBe(xp + 39);
    advanceTime(s, NOW + 30_000); expect(s.snapshot.progress.xp).toBe(xp + 39);
  });
  it('rejects backward and fractional clocks', () => {
    const s = setup(); building(s, 'house_small', [52, 68]);
    advanceTime(s, NOW + HOUR);
    expect(() => advanceTime(s, NOW)).toThrow(RuleError);
    expect(() => advanceTime(s, NOW + HOUR + 0.5)).toThrow(RuleError);
  });

  it('grants production XP at readyAt without collection and never grants it again', () => {
    let s = initial('farm');
    s.snapshot.progress = { xp: economy.xp.cumulative.farm[20]!, level: 20, questIndex: 12, questProgress: {}, tutorialDone: true };
    for (let x = 70; x <= 80; x++) {
      s.roadTier[cellIndex(x, 79)] = 1;
      s.surface[cellIndex(x, 79)] = Surface.ROAD;
    }
    const mill = building(s, 'rice_mill', [72, 76]);
    const recipe = catalog.recipes.rice_mill!;
    mill.slots = [[{ recipeId: recipe.id, startedAt: NOW, readyAt: NOW + recipe.seconds * 1000 }], [], []];
    const xp = s.snapshot.progress.xp;
    advanceTime(s, NOW + recipe.seconds * 1000 - 1);
    expect(s.snapshot.progress.xp).toBe(xp);
    advanceTime(s, NOW + recipe.seconds * 1000);
    expect(s.snapshot.progress.xp).toBe(xp + recipe.xp);
    expect(s.snapshot.inventory.flour).toBeUndefined();
    advanceTime(s, NOW + recipe.seconds * 1000);
    expect(s.snapshot.progress.xp).toBe(xp + recipe.xp);
    s = apply(s, 'COLLECT_PRODUCTION', { buildingId: mill.id }, NOW + recipe.seconds * 1000 + 1);
    expect(s.snapshot.inventory.flour).toBe(1);
    expect(s.snapshot.progress.xp).toBe(xp + recipe.xp);
    advanceTime(s, NOW + 2 * recipe.seconds * 1000);
    expect(s.snapshot.progress.xp).toBe(xp + recipe.xp);
  });
});

describe('XP tables and level cash rewards', () => {
  it('uses distinct city/farm level-three thresholds', () => {
    const city = initial('city'), farm = initial('farm');
    addXp(city, 120); addXp(farm, 120);
    expect(city.snapshot.progress.level).toBe(2);
    expect(farm.snapshot.progress.level).toBe(3);
    expect(city.snapshot.wallet.cash).toBe(2300);
    expect(farm.snapshot.wallet.cash).toBe(2750);
  });
  it('grants each crossed level once even for a large XP award', () => {
    const s = initial(); addXp(s, 340);
    expect(s.snapshot.progress.level).toBe(4);
    expect(s.snapshot.wallet.cash).toBe(2000 + 150 * (2 + 3 + 4));
    addXp(s, 0); expect(s.snapshot.wallet.cash).toBe(3350);
  });
  it('caps level at 20 while retaining accumulated integer XP', () => {
    const s = initial(); addXp(s, 500_000);
    expect(s.snapshot.progress.level).toBe(20);
    expect(s.snapshot.progress.xp).toBe(500_000);
    expect(s.snapshot.wallet.cash).toBe(2000 + 150 * 209);
  });
  it('carries fractional spend/collect XP across transactions', () => {
    const s = initial(); cashXp(s, 19, 'spend'); expect(s.snapshot.progress.xp).toBe(0);
    cashXp(s, 1, 'spend'); expect(s.snapshot.progress.xp).toBe(1);
    cashXp(s, 499, 'collect'); expect(s.snapshot.progress.xp).toBe(1);
    cashXp(s, 1, 'collect'); expect(s.snapshot.progress.xp).toBe(2);
  });
  it.each([-1, 0.5, NaN, Infinity])('rejects invalid XP amount %s', amount => {
    expect(() => addXp(initial(), amount)).toThrow(RuleError);
  });
});

describe('net worth and irreversible spending', () => {
  it.each(['city', 'farm'] as const)('new %s character starts with net worth $2500, excluding natural roads', mapKind => {
    const s = initial(mapKind);
    expect(s.baseRoadTier.some(Boolean)).toBe(true);
    expect(netWorth(s)).toBe(2500);
    recompute(s); expect(s.snapshot.character.netWorth).toBe(2500);
  });
  it('counts only purchased road increment when natural road is upgraded', () => {
    const s = initial(), entry = s.template.entryCells[0]!;
    s.roadTier[cellIndex(...entry)] = 2;
    expect(netWorth(s)).toBe(2500 + costValue(economy.roadTiers[2].cost) - costValue(economy.roadTiers[1].cost));
  });
  it('sums pending cash, invested construction, land, inventory and infrastructure', () => {
    const s = initial(), house = building(s, 'house_small', [52, 68], 'CONSTRUCTING', NOW + 30_000);
    house.accrued = 12.9;
    s.snapshot.landValue = 1000; s.snapshot.inventory.flour = 2;
    s.roadTier[cellIndex(52, 70)] = 1; s.surface[cellIndex(52, 70)] = Surface.ROAD;
    s.flags[cellIndex(53, 73)] = CellFlag.EMBANKED;
    s.snapshot.bridges.push({ id: 'br_1', typeId: 'bridge_wood', a: [72, 56], b: [75, 56], deckHeightDm: 20,
      placedAt: NOW, buildEndsAt: NOW + 120_000, status: 'CONSTRUCTING', cashPaid: 160,
      materialsPaid: { cash: 160, wood: 10, stone: 0 }, investedValue: 310 });
    expect(netWorth(s)).toBe(4452);
  });
  it('cancel preserves net worth because full actual cost is restored', () => {
    let s = setup(); const initialWorth = netWorth(s);
    s = apply(s, 'PLACE_BUILDING', { defId: 'house_small', anchor: [52, 68], rotation: 0 }, NOW);
    expect(netWorth(s)).toBe(initialWorth);
    s = apply(s, 'CANCEL_CONSTRUCTION', { buildingId: s.snapshot.buildings[0]!.id }, NOW);
    expect(netWorth(s)).toBe(initialWorth);
  });
  it('completed build-demolish loses cash/material value, accounting for floor refunds', () => {
    let s = setup(); const initialWorth = netWorth(s), initialCash = s.snapshot.wallet.cash;
    s = apply(s, 'PLACE_BUILDING', { defId: 'house_small', anchor: [52, 68], rotation: 0 }, NOW);
    const id = s.snapshot.buildings[0]!.id;
    s = apply(s, 'DEMOLISH', { buildingId: id }, NOW + 30_000);
    expect(s.snapshot.wallet.cash).toBe(initialCash - 150);
    expect(netWorth(s)).toBe(initialWorth - 195);
  });
  it('speed-up money is a sink and never raises building invested value', () => {
    let s = setup();
    s = apply(s, 'PLACE_BUILDING', { defId: 'house_small', anchor: [52, 68], rotation: 0 }, NOW);
    const initialWorth = netWorth(s), id = s.snapshot.buildings[0]!.id;
    s = apply(s, 'SPEED_UP', { buildingId: id }, NOW + 15_000);
    expect(s.snapshot.buildings[0]!.investedValue).toBe(375);
    expect(netWorth(s)).toBe(initialWorth - 75);
  });
  it('material purchase changes asset form without XP or net-worth gain', () => {
    let s = setup(); const beforeWorth = netWorth(s), beforeXp = s.snapshot.progress.xp;
    s = apply(s, 'BUY_MATERIAL', { wood: 3, stone: 2 }, NOW);
    expect(netWorth(s)).toBe(beforeWorth);
    expect(s.snapshot.progress.xp).toBe(beforeXp);
    expect(s.snapshot.wallet.wood).toBe(1003);
    expect(s.snapshot.wallet.stone).toBe(1002);
  });
  it('natural road count is irrelevant to starting assets', () => {
    const s = initial();
    for (let i = 0; i < GRID * GRID; i++) if (s.baseRoadTier[i]) { s.roadTier[i] = 0; s.surface[i] = Surface.GRASS; }
    expect(netWorth(s)).toBe(2500);
  });
});
