import { CELL_SIZE_M, GRID, cellIndex, type BuildingDef, type Cell, type Rotation } from '@xay-nha/contracts';
import type { SimState } from './state';

export function rotatedSize(def: Pick<BuildingDef, 'size'>, rot: Rotation): [number, number] {
  return rot % 2 === 0 ? [...def.size] : [def.size[1], def.size[0]];
}
export function footprintCells(def: Pick<BuildingDef, 'size'>, anchor: Cell, rot: Rotation): Cell[] {
  const [w, d] = rotatedSize(def, rot), cells: Cell[] = [];
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) cells.push([anchor[0] + x, anchor[1] + z]);
  return cells;
}
export function footprintRectWorld(def: Pick<BuildingDef, 'size'>, anchor: Cell, rot: Rotation) {
  const [w, d] = rotatedSize(def, rot);
  return { x0: anchor[0] * CELL_SIZE_M, z0: anchor[1] * CELL_SIZE_M, x1: (anchor[0] + w) * CELL_SIZE_M, z1: (anchor[1] + d) * CELL_SIZE_M };
}
export function buildingAtCell(s: SimState, x: number, z: number): string | null {
  if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || z < 0 || x >= GRID || z >= GRID) return null;
  const id = s.occupancy.get(cellIndex(x, z));
  return id?.startsWith('b_') && s.snapshot.buildings.some(b => b.id === id) ? id : null;
}
