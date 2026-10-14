import { GRID, cellIndex } from '@xay-nha/contracts';
import { bridgeCells, neighbors, type SimState } from './state';
import { footprintCells } from './footprint';
import { catalog } from '@xay-nha/content';

export function roadConnectivity(s: SimState): Uint8Array {
  const result = new Uint8Array(GRID * GRID);
  for (let i = 0; i < s.roadTier.length; i++) if (s.roadTier[i]! > 0) result[i] = 1;
  for (const b of s.snapshot.bridges) {
    if (b.status === 'ACTIVE') for (const c of bridgeCells(b.a, b.b)) result[cellIndex(...c)] = 1;
  }
  return result;
}

export function access(s: SimState, b: SimState['snapshot']['buildings'][number]): number {
  const def = catalog.buildings[b.defId]; if (!def) return 0;
  const cells = footprintCells(def, b.anchor, b.rotation), owned = new Set(cells.map(c => cellIndex(...c)));
  let tier = 0;
  for (const c of cells) for (const n of neighbors(c)) {
    const i = cellIndex(...n);
    if (!owned.has(i) && s.connected[i]) tier = Math.max(tier, s.roadTier[i] || 1);
  }
  return tier;
}

export type RoadModule = 'ISOLATED' | 'END' | 'STRAIGHT' | 'CORNER' | 'T' | 'CROSS';
export function roadModule(mask: number): RoadModule {
  const count = [1, 2, 4, 8].filter(bit => (mask & bit) !== 0).length;
  if (count === 0) return 'ISOLATED'; if (count === 1) return 'END';
  if (count === 3) return 'T'; if (count === 4) return 'CROSS';
  return mask === 5 || mask === 10 ? 'STRAIGHT' : 'CORNER';
}
