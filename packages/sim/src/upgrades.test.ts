import { describe, expect, it } from 'vitest';
import {
  Surface, cellIndex, decodeUint8, encodeInt16, encodeUint8,
  type Cell, type CommandPayload, type CommandType, type MapKind, type PlacedBuilding, type WorldSnapshot,
} from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { createTestTemplate } from '@xay-nha/worldgen';
import { costValue, netWorth, populationAndJobs, recompute } from './economy';
import { execute } from './engine';
import { storageCapacity } from './farm';
import { validateSnapshot } from './snapshot';
import { createState, rebuildOccupancy, writeDeltas, type SimState } from './state';
import { reliefAvailable, upgradeCost, upgradeSeconds } from './upgrades';

const NOW = 10_000_000_000, HOUR = 3_600_000;

function setup(mapKind: MapKind = 'city', level = 20): SimState {
  const template = createTestTemplate(mapKind);
  template.water = { lakes: [], rivers: [], waterfalls: [] };
  template.env = { catalogVersion: 1, anchors: [], scatter: [] };
  const surface = decodeUint8(template.layers.surface);
  surface.forEach((value, index) => { if (value === Surface.WATER) surface[index] = Surface.GRASS; });
  template.layers.surface = encodeUint8(surface);
  template.layers.heightsDm = encodeInt16(new Int16Array(129 * 129).fill(20));
  const s = createState(template, NOW);
  s.snapshot.wallet = { cash: 1_000_000, wood: 1000, stone: 1000 };
  s.snapshot.progress = { xp: economy.xp.cumulative[mapKind][level]!, level, questIndex: 12, questProgress: {}, tutorialDone: true };
  for (let x = 49; x <= 79; x++) { s.roadTier[cellIndex(x, 70)] = 1; s.surface[cellIndex(x, 70)] = Surface.ROAD; }
  // The farm test map enters at [70,79]; join it to the shared road.
  if (mapKind === 'farm') for (let z = 71; z <= 79; z++) { s.roadTier[cellIndex(70, z)] = 1; s.surface[cellIndex(70, z)] = Surface.ROAD; }
  writeDeltas(s);
  recompute(s);
  return s;
}
function building(s: SimState, defId: string, anchor: Cell): PlacedBuilding {
  const def = catalog.buildings[defId]!;
  const b: PlacedBuilding = {
    id: `b_${s.snapshot.buildings.length}`, defId, anchor, rotation: 0, status: 'ACTIVE',
    placedAt: NOW - def.buildSeconds * 1000, buildEndsAt: NOW,
    cashPaid: def.cost.cash, materialsPaid: { ...def.cost }, investedValue: costValue(def.cost),
    ...(s.snapshot.mapKind === 'city' ? { accrued: 0, settledAt: NOW } : {}),
    ...(def.production ? { slots: Array.from({ length: def.production.slots }, () => []) } : {}),
  };
  s.snapshot.buildings.push(b); rebuildOccupancy(s); recompute(s);
  return b;
}
function run<T extends CommandType>(s: SimState, type: T, payload: CommandPayload[T], now: number) {
  return execute(s, { type, payload, worldId: s.snapshot.worldId, expectedRevision: s.snapshot.revision,
    commandId: `00000000-0000-4000-8000-${String(s.snapshot.revision).padStart(12, '0')}`, clientTime: now }, now);
}
function ok<T extends CommandType>(s: SimState, type: T, payload: CommandPayload[T], now: number): SimState {
  const result = run(s, type, payload, now);
  expect(result.result.accepted ? 'accepted' : result.result).toBe('accepted');
  return result.state;
}
function rejected<T extends CommandType>(s: SimState, type: T, payload: CommandPayload[T], now: number, code: string): void {
  const result = run(s, type, payload, now);
  expect(result.result.accepted ? 'accepted' : result.result.code).toBe(code);
}
const find = (s: SimState, id: string) => s.snapshot.buildings.find(b => b.id === id)!;
function valid(s: SimState, now: number): void {
  const result = validateSnapshot(s, JSON.parse(JSON.stringify(s.snapshot)) as WorldSnapshot, now);
  expect(result.ok ? 'ok' : result.errors).toBe('ok');
}

describe('building upgrades (D028, docs/16 §6.5)', () => {
  it('tier 2 costs 2.5× and takes 2× the build time; the building keeps earning, then earns +50%', () => {
    let s = setup();
    const house = building(s, 'house_small', [50, 68]), def = catalog.buildings.house_small!;
    const baseRate = s.rates[house.id]!, basePopulation = populationAndJobs(s).population, wallet = s.snapshot.wallet.cash, xp = s.snapshot.progress.xp;
    expect(baseRate).toBeGreaterThan(0);
    expect(upgradeCost(def, 2)).toEqual({ cash: 750, wood: 13, stone: 0 });
    s = ok(s, 'UPGRADE_BUILDING', { buildingId: house.id }, NOW);
    const upgrading = find(s, house.id);
    expect(upgrading.upgrade).toEqual({ tier: 2, startedAt: NOW, endsAt: NOW + upgradeSeconds(def, 2) * 1000 });
    expect(upgradeSeconds(def, 2)).toBe(60);
    expect(s.snapshot.wallet.cash).toBe(wallet - 750);
    expect(s.rates[house.id]).toBe(baseRate);
    valid(s, NOW);
    s = ok(s, 'BUY_MATERIAL', { wood: 1 }, NOW + HOUR);
    const done = find(s, house.id);
    expect(done.tier).toBe(2); expect(done.upgrade).toBeUndefined();
    expect(s.rates[house.id]).toBeCloseTo(baseRate * 1.5);
    expect(populationAndJobs(s).population).toBe(Math.round(basePopulation * 1.5));
    expect(s.snapshot.progress.xp).toBeGreaterThan(xp);
    // Income before endsAt used the old rate, after it the new one.
    const before = 60 / 3600 * baseRate, after = (HOUR - 60_000) / HOUR * baseRate * 1.5;
    expect(done.accrued).toBeCloseTo(before + after, 3);
    valid(s, NOW + HOUR);
  });
  it('tier gates: level 10 for tier 2, 15 for tier 3, nothing above 3, decorations never', () => {
    let s = setup('city', 9);
    const house = building(s, 'house_small', [50, 68]);
    rejected(s, 'UPGRADE_BUILDING', { buildingId: house.id }, NOW, 'LEVEL_REQUIRED');
    s = setup('city', 14);
    const shop = building(s, 'shop_grocery', [50, 68]);
    s = ok(s, 'UPGRADE_BUILDING', { buildingId: shop.id }, NOW);
    rejected(s, 'UPGRADE_BUILDING', { buildingId: shop.id }, NOW + 1, 'UNDER_CONSTRUCTION');
    s = ok(s, 'SPEED_UP', { buildingId: shop.id }, NOW + 1);
    rejected(s, 'UPGRADE_BUILDING', { buildingId: shop.id }, NOW + 2, 'LEVEL_REQUIRED');
    s = setup('city', 20);
    const top = building(s, 'shop_grocery', [50, 68]); top.tier = 3;
    rejected(s, 'UPGRADE_BUILDING', { buildingId: top.id }, NOW, 'NOT_UPGRADEABLE');
    const park = building(s, 'deco_garden', [60, 68]);
    rejected(s, 'UPGRADE_BUILDING', { buildingId: park.id }, NOW, 'NOT_UPGRADEABLE');
  });
  it('an upgrade holds a builder', () => {
    let s = setup('city', 10);
    const ids = [[50, 68], [53, 68], [56, 68], [59, 68], [62, 68]].map(cell => building(s, 'house_small', cell as Cell).id);
    for (const id of ids.slice(0, 4)) s = ok(s, 'UPGRADE_BUILDING', { buildingId: id }, NOW);
    rejected(s, 'UPGRADE_BUILDING', { buildingId: ids[4]! }, NOW, 'NO_BUILDER_FREE');
    rejected(s, 'PLACE_BUILDING', { defId: 'house_small', anchor: [65, 68], rotation: 0 }, NOW, 'NO_BUILDER_FREE');
    valid(s, NOW);
  });
  it('cancel refunds the upgrade in full; demolition waits for it, then refunds 50% of base and tiers', () => {
    let s = setup();
    const house = building(s, 'house_small', [50, 68]), cash = s.snapshot.wallet.cash, wood = s.snapshot.wallet.wood;
    s = ok(s, 'UPGRADE_BUILDING', { buildingId: house.id }, NOW);
    rejected(s, 'DEMOLISH', { buildingId: house.id }, NOW + 1, 'UNDER_CONSTRUCTION');
    s = ok(s, 'CANCEL_CONSTRUCTION', { buildingId: house.id }, NOW + 1);
    expect(s.snapshot.wallet).toMatchObject({ cash, wood });
    expect(find(s, house.id).upgrade).toBeUndefined(); expect(find(s, house.id).tier).toBeUndefined();
    s = ok(s, 'UPGRADE_BUILDING', { buildingId: house.id }, NOW + 2);
    s = ok(s, 'BUY_MATERIAL', { wood: 1 }, NOW + HOUR);
    const worth = netWorth(s), beforeDemolish = s.snapshot.wallet.cash, accrued = Math.floor(find(s, house.id).accrued ?? 0);
    s = ok(s, 'DEMOLISH', { buildingId: house.id }, NOW + HOUR);
    expect(s.snapshot.wallet.cash - beforeDemolish - accrued).toBe(Math.floor((300 + 750) * economy.construction.refund));
    expect(worth).toBeGreaterThan(netWorth(s));
  });
  it('speed-up is priced from the upgrade cost and finishes at once', () => {
    let s = setup();
    const shop = building(s, 'shop_cafe', [50, 68]), cost = upgradeCost(catalog.buildings.shop_cafe!, 2);
    s = ok(s, 'UPGRADE_BUILDING', { buildingId: shop.id }, NOW);
    const total = upgradeSeconds(catalog.buildings.shop_cafe!, 2) * 1000, cash = s.snapshot.wallet.cash;
    s = ok(s, 'SPEED_UP', { buildingId: shop.id }, NOW + total / 2);
    expect(cash - s.snapshot.wallet.cash).toBe(Math.ceil(economy.construction.speedupPct * cost.cash / 2));
    expect(find(s, shop.id).tier).toBe(2);
  });
  it('producers gain a production line per tier; storage bonus scales with the tier', () => {
    let s = setup('farm');
    const mill = building(s, 'rice_mill', [50, 67]), silo = building(s, 'silo', [55, 68]);
    const base = storageCapacity(s);
    expect(base).toBe(economy.farm.baseStorage + 100);
    s = ok(s, 'UPGRADE_BUILDING', { buildingId: mill.id }, NOW);
    s = ok(s, 'UPGRADE_BUILDING', { buildingId: silo.id }, NOW);
    s = ok(s, 'BUY_MATERIAL', { wood: 1 }, NOW + 10 * HOUR);
    expect(find(s, mill.id).slots).toHaveLength(4);
    expect(storageCapacity(s)).toBe(base + 50);
    valid(s, NOW + 10 * HOUR);
    s = ok(s, 'UPGRADE_BUILDING', { buildingId: mill.id }, NOW + 10 * HOUR);
    s = ok(s, 'SPEED_UP', { buildingId: mill.id }, NOW + 10 * HOUR + 1);
    expect(find(s, mill.id).slots).toHaveLength(5);
    expect(economy.farm.baseStorage).toBe(100);
  });
  it('snapshot validation rejects forged tiers and upgrades', () => {
    const s = setup('city', 12);
    const house = building(s, 'house_small', [50, 68]);
    const check = (mutate: (b: PlacedBuilding) => void, code: string) => {
      const snapshot = JSON.parse(JSON.stringify(s.snapshot)) as WorldSnapshot;
      mutate(snapshot.buildings.find(b => b.id === house.id)!);
      const result = validateSnapshot(s, snapshot, NOW);
      expect(result.ok ? 'ok' : result.errors.some(error => error.startsWith(code))).toBe(true);
    };
    check(b => { b.tier = 3; }, 'UPGRADE_TIER');
    check(b => { b.upgrade = { tier: 3, startedAt: NOW, endsAt: NOW + 60_000 }; }, 'UPGRADE_TIER');
    check(b => { b.upgrade = { tier: 2, startedAt: NOW, endsAt: NOW + 10 * HOUR }; }, 'UPGRADE_TIME');
    check(b => { b.upgrade = { tier: 2, startedAt: NOW - 60_000, endsAt: NOW }; }, 'UPGRADE_TIME');
  });
});

describe('collect all without a bank (D028)', () => {
  it('an empty COLLECT gathers every business', () => {
    let s = setup();
    const a = building(s, 'house_small', [50, 68]), b = building(s, 'shop_grocery', [53, 68]);
    s = ok(s, 'BUY_MATERIAL', { wood: 1 }, NOW + HOUR);
    const waiting = Math.floor(find(s, a.id).accrued!) + Math.floor(find(s, b.id).accrued!), cash = s.snapshot.wallet.cash;
    expect(waiting).toBeGreaterThan(0);
    s = ok(s, 'COLLECT', { buildingIds: [] }, NOW + HOUR);
    expect(s.snapshot.wallet.cash - cash).toBe(waiting);
  });
});

describe('emergency relief (D028, docs/16 §9.1)', () => {
  it('pays once per cooldown to a city with little cash and no income', () => {
    let s = setup();
    s.snapshot.wallet.cash = economy.relief.cashBelow - 1;
    expect(reliefAvailable(s, NOW)).toBe(true);
    s = ok(s, 'CLAIM_RELIEF', {}, NOW);
    expect(s.snapshot.wallet.cash).toBe(economy.relief.cashBelow - 1 + economy.relief.amount);
    expect(s.snapshot.progress.reliefAt).toBe(NOW);
    valid(s, NOW);
    s.snapshot.wallet.cash = 0;
    rejected(s, 'CLAIM_RELIEF', {}, NOW + HOUR, 'RELIEF_UNAVAILABLE');
    s = ok(s, 'CLAIM_RELIEF', {}, NOW + economy.relief.cooldownHours * HOUR);
  });
  it('is refused with enough cash, or while something earns', () => {
    const s = setup();
    rejected(s, 'CLAIM_RELIEF', {}, NOW, 'RELIEF_UNAVAILABLE');
    s.snapshot.wallet.cash = 0;
    building(s, 'house_small', [50, 68]);
    rejected(s, 'CLAIM_RELIEF', {}, NOW, 'RELIEF_UNAVAILABLE');
    const farm = setup('farm');
    farm.snapshot.wallet.cash = 0; farm.snapshot.inventory.rice = 1;
    rejected(farm, 'CLAIM_RELIEF', {}, NOW, 'RELIEF_UNAVAILABLE');
    farm.snapshot.inventory.rice = 0;
    expect(reliefAvailable(farm, NOW)).toBe(true);
  });
});
