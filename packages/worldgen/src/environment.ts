import { CellFlag, Surface, type EnvInstance, type WorldTemplate } from '@xay-nha/contracts';
import { cellFootprint, cellVertices, zoneOfCell } from './geometry';
import { decodeLayers, type DecodedLayers } from './layers';
import { hash32, mulberry32 } from './random';

function waterDistances(surface: Uint8Array): Uint16Array {
  const distance = new Uint16Array(surface.length).fill(65535);
  const queue = new Int32Array(surface.length);
  let head = 0, tail = 0;
  surface.forEach((value, i) => { if (value === Surface.WATER) { distance[i] = 0; queue[tail++] = i; } });
  while (head < tail) {
    const i = queue[head++]!, x = i % 128, z = Math.floor(i / 128);
    for (const [nx, nz] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]) {
      if (nx! < 0 || nx! >= 128 || nz! < 0 || nz! >= 128) continue;
      const next = nz! * 128 + nx!;
      if (distance[next]! > distance[i]! + 1) { distance[next] = distance[i]! + 1; queue[tail++] = next; }
    }
  }
  return distance;
}

interface Context { layers: DecodedLayers; distances: Uint16Array; reserved: Set<number> }
function context(template: WorldTemplate): Context {
  const layers = decodeLayers(template), reserved = new Set<number>();
  for (const anchor of template.env.anchors) for (const [x, z] of cellFootprint(...anchor.cell, anchor.footprint)) reserved.add(z * 128 + x);
  return { layers, distances: waterDistances(layers.surface), reserved };
}

function generate(template: WorldTemplate, zone: number, ctx: Context): EnvInstance[] {
  if (!Number.isInteger(zone) || zone < 0 || zone >= 64) throw new Error('Zone must be an integer in [0,64)');
  const x0 = (zone % 8) * 16, z0 = Math.floor(zone / 8) * 16;
  const result = template.env.anchors.filter(anchor => zoneOfCell(...anchor.cell) === zone).map(anchor => ({ ...anchor, cell: [...anchor.cell] as [number, number], offsetXZ: [...anchor.offsetXZ] as [number, number] }));
  const occupied = new Set(ctx.reserved);
  template.env.scatter.forEach((spec, categoryIndex) => {
    const rng = mulberry32(hash32(template.seed, zone, categoryIndex, template.generatorVersion));
    const footprint = spec.category === 'rock_large' ? 2 : 1;
    const blocking = !['reed', 'flower'].includes(spec.category);
    for (let cz = z0; cz < z0 + 16; cz++) for (let cx = x0; cx < x0 + 16; cx++) {
      // Four draws even for excluded cells. IDs count visited cells, preserving later IDs on exclusion.
      const probability = rng(), assetDraw = rng(), offsetDraw = rng(), rotationDraw = rng();
      if (probability >= spec.densityPerCell || spec.assetIds.length === 0) continue;
      const cells = cellFootprint(cx, cz, footprint);
      if (cells.some(([x, z]) => x >= x0 + 16 || z >= z0 + 16)) continue;
      if (cells.some(([x, z]) => {
        const i = z * 128 + x, heights = cellVertices(x, z).map(v => ctx.layers.heightsDm[v]!);
        return ctx.layers.biome[i] !== spec.biome || ctx.layers.surface[i] === Surface.WATER
          || ctx.layers.roadTier[i]! > 0 || (ctx.layers.flags[i]! & CellFlag.ENTRY) !== 0
          || ctx.reserved.has(i) || (blocking && occupied.has(i))
          || (spec.rules.minWaterDistCells !== undefined && ctx.distances[i]! < spec.rules.minWaterDistCells)
          || (spec.rules.onlyShore === true && ctx.distances[i] !== 1)
          || (spec.rules.maxSlopeDm !== undefined && Math.max(...heights) - Math.min(...heights) > spec.rules.maxSlopeDm)
          || (spec.rules.avoidSuggestedLots === true && template.suggestedLots?.some(lot => x >= lot.cells[0] && x <= lot.cells[2] && z >= lot.cells[1] && z <= lot.cells[3]));
      })) continue;
      if (blocking) cells.forEach(([x, z]) => occupied.add(z * 128 + x));
      // Split single draws into independent bit fields, avoiding additional RNG calls.
      const offsetBits = Math.floor(offsetDraw * 4294967296), rotationBits = Math.floor(rotationDraw * 4294967296);
      result.push({
        id: `Z${zone}-${spec.category}-${(cz - z0) * 16 + cx - x0}`,
        assetId: spec.assetIds[Math.floor(assetDraw * spec.assetIds.length)]!, cell: [cx, cz], footprint,
        offsetXZ: [((offsetBits & 65535) / 65535 - 0.5) * 1.2, ((offsetBits >>> 16) / 65535 - 0.5) * 1.2],
        yawDeg: (rotationBits & 65535) / 65536 * 360, scale: 0.85 + (rotationBits >>> 16) / 65535 * 0.3, blocking,
      });
    }
  });
  return result;
}

export function generateZone(template: WorldTemplate, zoneId: number): EnvInstance[] { return generate(template, zoneId, context(template)); }
export function generateEnvironment(template: WorldTemplate): EnvInstance[] {
  const ctx = context(template);
  return Array.from({ length: 64 }, (_, zone) => generate(template, zone, ctx)).flat();
}
