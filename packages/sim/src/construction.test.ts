import { describe, expect, it } from 'vitest';
import {
  CellFlag, Surface, cellIndex, vertIndex,
  type Cell, type Command, type CommandPayload, type CommandType, type MapKind,
} from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { createTestTemplate } from '@xay-nha/worldgen';
import { builderCapacity, buildingLimit, completeConstruction, construction, validateBridge } from './construction';
import { RuleError } from './common';
import { footprintCells } from './footprint';
import { cloneState, createState, rebuildOccupancy, type SimState } from './state';
import { roadConnectivity } from './roads';

const NOW = 1_000_000;
function command<T extends CommandType>(type: T, payload: CommandPayload[T]): Command {
  return { type, payload, worldId: 'world-test', commandId: 'c07174e4-bfc8-47e2-a72e-bff02282dc51', expectedRevision: 0, clientTime: NOW } as Command;
}
function setup(mapKind: MapKind = 'farm'): SimState {
  const s = createState(createTestTemplate(mapKind), NOW);
  s.snapshot.wallet = { cash: 1_000_000, wood: 1000, stone: 1000 };
  s.snapshot.progress.level = 20;
  s.snapshot.progress.tutorialDone = true;
  s.snapshot.progress.questIndex = 12;
  return s;
}
function place(s: SimState, defId = 'farmhouse', anchor: Cell = [72, 50], rotation: 0 | 1 | 2 | 3 = 0) {
  construction(s, command('PLACE_BUILDING', { defId, anchor, rotation }), NOW);
  return s.snapshot.buildings.at(-1)!;
}
function bridgeTerrain(s: SimState, a: Cell = [72, 56], b: Cell = [76, 56]): void {
  for (const bank of [a, b]) {
    const i = cellIndex(...bank);
    s.flags[i] = CellFlag.EMBANKED;
    s.surface[i] = Surface.ROAD;
    s.roadTier[i] = 1;
  }
  if (a[1] === b[1]) for (let x = a[0] + 1; x < b[0]; x++) s.surface[cellIndex(x, a[1])] = Surface.WATER;
  else for (let z = a[1] + 1; z < b[1]; z++) s.surface[cellIndex(a[0], z)] = Surface.WATER;
}
function buildBridge(s: SimState, a: Cell = [72, 56], b: Cell = [76, 56]) {
  bridgeTerrain(s, a, b);
  construction(s, command('BUILD_BRIDGE', { typeId: 'bridge_wood', a, b }), NOW);
  return s.snapshot.bridges.at(-1)!;
}
function rejects(s: SimState, cmd: Command, code: RuleError['code']): void {
  try { construction(cloneState(s), cmd, NOW); throw new Error('Expected command rejection'); }
  catch (error) { expect(error).toBeInstanceOf(RuleError); expect((error as RuleError).code).toBe(code); }
}

describe('building placement and counts', () => {
  it('charges actual materials, stores invested value and reserves rotated footprint immediately', () => {
    const s = setup('city'), before = { ...s.snapshot.wallet };
    const b = place(s, 'house_town', [72, 50], 1);
    expect(b.status).toBe('CONSTRUCTING');
    expect(b.buildEndsAt).toBe(NOW + 180_000);
    expect(b.materialsPaid).toEqual({ cash: 1200, wood: 10, stone: 5 });
    expect(b.investedValue).toBe(1450);
    expect(s.snapshot.wallet).toEqual({ cash: before.cash - 1200, wood: before.wood - 10, stone: before.stone - 5 });
    expect(s.snapshot.progress.xp).toBe(0);
    expect(s.occupancy.get(cellIndex(74, 51))).toBe(b.id);
    expect(s.occupancy.has(cellIndex(72, 52))).toBe(false);
  });
  it('permits building without connected roads', () => {
    const s = setup();
    expect(place(s).status).toBe('CONSTRUCTING');
    expect(s.connected.some(Boolean)).toBe(false);
  });
  it('rejects footprints crossing locked zones', () => {
    rejects(setup(), command('PLACE_BUILDING', { defId: 'farmhouse', anchor: [78, 50], rotation: 0 }), 'ZONE_LOCKED');
  });
  it.each([Surface.WATER, Surface.ROAD, Surface.TILLED])('rejects blocked surface %s', surface => {
    const s = setup(); s.surface[cellIndex(72, 50)] = surface;
    rejects(s, command('PLACE_BUILDING', { defId: 'farmhouse', anchor: [72, 50], rotation: 0 }), 'CELL_BLOCKED');
  });
  it('rejects environment occupancy and other buildings', () => {
    const s = setup();
    rejects(s, command('PLACE_BUILDING', { defId: 'farmhouse', anchor: [50, 50], rotation: 0 }), 'OCCUPIED');
    place(s);
    rejects(s, command('PLACE_BUILDING', { defId: 'farmhouse', anchor: [73, 50], rotation: 0 }), 'OCCUPIED');
  });
  it('requires flat foundation unless auto flatten is requested', () => {
    const s = setup(); s.heights[vertIndex(73, 51)] = s.heights[vertIndex(73, 51)]! + 5;
    rejects(s, command('PLACE_BUILDING', { defId: 'farmhouse', anchor: [72, 50], rotation: 0 }), 'NOT_FLAT');
    const before = s.snapshot.wallet.cash;
    const cost = construction(s, command('PLACE_BUILDING', { defId: 'farmhouse', anchor: [72, 50], rotation: 0, autoFlattenHDm: 50 }), NOW)!;
    expect(cost.cash).toBe(503);
    expect(s.snapshot.wallet.cash).toBe(before - 503);
    expect(s.heights[vertIndex(73, 51)]).toBe(50);
  });
  it('rejects shoreline placement until embanked', () => {
    const s = setup(); s.surface[cellIndex(71, 50)] = Surface.WATER;
    rejects(s, command('PLACE_BUILDING', { defId: 'farmhouse', anchor: [72, 50], rotation: 0 }), 'NEAR_WATER_NOT_EMBANKED');
    s.flags[cellIndex(72, 50)] = CellFlag.EMBANKED;
    expect(place(s).status).toBe('CONSTRUCTING');
  });
  it('rejects protected terrain and NO_BUILD flags', () => {
    const s = setup(); s.flags[cellIndex(72, 50)] = CellFlag.PROTECTED;
    rejects(s, command('PLACE_BUILDING', { defId: 'farmhouse', anchor: [72, 50], rotation: 0 }), 'PROTECTED');
    s.flags[cellIndex(72, 50)] = CellFlag.NO_BUILD;
    rejects(s, command('PLACE_BUILDING', { defId: 'farmhouse', anchor: [72, 50], rotation: 0 }), 'CELL_BLOCKED');
  });
  it('rejects wrong-map catalog and insufficient materials', () => {
    rejects(setup(), command('PLACE_BUILDING', { defId: 'house_small', anchor: [72, 50], rotation: 0 }), 'WRONG_MAP');
    const s = setup(); s.snapshot.wallet.wood = 0;
    rejects(s, command('PLACE_BUILDING', { defId: 'farmhouse', anchor: [72, 50], rotation: 0 }), 'INSUFFICIENT_FUNDS');
  });
  it('counts active and constructing entities against catalog limit', () => {
    const s = setup(); place(s, 'market');
    rejects(s, command('PLACE_BUILDING', { defId: 'market', anchor: [76, 50], rotation: 0 }), 'LIMIT_REACHED');
  });
  it('scales farmhouse cash and required level by current count', () => {
    const s = setup(); const first = place(s); completeConstruction(s, first);
    const second = place(s, 'farmhouse', [76, 50]);
    expect(second.cashPaid).toBe(1500);
    expect(second.investedValue).toBe(1750);
    const low = setup(); low.snapshot.progress.level = 1;
    completeConstruction(low, place(low));
    low.snapshot.progress.level = 1;
    rejects(low, command('PLACE_BUILDING', { defId: 'farmhouse', anchor: [76, 50], rotation: 0 }), 'LEVEL_REQUIRED');
  });
  it.each([[1, 2], [4, 2], [5, 3], [9, 3], [10, 4], [20, 4]])('level %s provides %s builders', (level, expected) => {
    const s = setup(); s.snapshot.progress.level = level;
    expect(builderCapacity(s)).toBe(expected);
  });
  it('counts both bridges and buildings against shared builders', () => {
    const s = setup(); s.snapshot.progress.level = 4;
    buildBridge(s); place(s, 'well');
    rejects(s, command('PLACE_BUILDING', { defId: 'silo', anchor: [76, 50], rotation: 0 }), 'NO_BUILDER_FREE');
  });
  it('applies fractional per-level count step only after flooring', () => {
    const s = setup('city'); s.snapshot.progress.level = 9;
    expect(buildingLimit(s, catalog.buildings.bank!)).toBe(1);
    s.snapshot.progress.level = 10;
    expect(buildingLimit(s, catalog.buildings.bank!)).toBe(2);
  });
});

describe('construction lifecycle and refunds', () => {
  it('completes once and awards construction XP at completion only', () => {
    const s = setup(), b = place(s);
    expect(s.snapshot.progress.xp).toBe(0);
    completeConstruction(s, b);
    expect(s.snapshot.progress.xp).toBe(Math.round(economy.xp.buildMultiplier * Math.sqrt(b.investedValue)));
    const xp = s.snapshot.progress.xp;
    completeConstruction(s, b);
    expect(s.snapshot.progress.xp).toBe(xp);
  });
  it('instantly completes only the current matching tutorial building', () => {
    const s = setup(); s.snapshot.progress.tutorialDone = false; s.snapshot.progress.questIndex = 0;
    const market = place(s, 'market');
    expect(market.status).toBe('ACTIVE'); expect(market.buildEndsAt).toBe(NOW);
    expect(place(s, 'farmhouse', [76, 50]).status).toBe('CONSTRUCTING');
  });
  it('cancel returns 100% actual materials without XP', () => {
    const s = setup(), initial = { ...s.snapshot.wallet }, b = place(s);
    construction(s, command('CANCEL_CONSTRUCTION', { buildingId: b.id }), NOW);
    expect(s.snapshot.wallet).toEqual(initial);
    expect(s.snapshot.progress.xp).toBe(0);
    expect(s.snapshot.buildings).toHaveLength(0);
    expect(s.occupancy.has(cellIndex(72, 50))).toBe(false);
    expect(s.surface[cellIndex(72, 50)]).toBe(Surface.FOUNDATION);
  });
  it('active demolition floors each refund and collects settled income', () => {
    const s = setup('city'), b = place(s, 'house_town', [72, 50], 1);
    completeConstruction(s, b); b.accrued = 12.75;
    const before = { ...s.snapshot.wallet };
    construction(s, command('DEMOLISH', { buildingId: b.id }), NOW);
    expect(s.snapshot.wallet).toEqual({ cash: before.cash + 600 + 12, wood: before.wood + 5, stone: before.stone + 2 });
    expect(s.occupancy.has(cellIndex(74, 51))).toBe(false);
    expect(s.surface[cellIndex(74, 51)]).toBe(Surface.FOUNDATION);
  });
  it('rejects demolition during construction and cancellation after completion', () => {
    const s = setup(), b = place(s);
    rejects(s, command('DEMOLISH', { buildingId: b.id }), 'UNDER_CONSTRUCTION');
    completeConstruction(s, b);
    rejects(s, command('CANCEL_CONSTRUCTION', { buildingId: b.id }), 'NOT_UNDER_CONSTRUCTION');
    rejects(s, command('SPEED_UP', { buildingId: b.id }), 'NOT_UNDER_CONSTRUCTION');
  });
  it('speed up charges half remaining cash and completes immediately', () => {
    const s = setup(), b = place(s), before = s.snapshot.wallet.cash;
    const cost = construction(s, command('SPEED_UP', { buildingId: b.id }), NOW + 30_000)!;
    expect(cost).toEqual({ cash: 125, wood: 0, stone: 0 });
    expect(s.snapshot.wallet.cash).toBe(before - 125);
    expect(b.status).toBe('ACTIVE'); expect(b.buildEndsAt).toBe(NOW + 30_000);
    expect(b.investedValue).toBe(750);
  });
  it('speed up floors minimum charge to $1', () => {
    const s = setup(), b = place(s);
    expect(construction(s, command('SPEED_UP', { buildingId: b.id }), b.buildEndsAt - 1)?.cash).toBe(1);
  });
  it('guards demolition of farmhouse supporting existing fields', () => {
    const s = setup(), b = place(s); completeConstruction(s, b);
    s.surface[cellIndex(72, 54)] = Surface.TILLED;
    rejects(s, command('DEMOLISH', { buildingId: b.id }), 'LIMIT_REACHED');
  });
  it('guards demolition of silo holding excess inventory', () => {
    const s = setup(), b = place(s, 'silo'); completeConstruction(s, b);
    s.snapshot.inventory.rice = 51;
    rejects(s, command('DEMOLISH', { buildingId: b.id }), 'STORAGE_FULL');
  });
  it('guards demolition of production with queued ingredients', () => {
    const s = setup(), b = place(s, 'rice_mill'); completeConstruction(s, b);
    b.slots![0]!.push({ recipeId: 'rice_mill', startedAt: NOW, readyAt: NOW + 900_000 });
    rejects(s, command('DEMOLISH', { buildingId: b.id }), 'CANNOT_DEMOLISH_SUPPORT');
  });
});

describe('bridge geometry and lifecycle', () => {
  it('charges per span cell and reserves water during construction', () => {
    const s = setup(), before = { ...s.snapshot.wallet }, b = buildBridge(s);
    expect(b.cashPaid).toBe(240); expect(b.materialsPaid.wood).toBe(15);
    expect(b.investedValue).toBe(465); expect(b.buildEndsAt).toBe(NOW + 180_000);
    expect(s.snapshot.wallet).toEqual({ cash: before.cash - 240, wood: before.wood - 15, stone: before.stone });
    expect(s.occupancy.get(cellIndex(73, 56))).toBe(b.id);
    expect(s.snapshot.progress.xp).toBe(0);
  });
  it('uses shore-facing edge height and preserves fractional average', () => {
    const s = setup(); bridgeTerrain(s);
    s.heights[vertIndex(73, 56)] = 35; s.heights[vertIndex(73, 57)] = 40;
    s.heights[vertIndex(76, 56)] = 35; s.heights[vertIndex(76, 57)] = 40;
    expect(validateBridge(s, [72, 56], [76, 56], 6).deckHeightDm).toBe(37.5);
  });
  it('supports reversed endpoints and bridges along either axis', () => {
    const s = setup(); bridgeTerrain(s);
    expect(validateBridge(s, [76, 56], [72, 56], 6).cells).toHaveLength(3);
    bridgeTerrain(s, [76, 60], [76, 64]);
    expect(validateBridge(s, [76, 60], [76, 64], 6).cells).toHaveLength(3);
  });
  it('rejects diagonal bridge', () => {
    rejects(setup(), command('BUILD_BRIDGE', { typeId: 'bridge_wood', a: [72, 56], b: [76, 57] }), 'BRIDGE_NOT_STRAIGHT');
  });
  it('requires road and embankment at both ends', () => {
    const s = setup(); bridgeTerrain(s); s.flags[cellIndex(76, 56)] = 0;
    rejects(s, command('BUILD_BRIDGE', { typeId: 'bridge_wood', a: [72, 56], b: [76, 56] }), 'BRIDGE_END_INVALID');
    s.flags[cellIndex(76, 56)] = CellFlag.EMBANKED; s.roadTier[cellIndex(76, 56)] = 0;
    rejects(s, command('BUILD_BRIDGE', { typeId: 'bridge_wood', a: [72, 56], b: [76, 56] }), 'BRIDGE_END_INVALID');
  });
  it('rejects dry interior cells', () => {
    const s = setup(); bridgeTerrain(s); s.surface[cellIndex(74, 56)] = Surface.GRASS;
    rejects(s, command('BUILD_BRIDGE', { typeId: 'bridge_wood', a: [72, 56], b: [76, 56] }), 'BRIDGE_SPAN_NOT_WATER');
  });
  it('rejects overlong span and no-water span', () => {
    const s = setup(); bridgeTerrain(s, [70, 56], [78, 56]);
    rejects(s, command('BUILD_BRIDGE', { typeId: 'bridge_wood', a: [70, 56], b: [78, 56] }), 'BRIDGE_TOO_LONG');
    bridgeTerrain(s, [72, 58], [73, 58]);
    rejects(s, command('BUILD_BRIDGE', { typeId: 'bridge_wood', a: [72, 58], b: [73, 58] }), 'BRIDGE_TOO_LONG');
  });
  it('rejects mismatched bank height beyond 1m', () => {
    const s = setup(); bridgeTerrain(s);
    s.heights[vertIndex(76, 56)] = 65; s.heights[vertIndex(76, 57)] = 65;
    rejects(s, command('BUILD_BRIDGE', { typeId: 'bridge_wood', a: [72, 56], b: [76, 56] }), 'BRIDGE_HEIGHT_MISMATCH');
  });
  it('rejects protected water or locked opposite bank', () => {
    const s = setup(); bridgeTerrain(s); s.flags[cellIndex(74, 56)] = CellFlag.PROTECTED;
    rejects(s, command('BUILD_BRIDGE', { typeId: 'bridge_wood', a: [72, 56], b: [76, 56] }), 'PROTECTED');
    const locked = setup(); bridgeTerrain(locked, [77, 56], [81, 56]);
    rejects(locked, command('BUILD_BRIDGE', { typeId: 'bridge_wood', a: [77, 56], b: [81, 56] }), 'ZONE_LOCKED');
  });
  it('rejects overlapping bridge and adjacent parallel span', () => {
    const s = setup(); buildBridge(s);
    rejects(s, command('BUILD_BRIDGE', { typeId: 'bridge_wood', a: [72, 56], b: [76, 56] }), 'BRIDGE_CROSSING');
    bridgeTerrain(s, [72, 57], [76, 57]);
    rejects(s, command('BUILD_BRIDGE', { typeId: 'bridge_wood', a: [72, 57], b: [76, 57] }), 'BRIDGE_CROSSING');
  });
  it('accepts parallel bridges separated by one water cell', () => {
    const s = setup(); buildBridge(s);
    expect(buildBridge(s, [72, 58], [76, 58]).status).toBe('CONSTRUCTING');
  });
  it('bridge remains outside road network until completion', () => {
    const s = setup(), entry: Cell = s.template.entryCells[0]!;
    const a: Cell = [72, entry[1]], b: Cell = [76, entry[1]];
    for (let x = entry[0]; x <= a[0]; x++) { s.roadTier[cellIndex(x, entry[1])] = 1; s.surface[cellIndex(x, entry[1])] = Surface.ROAD; }
    const bridge = buildBridge(s, a, b);
    expect(roadConnectivity(s)[cellIndex(...b)]).toBe(0);
    completeConstruction(s, bridge);
    expect(roadConnectivity(s)[cellIndex(...b)]).toBe(1);
  });
  it('bridge supports cancel/full refund and demolition/half refund', () => {
    const s = setup(), initial = { ...s.snapshot.wallet }, b = buildBridge(s);
    construction(s, command('CANCEL_CONSTRUCTION', { bridgeId: b.id }), NOW);
    expect(s.snapshot.wallet).toEqual(initial);
    const second = buildBridge(s); completeConstruction(s, second);
    const before = { ...s.snapshot.wallet };
    construction(s, command('REMOVE_BRIDGE', { bridgeId: second.id }), NOW);
    expect(s.snapshot.wallet).toEqual({ cash: before.cash + 120, wood: before.wood + 7, stone: before.stone });
    expect(s.occupancy.has(cellIndex(74, 56))).toBe(false);
    expect(s.surface[cellIndex(74, 56)]).toBe(Surface.WATER);
  });
  it('bridge speedup completes and frees builder', () => {
    const s = setup(), b = buildBridge(s);
    expect(construction(s, command('SPEED_UP', { bridgeId: b.id }), NOW + 90_000)?.cash).toBe(60);
    expect(b.status).toBe('ACTIVE');
  });
  it('bridge requires unlock level and valid map', () => {
    const s = setup(); bridgeTerrain(s); s.snapshot.progress.level = 3;
    rejects(s, command('BUILD_BRIDGE', { typeId: 'bridge_wood', a: [72, 56], b: [76, 56] }), 'LEVEL_REQUIRED');
    s.snapshot.progress.level = 20;
    rejects(s, command('BUILD_BRIDGE', { typeId: 'bridge_concrete', a: [72, 56], b: [76, 56] }), 'WRONG_MAP');
  });
  it('returns undefined for commands handled elsewhere', () => {
    expect(construction(setup(), command('BUY_MATERIAL', { wood: 1 }), NOW)).toBeUndefined();
  });
  it('state cloning protects original after rejected builder command', () => {
    const s = setup(); s.snapshot.progress.level = 4; place(s, 'market'); place(s, 'well', [76, 50]);
    const before = JSON.stringify(s.snapshot);
    rejects(s, command('PLACE_BUILDING', { defId: 'silo', anchor: [72, 54], rotation: 0 }), 'NO_BUILDER_FREE');
    expect(JSON.stringify(s.snapshot)).toBe(before);
    expect(rebuildOccupancy(s)).toEqual([]);
    expect(footprintCells(catalog.buildings.market!, [72, 50], 0)).toHaveLength(9);
  });
});
