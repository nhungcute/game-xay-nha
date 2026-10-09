import { describe, expect, it } from 'vitest';
import { catalog, economy } from '@xay-nha/content';
import { createTestTemplate } from '@xay-nha/worldgen';
import { CellFlag, CommandSchema, Surface, cellIndex, vertIndex, type Cell, type Command, type PlacedBuilding } from '@xay-nha/contracts';
import { createState, type SimState } from './state';
import { footprintCells } from './footprint';
import { RuleError } from './common';
import { farm, fieldQuota, inventoryCount, storageCapacity } from './farm';

const now = 1_000_000;
const field: Cell = [74, 55];
function state(): SimState {
  const result = createState(createTestTemplate(), now, []);
  result.snapshot.wallet.cash = 100_000;
  result.snapshot.progress.level = economy.xp.maxLevel;
  result.snapshot.progress.xp = economy.xp.cumulative.farm[economy.xp.maxLevel]!;
  result.snapshot.progress.questIndex = catalog.quests.farm.length;
  result.snapshot.progress.tutorialDone = true;
  return result;
}
function cmd(type: Command['type'], payload: unknown): Command {
  return CommandSchema.parse({ commandId: '00000000-0000-4000-8000-000000000001', worldId: 'world-test',
    expectedRevision: 0, clientTime: now, type, payload });
}
function building(s: SimState, defId: string, anchor: Cell = [72, 70]): PlacedBuilding {
  const def = catalog.buildings[defId];
  if (!def) throw new Error(`Unknown test definition ${defId}`);
  const value: PlacedBuilding = { id: `b_${s.snapshot.buildings.length + 1}`, defId, anchor, rotation: 0,
    placedAt: now - def.buildSeconds * 1000, buildEndsAt: now, status: 'ACTIVE',
    cashPaid: def.cost.cash, materialsPaid: def.cost, investedValue: def.cost.cash,
  };
  s.snapshot.buildings.push(value);
  for (const cell of footprintCells(def, anchor, 0)) {
    s.occupancy.set(cellIndex(...cell), value.id);
    s.surface[cellIndex(...cell)] = Surface.FOUNDATION;
  }
  const road = cellIndex(anchor[0] - 1, anchor[1]);
  s.roadTier[road] = 1; s.connected[road] = 1;
  return value;
}
function tilled(s: SimState, cell: Cell = field): void { s.surface[cellIndex(...cell)] = Surface.TILLED; }
function grown(s: SimState, cell: Cell = field, cropId = 'veg_greens', readyAt = now): void {
  tilled(s, cell);
  s.snapshot.crops.push({ cell, cropId, plantedAt: readyAt - catalog.crops[cropId]!.growSeconds * 1000, readyAt });
  s.occupancy.set(cellIndex(...cell), `crop:${cellIndex(...cell)}`);
}
function expectError(s: SimState, command: Command, code: RuleError['code']): void {
  const snapshot = JSON.stringify(s.snapshot);
  const surface = s.surface.slice();
  expect(() => farm(s, command, now)).toThrowError(expect.objectContaining({ code }));
  expect(JSON.stringify(s.snapshot)).toBe(snapshot);
  expect(s.surface).toEqual(surface);
}

describe('farm support limits', () => {
  it('starts with zero field quota and the documented basic storage', () => {
    const s = state();
    expect(fieldQuota(s)).toBe(0);
    expect(storageCapacity(s)).toBe(economy.farm.baseStorage);
  });
  it('counts only completed, connected farmhouses', () => {
    const s = state(), b = building(s, 'farmhouse');
    expect(fieldQuota(s)).toBe(catalog.buildings.farmhouse!.fieldQuota);
    b.status = 'CONSTRUCTING'; expect(fieldQuota(s)).toBe(0);
    b.status = 'ACTIVE'; s.connected.fill(0); expect(fieldQuota(s)).toBe(0);
  });
  it('counts only completed, connected silos without changing held items', () => {
    const s = state(), b = building(s, 'silo');
    s.snapshot.inventory.rice = economy.farm.baseStorage + 1;
    expect(storageCapacity(s)).toBe(economy.farm.baseStorage + catalog.buildings.silo!.storageBonus!);
    b.status = 'CONSTRUCTING'; expect(storageCapacity(s)).toBe(economy.farm.baseStorage);
    expect(inventoryCount(s)).toBe(economy.farm.baseStorage + 1);
  });
  it('does not include wood and stone wallet resources in inventory usage', () => {
    const s = state(); s.snapshot.wallet.wood = 10000; s.snapshot.wallet.stone = 10000;
    s.snapshot.inventory = { rice: 4, egg: 3 };
    expect(inventoryCount(s)).toBe(7);
  });
});

describe('tilling and untilling', () => {
  it.each([Surface.GRASS, Surface.DIRT, Surface.SAND])('tills permitted natural surface %s', surface => {
    const s = state(); building(s, 'farmhouse'); s.surface[cellIndex(...field)] = surface;
    const before = s.snapshot.wallet.cash;
    farm(s, cmd('TILL', { rect: [...field, ...field] }), now);
    expect(s.surface[cellIndex(...field)]).toBe(Surface.TILLED);
    expect(s.snapshot.wallet.cash).toBe(before - economy.till.cost);
  });
  it('rejects tilling without a functioning farmhouse', () => {
    const s = state(); expectError(s, cmd('TILL', { rect: [...field, ...field] }), 'FIELD_LIMIT');
  });
  it('rejects an entire area when it exceeds field quota', () => {
    const s = state(); building(s, 'farmhouse');
    expectError(s, cmd('TILL', { rect: [70, 50, 74, 54] }), 'FIELD_LIMIT');
  });
  it('counts previous tilled cells toward field quota', () => {
    const s = state(); building(s, 'farmhouse');
    for (let x = 48; x < 72; x++) tilled(s, [x, 58]);
    expectError(s, cmd('TILL', { rect: [...field, ...field] }), 'FIELD_LIMIT');
  });
  it('rejects excessive slope without changing any selected cell', () => {
    const s = state(); building(s, 'farmhouse'); s.heights[vertIndex(...field)]! += economy.terraform.stepDm * 2;
    expectError(s, cmd('TILL', { rect: [...field, ...field] }), 'TOO_STEEP');
  });
  it.each([Surface.WATER, Surface.ROAD, Surface.TILLED, Surface.FOUNDATION])('rejects tilling surface %s', surface => {
    const s = state(); building(s, 'farmhouse'); s.surface[cellIndex(...field)] = surface;
    expectError(s, cmd('TILL', { rect: [...field, ...field] }), 'CELL_BLOCKED');
  });
  it('rejects occupied till area', () => {
    const s = state(); building(s, 'farmhouse'); s.occupancy.set(cellIndex(...field), 'env-1');
    expectError(s, cmd('TILL', { rect: [...field, ...field] }), 'OCCUPIED');
  });
  it('protects locked and protected land', () => {
    const s = state(); building(s, 'farmhouse');
    expectError(s, cmd('TILL', { rect: [0, 0, 0, 0] }), 'ZONE_LOCKED');
    s.flags[cellIndex(...field)] = CellFlag.PROTECTED;
    expectError(s, cmd('TILL', { rect: [...field, ...field] }), 'PROTECTED');
  });
  it('requires enough cash for the complete selected area', () => {
    const s = state(); building(s, 'farmhouse'); s.snapshot.wallet.cash = economy.till.cost - 1;
    expectError(s, cmd('TILL', { rect: [...field, ...field] }), 'INSUFFICIENT_FUNDS');
  });
  it('untills empty soil to grass for free', () => {
    const s = state(); tilled(s); const before = s.snapshot.wallet.cash;
    farm(s, cmd('UNTILL', { rect: [...field, ...field] }), now);
    expect(s.surface[cellIndex(...field)]).toBe(Surface.GRASS); expect(s.snapshot.wallet.cash).toBe(before);
  });
  it('cannot untill a planted cell', () => {
    const s = state(); grown(s); expectError(s, cmd('UNTILL', { rect: [...field, ...field] }), 'OCCUPIED');
  });
  it('keeps untill atomic for a mixed valid and invalid rectangle', () => {
    const s = state(); tilled(s); expectError(s, cmd('UNTILL', { rect: [74, 55, 75, 55] }), 'CELL_BLOCKED');
  });
  it('advances the first till quest by the selected cell count', () => {
    const s = state(); building(s, 'farmhouse'); s.snapshot.progress.questIndex = 2;
    farm(s, cmd('TILL', { rect: [70, 50, 72, 51] }), now);
    expect(s.snapshot.progress.questProgress['farm-3']).toBe(catalog.quests.farm[2]!.target);
  });
  it('does not advance the far-bank quest for home-bank tilling', () => {
    const s = state(); building(s, 'farmhouse'); s.snapshot.progress.questIndex = 11;
    farm(s, cmd('TILL', { rect: [...field, ...field] }), now);
    expect(s.snapshot.progress.questProgress['farm-12']).toBeUndefined();
  });
  it('requires an active bridge before far-bank tilling counts for the quest', () => {
    const s = state(); building(s, 'farmhouse'); s.snapshot.progress.questIndex = 11;
    const bridge = { id: 'br_1', typeId: 'bridge_wood' as const, a: [59, 60] as Cell, b: [64, 60] as Cell,
      deckHeightDm: s.template.waterLevelDm + 5, buildEndsAt: now + 1, placedAt: now,
      status: 'CONSTRUCTING' as 'CONSTRUCTING' | 'ACTIVE', cashPaid: 0, materialsPaid: { cash: 0, wood: 0, stone: 0 }, investedValue: 0 };
    s.snapshot.bridges.push(bridge);
    farm(s, cmd('TILL', { rect: [54, 60, 54, 60] }), now);
    expect(s.snapshot.progress.questProgress['farm-12']).toBeUndefined();
    bridge.status = 'ACTIVE'; bridge.buildEndsAt = now;
    farm(s, cmd('TILL', { rect: [55, 60, 55, 60] }), now);
    expect(s.snapshot.progress.questProgress['farm-12']).toBe(1);
  });
});

describe('planting and harvesting', () => {
  it('plants only valid selected cells and charges only those seeds', () => {
    const s = state(); tilled(s); tilled(s, [75, 55]); s.occupancy.set(cellIndex(75, 55), 'env-2');
    const before = s.snapshot.wallet.cash;
    farm(s, cmd('PLANT', { rect: [74, 55, 76, 55], cropId: 'rice' }), now);
    expect(s.snapshot.crops).toHaveLength(1);
    expect(s.snapshot.crops[0]!.cell).toEqual(field);
    expect(s.snapshot.wallet.cash).toBe(before - catalog.crops.rice!.seedCost);
    expect(s.snapshot.crops[0]!.readyAt).toBe(now + catalog.crops.rice!.growSeconds * 1000);
  });
  it('skips protected cells when planting', () => {
    const s = state(); tilled(s); tilled(s, [75, 55]); s.flags[cellIndex(75, 55)] = CellFlag.PROTECTED;
    farm(s, cmd('PLANT', { rect: [74, 55, 75, 55], cropId: 'rice' }), now);
    expect(s.snapshot.crops.map(c => c.cell)).toEqual([field]);
  });
  it('rejects an empty valid planting selection', () => {
    const s = state(); expectError(s, cmd('PLANT', { rect: [...field, ...field], cropId: 'rice' }), 'CELL_BLOCKED');
  });
  it('does not award XP for seed purchases', () => {
    const s = state(); tilled(s); const before = s.snapshot.progress.xp;
    farm(s, cmd('PLANT', { rect: [...field, ...field], cropId: 'rice' }), now);
    expect(s.snapshot.progress.xp).toBe(before);
  });
  it('rejects locked crops and unknown seeds', () => {
    const s = state(); tilled(s); s.snapshot.progress.level = 1;
    expectError(s, cmd('PLANT', { rect: [...field, ...field], cropId: 'coffee' }), 'LEVEL_REQUIRED');
    expectError(s, cmd('PLANT', { rect: [...field, ...field], cropId: 'missing' }), 'NOT_FOUND');
  });
  it.each(['__proto__', 'constructor', 'toString'])('rejects inherited catalog seed id %s', cropId => {
    const s = state(); tilled(s);
    expectError(s, cmd('PLANT', { rect: [...field, ...field], cropId }), 'NOT_FOUND');
  });
  it('rejects insufficient funds without planting a partial area', () => {
    const s = state(); tilled(s); tilled(s, [75, 55]); s.snapshot.wallet.cash = catalog.crops.rice!.seedCost;
    expectError(s, cmd('PLANT', { rect: [74, 55, 75, 55], cropId: 'rice' }), 'INSUFFICIENT_FUNDS');
  });
  it('irrigates from natural water without requiring embankments', () => {
    const s = state(), cell: Cell = [66, 55]; tilled(s, cell);
    farm(s, cmd('PLANT', { rect: [...cell, ...cell], cropId: 'rice' }), now);
    expect(s.snapshot.crops[0]!.readyAt).toBe(now + catalog.crops.rice!.growSeconds * economy.farm.irrigationMultiplier * 1000);
  });
  it('uses a finished connected well within its documented radius', () => {
    const s = state(); tilled(s); building(s, 'well', [74, 60]);
    farm(s, cmd('PLANT', { rect: [...field, ...field], cropId: 'rice' }), now);
    expect(s.snapshot.crops[0]!.readyAt).toBe(now + catalog.crops.rice!.growSeconds * economy.farm.irrigationMultiplier * 1000);
  });
  it('does not irrigate from an unfinished well', () => {
    const s = state(); tilled(s); building(s, 'well', [74, 60]).status = 'CONSTRUCTING';
    farm(s, cmd('PLANT', { rect: [...field, ...field], cropId: 'rice' }), now);
    expect(s.snapshot.crops[0]!.readyAt).toBe(now + catalog.crops.rice!.growSeconds * 1000);
  });
  it('does not irrigate from a disconnected well', () => {
    const s = state(); tilled(s); building(s, 'well', [74, 60]); s.connected.fill(0);
    farm(s, cmd('PLANT', { rect: [...field, ...field], cropId: 'rice' }), now);
    expect(s.snapshot.crops[0]!.readyAt).toBe(now + catalog.crops.rice!.growSeconds * 1000);
  });
  it('does not stack irrigation from water and a well', () => {
    const s = state(), cell: Cell = [66, 55]; tilled(s, cell); building(s, 'well', [66, 60]);
    farm(s, cmd('PLANT', { rect: [...cell, ...cell], cropId: 'rice' }), now);
    expect(s.snapshot.crops[0]!.readyAt).toBe(now + catalog.crops.rice!.growSeconds * economy.farm.irrigationMultiplier * 1000);
  });
  it('locks crop readyAt at planting even when a well is built later', () => {
    const s = state(); tilled(s); farm(s, cmd('PLANT', { rect: [...field, ...field], cropId: 'rice' }), now);
    const readyAt = s.snapshot.crops[0]!.readyAt; building(s, 'well', [74, 60]);
    expect(s.snapshot.crops[0]!.readyAt).toBe(readyAt);
  });
  it('uses exactly twenty seconds for the active tutorial crop quest', () => {
    const s = state(); s.snapshot.progress.tutorialDone = false; s.snapshot.progress.questIndex = 3; tilled(s);
    farm(s, cmd('PLANT', { rect: [...field, ...field], cropId: 'veg_greens' }), now);
    expect(s.snapshot.crops[0]!.readyAt).toBe(now + economy.tutorial.farmGrowSeconds * 1000);
  });
  it('does not grant tutorial timing to other crops', () => {
    const s = state(); s.snapshot.progress.tutorialDone = false; s.snapshot.progress.questIndex = 3; tilled(s);
    farm(s, cmd('PLANT', { rect: [...field, ...field], cropId: 'rice' }), now);
    expect(s.snapshot.crops[0]!.readyAt).toBe(now + catalog.crops.rice!.growSeconds * 1000);
  });
  it('harvests at exact maturity and keeps the soil tilled', () => {
    const s = state(); grown(s); const before = s.snapshot.progress.xp;
    farm(s, cmd('HARVEST', { cells: [field] }), now);
    expect(s.snapshot.inventory.veg_greens).toBe(catalog.crops.veg_greens!.yield);
    expect(s.snapshot.crops).toHaveLength(0); expect(s.occupancy.has(cellIndex(...field))).toBe(false);
    expect(s.surface[cellIndex(...field)]).toBe(Surface.TILLED);
    expect(s.snapshot.progress.xp).toBe(before + catalog.crops.veg_greens!.xp);
  });
  it('keeps immature crops and old ripe crops never wilt', () => {
    const s = state(); grown(s, field, 'rice', now + 1); grown(s, [75, 55], 'rice', now - 100_000);
    farm(s, cmd('HARVEST', { cells: [field, [75, 55]] }), now);
    expect(s.snapshot.crops).toHaveLength(1); expect(s.snapshot.crops[0]!.cell).toEqual(field);
  });
  it('harvests only whole cells that fit, retaining remaining ripe cells', () => {
    const s = state(); grown(s); grown(s, [75, 55]);
    s.snapshot.inventory.rice = economy.farm.baseStorage - catalog.crops.veg_greens!.yield;
    farm(s, cmd('HARVEST', { cells: [field, [75, 55]] }), now);
    expect(inventoryCount(s)).toBe(storageCapacity(s)); expect(s.snapshot.crops).toHaveLength(1);
    expect(s.occupancy.has(cellIndex(75, 55))).toBe(true);
  });
  it('reports storage full when remaining room cannot fit one whole yield', () => {
    const s = state(); grown(s); s.snapshot.inventory.rice = economy.farm.baseStorage - 1;
    expectError(s, cmd('HARVEST', { cells: [field] }), 'STORAGE_FULL');
  });
  it('can skip a large yield and harvest a later small yield that fits', () => {
    const s = state(); grown(s, field, 'tomato'); grown(s, [75, 55], 'rice');
    s.snapshot.inventory.egg = economy.farm.baseStorage - catalog.crops.rice!.yield;
    farm(s, cmd('HARVEST', { cells: [field, [75, 55]] }), now);
    expect(s.snapshot.crops[0]!.cropId).toBe('tomato'); expect(s.snapshot.inventory.rice).toBe(catalog.crops.rice!.yield);
  });
});

describe('production queues and selling', () => {
  it('precharges inputs once and runs at most three consecutive batches per slot', () => {
    const s = state(), b = building(s, 'chicken_coop');
    const def = catalog.buildings.chicken_coop!.production!, recipe = catalog.recipes.chicken_coop!;
    const count = def.slots * def.queueLimit; s.snapshot.inventory.corn = count + 1;
    const xp = s.snapshot.progress.xp;
    farm(s, cmd('START_PRODUCTION', { buildingId: b.id, recipeId: recipe.id, count }), now);
    expect(s.snapshot.inventory.corn).toBe(1); expect(s.snapshot.progress.xp).toBe(xp);
    expect(b.slots).toHaveLength(def.slots);
    for (const slot of b.slots!) {
      expect(slot).toHaveLength(def.queueLimit);
      slot.forEach((job, index) => {
        expect(job.startedAt).toBe(now + recipe.seconds * 1000 * index);
        expect(job.readyAt).toBe(now + recipe.seconds * 1000 * (index + 1));
      });
    }
  });
  it('rejects queue overflow without removing ingredients', () => {
    const s = state(), b = building(s, 'chicken_coop'); s.snapshot.inventory.corn = 100;
    const production = catalog.buildings.chicken_coop!.production!;
    expectError(s, cmd('START_PRODUCTION', { buildingId: b.id, recipeId: 'chicken_coop', count: production.slots * production.queueLimit + 1 }), 'LIMIT_REACHED');
  });
  it('requires all recipe inputs for every queued batch', () => {
    const s = state(), b = building(s, 'cow_barn'); s.snapshot.inventory = { corn: 6, rice: 5 };
    expectError(s, cmd('START_PRODUCTION', { buildingId: b.id, recipeId: 'cow_barn', count: 2 }), 'INSUFFICIENT_ITEMS');
  });
  it('rejects recipes belonging to a different producer', () => {
    const s = state(), b = building(s, 'chicken_coop'); s.snapshot.inventory.rice = 100;
    expectError(s, cmd('START_PRODUCTION', { buildingId: b.id, recipeId: 'rice_mill', count: 1 }), 'NOT_FOUND');
  });
  it.each(['__proto__', 'constructor', 'toString'])('rejects inherited catalog recipe id %s', recipeId => {
    const s = state(), b = building(s, 'chicken_coop');
    expectError(s, cmd('START_PRODUCTION', { buildingId: b.id, recipeId, count: 1 }), 'NOT_FOUND');
  });
  it('cannot start production in a disconnected building', () => {
    const s = state(), b = building(s, 'chicken_coop'); s.snapshot.inventory.corn = 100; s.connected.fill(0);
    expectError(s, cmd('START_PRODUCTION', { buildingId: b.id, recipeId: 'chicken_coop', count: 1 }), 'NO_ROAD_ACCESS');
  });
  it('cannot start production during construction', () => {
    const s = state(), b = building(s, 'chicken_coop'); b.status = 'CONSTRUCTING'; s.snapshot.inventory.corn = 100;
    expectError(s, cmd('START_PRODUCTION', { buildingId: b.id, recipeId: 'chicken_coop', count: 1 }), 'UNDER_CONSTRUCTION');
  });
  it('advances the chicken quest only when feed is actually queued', () => {
    const s = state(), b = building(s, 'chicken_coop'); s.snapshot.progress.questIndex = 8;
    s.snapshot.inventory.corn = 1;
    farm(s, cmd('START_PRODUCTION', { buildingId: b.id, recipeId: 'chicken_coop', count: 1 }), now);
    expect(s.snapshot.progress.questProgress['farm-9']).toBe(1);
  });
  it('collects only ready prepaid output even after a long absence', () => {
    const s = state(), b = building(s, 'chicken_coop'); s.snapshot.inventory.corn = 2;
    farm(s, cmd('START_PRODUCTION', { buildingId: b.id, recipeId: 'chicken_coop', count: 2 }), now);
    farm(s, cmd('COLLECT_PRODUCTION', { buildingId: b.id }), now + 365 * 24 * 3600 * 1000);
    expect(s.snapshot.inventory.egg).toBe(2); expect(s.snapshot.inventory.corn).toBe(0);
    expect(b.slots!.flat()).toHaveLength(0);
    expectError(s, cmd('COLLECT_PRODUCTION', { buildingId: b.id }), 'INVALID_COMMAND');
  });
  it('does not collect immature output', () => {
    const s = state(), b = building(s, 'chicken_coop'); s.snapshot.inventory.corn = 1;
    farm(s, cmd('START_PRODUCTION', { buildingId: b.id, recipeId: 'chicken_coop', count: 1 }), now);
    expectError(s, cmd('COLLECT_PRODUCTION', { buildingId: b.id }), 'INVALID_COMMAND');
  });
  it('retains completed output when storage is full', () => {
    const s = state(), b = building(s, 'chicken_coop');
    b.slots = [[{ recipeId: 'chicken_coop', startedAt: now - 100_000, readyAt: now }]];
    s.snapshot.inventory.rice = storageCapacity(s);
    expectError(s, cmd('COLLECT_PRODUCTION', { buildingId: b.id }), 'STORAGE_FULL');
  });
  it('collects only the output that fits and retains uncollected batches', () => {
    const s = state(), b = building(s, 'chicken_coop');
    b.slots = [[{ recipeId: 'chicken_coop', startedAt: 0, readyAt: now }, { recipeId: 'chicken_coop', startedAt: 0, readyAt: now }]];
    s.snapshot.inventory.rice = storageCapacity(s) - 1;
    farm(s, cmd('COLLECT_PRODUCTION', { buildingId: b.id }), now);
    expect(b.slots[0]).toHaveLength(1); expect(s.snapshot.inventory.egg).toBe(1);
  });
  it('can collect finished output after losing road access', () => {
    const s = state(), b = building(s, 'chicken_coop'); s.connected.fill(0);
    b.slots = [[{ recipeId: 'chicken_coop', startedAt: 0, readyAt: now }]];
    farm(s, cmd('COLLECT_PRODUCTION', { buildingId: b.id }), now);
    expect(s.snapshot.inventory.egg).toBe(1);
  });
  it('sells exact quantities at documented prices with no sales XP', () => {
    const s = state(); building(s, 'market'); s.snapshot.inventory = { rice: 8, egg: 4 };
    const cash = s.snapshot.wallet.cash, xp = s.snapshot.progress.xp;
    farm(s, cmd('SELL', { items: { rice: 5, egg: 2 } }), now);
    expect(s.snapshot.wallet.cash).toBe(cash + catalog.items.rice!.sellPrice * 5 + catalog.items.egg!.sellPrice * 2);
    expect(s.snapshot.inventory).toEqual({ rice: 3, egg: 2 }); expect(s.snapshot.progress.xp).toBe(xp);
  });
  it('requires a completed connected market', () => {
    const s = state(); s.snapshot.inventory.rice = 10;
    expectError(s, cmd('SELL', { items: { rice: 1 } }), 'BUILDING_NOT_FOUND');
    building(s, 'market'); s.connected.fill(0);
    expectError(s, cmd('SELL', { items: { rice: 1 } }), 'NO_ROAD_ACCESS');
  });
  it('does not sell part of an invalid mixed request', () => {
    const s = state(); building(s, 'market'); s.snapshot.inventory = { rice: 10, egg: 0 };
    expectError(s, cmd('SELL', { items: { rice: 5, egg: 1 } }), 'INSUFFICIENT_ITEMS');
  });
  it('does not sell wood or stone as farm items', () => {
    const s = state(); building(s, 'market');
    expectError(s, cmd('SELL', { items: { wood: 1 } }), 'NOT_FOUND');
  });
  it.each(['constructor', 'toString'])('rejects inherited catalog sale item %s', id => {
    const s = state(); building(s, 'market');
    expectError(s, cmd('SELL', { items: { [id]: 1 } }), 'NOT_FOUND');
  });
});

describe('farm command dispatch', () => {
  it.each(['TILL', 'UNTILL', 'PLANT', 'HARVEST', 'SELL'] as const)('rejects farm command %s on city', type => {
    const s = state(); s.snapshot.mapKind = 'city';
    const payloads = {
      TILL: { rect: [...field, ...field] }, UNTILL: { rect: [...field, ...field] },
      PLANT: { rect: [...field, ...field], cropId: 'rice' }, HARVEST: { cells: [field] }, SELL: { items: { rice: 1 } },
    };
    expectError(s, cmd(type, payloads[type]), 'WRONG_MAP');
  });
  it('leaves unrelated commands to other modules', () => {
    const s = state(); expect(farm(s, cmd('BUY_MATERIAL', { wood: 1 }), now)).toBeUndefined();
  });
});
