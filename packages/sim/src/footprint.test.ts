import { describe, expect, it } from 'vitest';
import { CELL_SIZE_M, GRID, ZONE_CELLS, Surface, cellIndex, type Cell, type Command, type Rotation } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { createTestTemplate } from '@xay-nha/worldgen';
import { execute } from './engine';
import { advanceTime } from './economy';
import { buildingAtCell, footprintCells, footprintRectWorld, rotatedSize } from './footprint';
import { createState, type SimState } from './state';

const NOW = 1_000_000;
const anchor: Cell = [72, 50];
const rotations: Rotation[] = [0, 1, 2, 3];
const shapes: [number, number][] = [[2, 3], [3, 4], [4, 5]];
const matrix = shapes.flatMap(size => rotations.map(rotation => ({
  label: `${size[0]}×${size[1]} rotation ${rotation * 90}°`, size, rotation,
  expected: (rotation === 1 || rotation === 3 ? [size[1], size[0]] : [...size]) as [number, number],
})));
const realMatrix = [
  { id: 'house_town', size: [2, 3] as [number, number] },
  { id: 'hotel', size: [4, 5] as [number, number] },
].flatMap(definition => rotations.map(rotation => ({
  ...definition, rotation, label: `${definition.id} rotation ${rotation * 90}°`,
  expected: (rotation === 1 || rotation === 3 ? [definition.size[1], definition.size[0]] : [...definition.size]) as [number, number],
})));

function area([x, z]: Cell, [width, depth]: [number, number]): Cell[] {
  return Array.from({ length: width * depth }, (_, index) => [x + index % width, z + Math.floor(index / width)]);
}
function outsideEdges([x, z]: Cell, [width, depth]: [number, number]): Cell[] {
  const cells: Cell[] = [];
  for (let offset = 0; offset < width; offset++) cells.push([x + offset, z - 1], [x + offset, z + depth]);
  for (let offset = 0; offset < depth; offset++) cells.push([x - 1, z + offset], [x + width, z + offset]);
  return cells;
}
function initialState(): SimState {
  const s = createState(createTestTemplate('city'), NOW, []);
  s.snapshot.wallet = { cash: 1_000_000, wood: 1000, stone: 1000 };
  s.snapshot.progress.level = economy.xp.maxLevel;
  s.snapshot.progress.xp = economy.xp.cumulative.city[economy.xp.maxLevel]!;
  s.snapshot.progress.tutorialDone = true;
  s.snapshot.progress.questIndex = catalog.quests.city.length;
  return s;
}
function run(s: SimState, type: Command['type'], payload: unknown, now = s.snapshot.serverTime): SimState {
  const operation = execute(s, { type, payload, commandId: '00000000-0000-4000-8000-000000000001',
    worldId: s.snapshot.worldId, expectedRevision: s.snapshot.revision, clientTime: now }, now);
  expect(operation.result.accepted).toBe(true);
  if (!operation.result.accepted) throw new Error(`${type}: ${operation.result.code}`);
  return operation.state;
}
function placed(defId: string, rotation: Rotation, location = anchor, withNeighbor = false): { state: SimState; id: string; neighborId?: string } {
  let s = run(initialState(), 'PLACE_BUILDING', { defId, anchor: location, rotation });
  const id = s.snapshot.buildings[0]!.id;
  expect(s.snapshot.buildings[0]!.status).toBe('CONSTRUCTING');
  let neighborId: string | undefined;
  if (withNeighbor) {
    s = run(s, 'PLACE_BUILDING', { defId: 'house_small', anchor: [74, 65], rotation: 0 });
    neighborId = s.snapshot.buildings.at(-1)!.id;
  }
  advanceTime(s, Math.max(...s.snapshot.buildings.map(building => building.buildEndsAt)));
  expect(s.snapshot.buildings.every(building => building.status === 'ACTIVE')).toBe(true);
  return { state: s, id, neighborId };
}
// The future UI supplies an ID only after the shared sim picker finds a building.
function demolishPicked(s: SimState, cell: Cell): SimState {
  const id = buildingAtCell(s, ...cell);
  return id === null ? s : run(s, 'DEMOLISH', { buildingId: id });
}

describe('docs/10 §2.3 non-square geometry matrix', () => {
  it.each(matrix)('$label has the required rotated size and anchored cells', ({ size, rotation, expected }) => {
    const def = { size: [...size] as [number, number] };
    const origin: Cell = [13, 21], before = [...def.size];
    expect(rotatedSize(def, rotation)).toEqual(expected);
    const cells = footprintCells(def, origin, rotation);
    expect(cells).toEqual(area(origin, expected));
    expect(cells[0]).toEqual(origin);
    expect(cells.at(-1)).toEqual([origin[0] + expected[0] - 1, origin[1] + expected[1] - 1]);
    expect(cells).toHaveLength(size[0] * size[1]);
    expect(new Set(cells.map(cell => cell.join(':'))).size).toBe(cells.length);
    expect(def.size).toEqual(before);
  });
  it.each(matrix)('$label converts the shared footprint to world coordinates', ({ size, rotation, expected }) => {
    const origin: Cell = [13, 21];
    expect(footprintRectWorld({ size }, origin, rotation)).toEqual({
      x0: origin[0] * CELL_SIZE_M, z0: origin[1] * CELL_SIZE_M,
      x1: (origin[0] + expected[0]) * CELL_SIZE_M, z1: (origin[1] + expected[1]) * CELL_SIZE_M,
    });
  });
});

describe('real catalog placement and shared picking', () => {
  it.each(realMatrix)('$label reserves every inside cell and no outside edge cell', ({ id: defId, rotation, expected }) => {
    const { state: s, id } = placed(defId, rotation);
    for (const cell of area(anchor, expected)) {
      expect(s.occupancy.get(cellIndex(...cell))).toBe(id);
      expect(buildingAtCell(s, ...cell)).toBe(id);
    }
    for (const cell of outsideEdges(anchor, expected)) {
      expect(s.occupancy.has(cellIndex(...cell))).toBe(false);
      expect(buildingAtCell(s, ...cell)).toBeNull();
    }
    expect(s.occupancy.size).toBe(expected[0] * expected[1]);
  });
  it.each(realMatrix)('$label does not demolish when any outside edge is picked', ({ id: defId, rotation, expected }) => {
    const { state: s, id } = placed(defId, rotation, anchor, true);
    const snapshot = JSON.stringify(s.snapshot), occupancy = new Map(s.occupancy);
    for (const cell of outsideEdges(anchor, expected)) expect(demolishPicked(s, cell)).toBe(s);
    expect(JSON.stringify(s.snapshot)).toBe(snapshot);
    expect(s.occupancy).toEqual(occupancy);
    expect(s.snapshot.buildings.some(building => building.id === id)).toBe(true);
  });
});

const demolitionCases = realMatrix.flatMap(row => area(anchor, row.expected).map(cell => ({
  ...row, cell, label: `${row.label} from inside cell ${cell.join(',')}`,
})));
describe('demolition regression from every actual non-square footprint cell', () => {
  it.each(demolitionCases)('$label removes only the picked building and cleans its entire occupancy', ({ id: defId, rotation, expected, cell }) => {
    const fixture = placed(defId, rotation, anchor, true), before = fixture.state.snapshot.wallet;
    const paid = fixture.state.snapshot.buildings.find(building => building.id === fixture.id)!.materialsPaid;
    const s = demolishPicked(fixture.state, cell);
    expect(s.snapshot.buildings.map(building => building.id)).toEqual([fixture.neighborId]);
    for (const inside of area(anchor, expected)) {
      expect(buildingAtCell(s, ...inside)).toBeNull();
      expect(s.occupancy.has(cellIndex(...inside))).toBe(false);
      expect(s.surface[cellIndex(...inside)]).toBe(Surface.FOUNDATION);
    }
    expect(buildingAtCell(s, 74, 65)).toBe(fixture.neighborId);
    expect(s.occupancy.size).toBe(catalog.buildings.house_small!.size[0] * catalog.buildings.house_small!.size[1]);
    expect(s.snapshot.wallet).toEqual({
      cash: before.cash + Math.floor(paid.cash * economy.construction.refund),
      wood: before.wood + Math.floor(paid.wood * economy.construction.refund),
      stone: before.stone + Math.floor(paid.stone * economy.construction.refund),
    });
  });
});

describe('out-of-bounds aliases and non-building occupants', () => {
  it('rejects out-of-grid x values even when their flattened index aliases a real building', () => {
    let s = initialState();
    // These tests unlock the border zones solely to place real edge fixtures.
    s.snapshot.unlockedZones = Array.from({ length: (GRID / ZONE_CELLS) ** 2 }, (_, index) => index);
    s = run(s, 'PLACE_BUILDING', { defId: 'house_town', anchor: [126, 50], rotation: 0 });
    s = run(s, 'PLACE_BUILDING', { defId: 'house_town', anchor: [0, 51], rotation: 0 });
    advanceTime(s, Math.max(...s.snapshot.buildings.map(building => building.buildEndsAt)));
    const right = buildingAtCell(s, 127, 50), left = buildingAtCell(s, 0, 51);
    expect(right).not.toBeNull(); expect(left).not.toBeNull();
    expect(cellIndex(-1, 51)).toBe(cellIndex(127, 50));
    expect(cellIndex(GRID, 50)).toBe(cellIndex(0, 51));
    expect(buildingAtCell(s, -1, 51)).toBeNull();
    expect(buildingAtCell(s, GRID, 50)).toBeNull();
    expect(buildingAtCell(s, 126 + GRID, 49)).toBeNull();
    expect(buildingAtCell(s, 125.5, 50 + 1 / 256)).toBeNull();
    expect(buildingAtCell(s, 126, -1)).toBeNull();
    expect(buildingAtCell(s, 126, GRID)).toBeNull();
    expect(buildingAtCell(s, Number.NaN, 50)).toBeNull();
    expect(buildingAtCell(s, Number.POSITIVE_INFINITY, 50)).toBeNull();
  });
  it('returns null for env, crops, bridges and stale building occupancy IDs', () => {
    const s = initialState();
    for (const id of ['env-1', 'crop:100', 'br_1', 'b_stale']) {
      s.occupancy.set(cellIndex(...anchor), id);
      expect(buildingAtCell(s, ...anchor)).toBeNull();
    }
  });
});
