import { Matrix4, Quaternion, Vector3 } from 'three';
import { CELL_SIZE_M, GRID, vertIndex, type Cell } from '@xay-nha/contracts';
import type { SimState } from '@xay-nha/sim';
import type { InstancePlacement } from './InstanceBatches';

export function terrainHeight(s: SimState, x: number, z: number): number {
  const gx = Math.max(0, Math.min(GRID - 0.0001, x / CELL_SIZE_M));
  const gz = Math.max(0, Math.min(GRID - 0.0001, z / CELL_SIZE_M));
  const cx = Math.floor(gx), cz = Math.floor(gz), tx = gx - cx, tz = gz - cz;
  const a = s.heights[vertIndex(cx, cz)]!, b = s.heights[vertIndex(cx + 1, cz)]!;
  const c = s.heights[vertIndex(cx, cz + 1)]!, d = s.heights[vertIndex(cx + 1, cz + 1)]!;
  return ((a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz) / 10;
}
export function cellCenter(cell: Cell): [number, number] {
  return [cell[0] * CELL_SIZE_M + CELL_SIZE_M / 2, cell[1] * CELL_SIZE_M + CELL_SIZE_M / 2];
}
export function matrix(x: number, y: number, z: number, yaw = 0, scale: [number, number, number] = [1, 1, 1]): Matrix4 {
  return new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw), new Vector3(...scale));
}
export function addInstance(groups: Map<string, InstancePlacement>, key: string, assetId: string, transform: Matrix4): void {
  let group = groups.get(key);
  if (!group) { group = { assetId, matrices: [] }; groups.set(key, group); }
  group.matrices.push(transform);
}
