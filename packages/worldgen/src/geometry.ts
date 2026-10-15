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

/** A cell's center controls water raster membership; meters are the vector units. Bounding-box acceleration. */
export function rasterizeWater(water: WorldTemplate['water']): Uint8Array {
  const mask = new Uint8Array(128 * 128);
  for (const lake of water.lakes) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [px, pz] of lake.polygonXZ) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (pz < minZ) minZ = pz;
      if (pz > maxZ) maxZ = pz;
    }
    const c0 = Math.max(0, Math.floor((minX - 1) / 2));
    const c1 = Math.min(127, Math.ceil((maxX - 1) / 2));
    const r0 = Math.max(0, Math.floor((minZ - 1) / 2));
    const r1 = Math.min(127, Math.ceil((maxZ - 1) / 2));
    for (let cz = r0; cz <= r1; cz++) {
      const z = cz * 2 + 1;
      for (let cx = c0; cx <= c1; cx++) {
        if (!mask[cz * 128 + cx]) {
          const x = cx * 2 + 1;
          if (pointInPolygon(x, z, lake.polygonXZ)) mask[cz * 128 + cx] = 1;
        }
      }
    }
  }
  for (const river of water.rivers) {
    const pts = river.centerlineXZ, widths = river.widthM;
    for (let i = 1; i < pts.length; i++) {
      const p1 = pts[i - 1]!, p2 = pts[i]!;
      const maxW = Math.max(widths[i - 1]!, widths[i]!);
      const minX = Math.min(p1[0], p2[0]) - maxW;
      const maxX = Math.max(p1[0], p2[0]) + maxW;
      const minZ = Math.min(p1[1], p2[1]) - maxW;
      const maxZ = Math.max(p1[1], p2[1]) + maxW;
      const c0 = Math.max(0, Math.floor((minX - 1) / 2));
      const c1 = Math.min(127, Math.ceil((maxX - 1) / 2));
      const r0 = Math.max(0, Math.floor((minZ - 1) / 2));
      const r1 = Math.min(127, Math.ceil((maxZ - 1) / 2));
      const segPts = [p1, p2], segW = [widths[i - 1]!, widths[i]!];
      for (let cz = r0; cz <= r1; cz++) {
        const z = cz * 2 + 1;
        for (let cx = c0; cx <= c1; cx++) {
          const idx = cz * 128 + cx;
          if (!mask[idx]) {
            const x = cx * 2 + 1;
            if (pointInRiver(x, z, segPts, segW)) mask[idx] = 1;
          }
        }
      }
    }
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
