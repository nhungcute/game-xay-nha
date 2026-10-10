import { describe, expect, it } from 'vitest';
import { GRID, Surface, cellIndex, type Cell } from '@xay-nha/contracts';
import { createTestTemplate } from '@xay-nha/worldgen';
import { isFarBank } from './banks';
import { cloneState, createState, neighbors, type SimState } from './state';

// Independent copy of the previous flood algorithm checks behavioral parity, not cache internals.
function previous(s: SimState, cells: Cell[]): boolean {
  if (!cells.length) return false;
  const flood = (starts: Cell[]) => {
    const visited = new Uint8Array(GRID * GRID), queue = [...starts];
    for (const cell of starts) visited[cellIndex(...cell)] = 1;
    for (let head = 0; head < queue.length; head++) for (const next of neighbors(queue[head]!)) {
      const index = cellIndex(...next);
      if (!visited[index] && s.surface[index] !== Surface.WATER) { visited[index] = 1; queue.push(next); }
    }
    return visited;
  };
  const home = flood(s.template.entryCells), target = flood(cells);
  return cells.every(cell => !home[cellIndex(...cell)]) && s.snapshot.bridges.some(bridge => bridge.status === 'ACTIVE'
    && ((home[cellIndex(...bridge.a)] && target[cellIndex(...bridge.b)])
      || (home[cellIndex(...bridge.b)] && target[cellIndex(...bridge.a)])));
}
function fixture(): SimState {
  const s = createState(createTestTemplate('city'), 1_000_000);
  s.snapshot.bridges.push({ id: 'br_test', typeId: 'bridge_wood', a: [59, 70], b: [64, 70], deckHeightDm: 25,
    placedAt: 0, buildEndsAt: 1_000_000, status: 'ACTIVE', cashPaid: 320,
    materialsPaid: { cash: 320, wood: 20, stone: 0 }, investedValue: 620 });
  return s;
}

describe('far-bank topology lookup', () => {
  it('matches the previous flood on home, far, mixed, empty, water and boundary queries', () => {
    const s = fixture();
    const queries: Cell[][] = [[], [[0, 0]], [[127, 127]], [[50, 70]], [[70, 70]],
      [[64, 70], [65, 70]], [[50, 70], [70, 70]], [[62, 70]], [[62, 70], [70, 70]]];
    for (const query of queries) expect(isFarBank(s, query)).toBe(previous(s, query));
    expect(isFarBank(s, [[70, 70]])).toBe(true);
  });
  it('reads completion and removal of bridges even after warming the topology cache', () => {
    const s = fixture(), bridge = s.snapshot.bridges[0]!;
    expect(isFarBank(s, [[70, 70]])).toBe(true);
    bridge.status = 'CONSTRUCTING'; expect(isFarBank(s, [[70, 70]])).toBe(false);
    bridge.status = 'ACTIVE'; expect(isFarBank(s, [[70, 70]])).toBe(true);
    s.snapshot.bridges = []; expect(isFarBank(s, [[70, 70]])).toBe(false);
  });
  it('keeps dry surface edits equivalent and never writes snapshot or surface data', () => {
    const s = fixture();
    expect(isFarBank(s, [[70, 70]])).toBe(true);
    s.surface[cellIndex(70, 70)] = Surface.TILLED;
    const before = JSON.stringify(s.snapshot), surface = s.surface.slice();
    expect(isFarBank(s, [[70, 70]])).toBe(previous(s, [[70, 70]]));
    expect(JSON.stringify(s.snapshot)).toBe(before); expect(s.surface).toEqual(surface);
  });
  it('does not share mutable surface topology across clones or newly loaded states', () => {
    const s = fixture(); expect(isFarBank(s, [[70, 70]])).toBe(true);
    const copy = cloneState(s);
    // Synthetic fixture change: the clone has a different water mask, unlike legal commands.
    copy.surface.forEach((value, index) => { if (value === Surface.WATER) copy.surface[index] = Surface.GRASS; });
    expect(isFarBank(copy, [[70, 70]])).toBe(previous(copy, [[70, 70]]));
    expect(isFarBank(copy, [[70, 70]])).toBe(false);
    expect(isFarBank(s, [[70, 70]])).toBe(true);
  });
  it('preserves the old union of multiple far components and multiple entry components', () => {
    const s = fixture();
    for (let z = 0; z < GRID; z++) s.surface[cellIndex(90, z)] = Surface.WATER;
    const query: Cell[] = [[70, 70], [100, 70]];
    expect(isFarBank(s, query)).toBe(previous(s, query)); expect(isFarBank(s, query)).toBe(true);
    const copy = cloneState(s);
    copy.template = { ...s.template, entryCells: [...s.template.entryCells, [100, 70]] };
    expect(isFarBank(copy, query)).toBe(previous(copy, query)); expect(isFarBank(copy, query)).toBe(false);
  });
  it('uses authored bank regions even when their dry ground is connected', () => {
    const s = fixture();
    s.surface.forEach((value, index) => { if (value === Surface.WATER) s.surface[index] = Surface.GRASS; });
    s.template = { ...s.template, bankRegions: [{ id: 'home', cells: [[48, 70], [59, 70]] },
      { id: 'far', cells: [[64, 70], [70, 70], [71, 70]] }] };
    expect(isFarBank(s, [[70, 70], [71, 70]])).toBe(true);
    expect(isFarBank(s, [[48, 70], [70, 70]])).toBe(false);
    s.snapshot.bridges[0]!.status = 'CONSTRUCTING'; expect(isFarBank(s, [[70, 70]])).toBe(false);
    delete s.template.bankRegions;
    expect(isFarBank(s, [[70, 70]])).toBe(previous(s, [[70, 70]]));
  });
});
