import type { WorldTemplate } from '@xay-nha/contracts';

type Point = readonly [number, number];

export function pointInPolygon(x: number, z: number, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!, b = polygon[i]!;
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function pointInRiver(x: number, z: number, centerline: readonly Point[], widths: readonly number[]): boolean {
  for (let i = 1; i < centerline.length; i++) {
    const a = centerline[i - 1]!, b = centerline[i]!;
    const dx = b[0] - a[0], dz = b[1] - a[1], lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSquared));
    const width = widths[i - 1]! * (1 - t) + widths[i]! * t;
    if ((x - a[0] - t * dx) ** 2 + (z - a[1] - t * dz) ** 2 <= (width / 2) ** 2) return true;
  }
  return false;
}

/** A cell's center controls water raster membership; meters are the vector units. */
export function rasterizeWater(water: WorldTemplate['water']): Uint8Array {
  const mask = new Uint8Array(128 * 128);
  for (let cz = 0; cz < 128; cz++) for (let cx = 0; cx < 128; cx++) {
    const x = cx * 2 + 1, z = cz * 2 + 1;
    if (water.lakes.some(lake => pointInPolygon(x, z, lake.polygonXZ))
      || water.rivers.some(river => pointInRiver(x, z, river.centerlineXZ, river.widthM))) mask[cz * 128 + cx] = 1;
  }
  return mask;
}

export function cellVertices(cx: number, cz: number): number[] {
  const index = cz * 129 + cx;
  return [index, index + 1, index + 129, index + 130];
}

export function cellFootprint(cx: number, cz: number, size: number): [number, number][] {
  const cells: [number, number][] = [];
  for (let z = cz; z < cz + size; z++) for (let x = cx; x < cx + size; x++) cells.push([x, z]);
  return cells;
}

export function zoneOfCell(cx: number, cz: number): number { return Math.floor(cz / 16) * 8 + Math.floor(cx / 16); }
