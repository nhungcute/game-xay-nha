import { CellFlag, Surface, WorldTemplateSchema, type Cell, type MapKind, type WorldTemplate } from '@xay-nha/contracts';
import { createTestTemplate } from './fixture';
import { encodeLayers, type DecodedLayers } from './layers';
import { hash32 } from './random';
import { rasterizeWater, zoneOfCell } from './geometry';
import { validateTemplate } from './validator';

export interface AuthoredLayout {
  schemaVersion: 1; provisional: true; kind: 'authored-fixture'; mapKind: MapKind; mapId: string; seed: number;
  waterLevelDm: number; water: WorldTemplate['water']; startZones: number[]; entryCells: Cell[];
  roads: Cell[][]; suggestedLots: NonNullable<WorldTemplate['suggestedLots']>;
  bankRegions?: WorldTemplate['bankRegions'];
  protectedCells: Cell[];
  camera: WorldTemplate['camera'];
  /** G3 authored maps. Absent → the original G1 fixture terrain (kept byte-identical). */
  templateVersion?: number;
  terrain?: { baseDm: number; amplitude: number; hills: { x: number; z: number; radius: number; heightDm: number }[] };
  /** Inclusive cell rectangles [x0,z0,x1,z1]; biome 1 = forest edge (dense), biome 2 = rocky hill. */
  forests?: [number, number, number, number][];
  rocky?: [number, number, number, number][];
  /** D039: Organic biome painting from noise thresholds rather than rectangles. */
  organicBiomes?: boolean;
}

function noise(seed: number, x: number, z: number): number {
  const sample = (sx: number, sz: number) => hash32(seed, sx, sz, 'terrain-1') / 4294967295 * 2 - 1;
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const tx = fx * fx * (3 - 2 * fx), tz = fz * fz * (3 - 2 * fz);
  const top = sample(ix, iz) * (1 - tx) + sample(ix + 1, iz) * tx;
  const bottom = sample(ix, iz + 1) * (1 - tx) + sample(ix + 1, iz + 1) * tx;
  return top * (1 - tz) + bottom * tz;
}

const trees = { deciduous: ['tree_deciduous_01', 'tree_deciduous_02', 'tree_deciduous_03', 'tree_deciduous_04'], conifer: ['tree_conifer_01', 'tree_conifer_02', 'tree_conifer_03', 'tree_conifer_04'] };
const bushes = ['bush_01', 'bush_02', 'bush_03', 'bush_04'], rocks = ['rock_01', 'rock_02', 'rock_03', 'rock_04'], flowers = ['flower_01', 'flower_02', 'flower_03', 'flower_04'], reeds = ['reed_01', 'reed_02', 'reed_03'];
type Scatter = WorldTemplate['env']['scatter'];
const base = (density: number): Scatter => [
  { biome: 0, category: 'tree_deciduous', densityPerCell: density, assetIds: trees.deciduous, rules: { minWaterDistCells: 2, maxSlopeDm: 10, avoidSuggestedLots: true } },
  { biome: 0, category: 'tree_conifer', densityPerCell: density * 0.6, assetIds: trees.conifer, rules: { minWaterDistCells: 2, maxSlopeDm: 10, avoidSuggestedLots: true } },
  { biome: 0, category: 'bush', densityPerCell: 0.02, assetIds: bushes, rules: { minWaterDistCells: 1, maxSlopeDm: 15, avoidSuggestedLots: true } },
  { biome: 0, category: 'rock', densityPerCell: 0.012, assetIds: rocks, rules: { maxSlopeDm: 20, avoidSuggestedLots: true } },
  { biome: 0, category: 'flower', densityPerCell: 0.03, assetIds: flowers, rules: { minWaterDistCells: 1, maxSlopeDm: 10 } },
  { biome: 0, category: 'reed', densityPerCell: 0.3, assetIds: reeds, rules: { onlyShore: true } },
  { biome: 1, category: 'tree_conifer', densityPerCell: 0.22, assetIds: trees.conifer, rules: { minWaterDistCells: 1, maxSlopeDm: 25 } },
  { biome: 1, category: 'tree_deciduous', densityPerCell: 0.16, assetIds: trees.deciduous, rules: { minWaterDistCells: 1, maxSlopeDm: 25 } },
  { biome: 1, category: 'bush', densityPerCell: 0.08, assetIds: bushes, rules: { maxSlopeDm: 30 } },
  { biome: 1, category: 'reed', densityPerCell: 0.3, assetIds: reeds, rules: { onlyShore: true } },
  { biome: 2, category: 'rock', densityPerCell: 0.12, assetIds: rocks, rules: { maxSlopeDm: 60 } },
  { biome: 2, category: 'rock_large', densityPerCell: 0.02, assetIds: ['rock_large_01', 'rock_large_02'], rules: { maxSlopeDm: 60 } },
  { biome: 2, category: 'tree_conifer', densityPerCell: 0.08, assetIds: trees.conifer, rules: { maxSlopeDm: 40 } },
];
const AUTHORED_SCATTER: Record<MapKind, Scatter> = { city: base(0.035), farm: base(0.045), town: base(0.04) };

/** Terrain authoring (G1 fixture, G3 maps, and D039 random maps). */
export function buildAuthoredTemplate(layout: AuthoredLayout): WorldTemplate {
  const template = createTestTemplate(layout.mapKind);
  Object.assign(template, {
    mapId: layout.mapId, seed: layout.seed, waterLevelDm: layout.waterLevelDm,
    water: layout.water, startZones: layout.startZones, entryCells: layout.entryCells,
    suggestedLots: layout.suggestedLots, camera: layout.camera, ...(layout.bankRegions ? { bankRegions: layout.bankRegions } : {}),
  });
  const checked = WorldTemplateSchema.safeParse(template);
  if (!checked.success) throw new Error(checked.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n'));
  const water = rasterizeWater(template.water), level = template.waterLevelDm;
  const layers: DecodedLayers = {
    heightsDm: new Int16Array(129 * 129), surface: new Uint8Array(128 * 128),
    roadTier: new Uint8Array(128 * 128), flags: new Uint8Array(128 * 128), biome: new Uint8Array(128 * 128),
  };
  for (let z = 0; z <= 128; z++) for (let x = 0; x <= 128; x++) {
    const amplitude = layout.terrain?.amplitude ?? 1;
    const fbm = (noise(template.seed, x / 32, z / 32) * 12 + noise(template.seed + 1, x / 16, z / 16) * 5 + noise(template.seed + 2, x / 8, z / 8) * 2) * amplitude;
    const hills = layout.terrain
      ? layout.terrain.hills.reduce((sum, h) => sum + Math.max(0, 1 - Math.hypot(x - h.x, z - h.z) / h.radius) ** 1.5 * h.heightDm, 0)
      : Math.max(0, 1 - Math.hypot(x - 114, z - 8) / 24) * 160;
    layers.heightsDm[z * 129 + x] = Math.round((level + (layout.terrain?.baseDm ?? 25) + fbm + hills) / 5) * 5;
  }
  if (!layout.organicBiomes) {
    for (const lot of layout.suggestedLots) for (let z = lot.cells[1]; z <= lot.cells[3] + 1; z++) for (let x = lot.cells[0]; x <= lot.cells[2] + 1; x++) layers.heightsDm[z * 129 + x] = level + 20;
  }
  for (const path of layout.roads) for (const cell of path) {
    if (!Array.isArray(cell) || cell.length !== 2 || cell.some(value => !Number.isInteger(value) || value < 0 || value >= 128)) throw new Error('Invalid authored road cell');
    const [x, z] = cell, index = z * 128 + x;
    if (water[index]) throw new Error(`Authored road overlaps water at ${x},${z}`);
    layers.surface[index] = Surface.ROAD; layers.roadTier[index] = 1;
    if (!layout.startZones.includes(zoneOfCell(x, z))) layers.flags[index] = CellFlag.PROTECTED;
    for (const vz of [z, z + 1]) for (const vx of [x, x + 1]) layers.heightsDm[vz * 129 + vx] = level + 20;
  }
  for (const [x, z] of layout.protectedCells) {
    if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || z < 0 || x >= 128 || z >= 128) throw new Error('Invalid authored protected cell');
    layers.flags[z * 128 + x] = layers.flags[z * 128 + x]! | CellFlag.PROTECTED;
  }
  for (const [x, z] of layout.entryCells) layers.flags[z * 128 + x] = layers.flags[z * 128 + x]! | CellFlag.ENTRY;
  water.forEach((wet, index) => { if (wet) layers.surface[index] = Surface.WATER; });
  if (layout.organicBiomes) {
    const vertDist = new Uint8Array(129 * 129).fill(255);
    const queue: number[] = [];
    for (let vz = 0; vz <= 128; vz++) for (let vx = 0; vx <= 128; vx++) {
      let touchesWater = false, touchesLand = false;
      for (const cz of [vz - 1, vz]) for (const cx of [vx - 1, vx]) {
        if (cx >= 0 && cx < 128 && cz >= 0 && cz < 128) {
          if (water[cz * 128 + cx]) touchesWater = true;
          else touchesLand = true;
        }
      }
      const vi = vz * 129 + vx;
      if (touchesWater && touchesLand) {
        vertDist[vi] = 0;
        queue.push(vi);
      } else if (touchesWater && !touchesLand) {
        vertDist[vi] = 250;
      }
    }
    let head = 0;
    while (head < queue.length) {
      const vi = queue[head++]!;
      const vx = vi % 129, vz = Math.floor(vi / 129);
      const d = vertDist[vi]!;
      if (d >= 3) continue;
      for (const [nx, nz] of [[vx - 1, vz], [vx + 1, vz], [vx, vz - 1], [vx, vz + 1]]) {
        if (nx! >= 0 && nx! <= 128 && nz! >= 0 && nz! <= 128) {
          const ni = nz! * 129 + nx!;
          if (vertDist[ni]! !== 250 && vertDist[ni]! > d + 1) {
            vertDist[ni] = d + 1;
            queue.push(ni);
          }
        }
      }
    }
    for (let vz = 0; vz <= 128; vz++) for (let vx = 0; vx <= 128; vx++) {
      const vi = vz * 129 + vx;
      const d = vertDist[vi]!;
      if (d === 250) {
        layers.heightsDm[vi] = level - 15;
      } else if (d === 0) {
        layers.heightsDm[vi] = level + 10;
      } else if (d === 1) {
        const raw = layers.heightsDm[vi]!;
        layers.heightsDm[vi] = Math.min(level + 18, Math.max(level + 10, Math.round(((level + 10) * 0.6 + raw * 0.4) / 5) * 5));
      } else if (d === 2) {
        const raw = layers.heightsDm[vi]!;
        layers.heightsDm[vi] = Math.min(level + 28, Math.max(level + 12, Math.round(((level + 15) * 0.4 + raw * 0.6) / 5) * 5));
      }
    }
  } else {
    for (let z = 0; z <= 128; z++) for (let x = 0; x <= 128; x++) {
      const adjacent: number[] = [];
      for (const cz of [z - 1, z]) for (const cx of [x - 1, x]) if (cx >= 0 && cx < 128 && cz >= 0 && cz < 128) adjacent.push(water[cz * 128 + cx]!);
      if (adjacent.some(Boolean)) layers.heightsDm[z * 129 + x] = adjacent.every(Boolean) ? level - 15 : level + 5;
    }
  }
  if (layout.organicBiomes) {
    for (let z = 0; z < 128; z++) for (let x = 0; x < 128; x++) {
      const idx = z * 128 + x;
      if (water[idx]) continue;
      const h = layers.heightsDm[z * 129 + x]!;
      const verts = [z * 129 + x, z * 129 + x + 1, (z + 1) * 129 + x, (z + 1) * 129 + x + 1].map(v => layers.heightsDm[v]!);
      const slope = Math.max(...verts) - Math.min(...verts);
      const inStart = layout.startZones.includes(zoneOfCell(x, z));
      const rockNoise = noise(template.seed + 101, x / 14, z / 14);
      if (!inStart && (slope > 14 || h > level + 110) && rockNoise > 0.05) {
        layers.biome[idx] = 2;
      } else {
        const borderDist = Math.min(x, 127 - x, z, 127 - z);
        const forestNoise = noise(template.seed + 202, x / 18, z / 18);
        if (!inStart && (borderDist < 10 || forestNoise > 0.16)) {
          layers.biome[idx] = 1;
        }
      }
    }
  } else {
    const paint = (rects: [number, number, number, number][] | undefined, biome: number) => {
      for (const [x0, z0, x1, z1] of rects ?? []) for (let z = Math.max(0, z0); z <= Math.min(127, z1); z++) for (let x = Math.max(0, x0); x <= Math.min(127, x1); x++) layers.biome[z * 128 + x] = biome;
    };
    paint(layout.forests, 1); paint(layout.rocky, 2);
  }
  template.layers = encodeLayers(layers);
  if (layout.templateVersion) template.templateVersion = layout.templateVersion;
  template.env.anchors = layout.terrain ? [] : template.env.anchors.filter(anchor => !water[anchor.cell[1] * 128 + anchor.cell[0]]);
  template.env.scatter = layout.terrain ? AUTHORED_SCATTER[layout.mapKind] : [
    { biome: 0, category: 'tree_deciduous', densityPerCell: 0.06, assetIds: ['tree_deciduous_01', 'tree_deciduous_02', 'tree_deciduous_03'], rules: { minWaterDistCells: 2, maxSlopeDm: 10, avoidSuggestedLots: true } },
    { biome: 0, category: 'rock', densityPerCell: 0.02, assetIds: ['rock_01'], rules: { maxSlopeDm: 20, avoidSuggestedLots: true } },
    { biome: 0, category: 'reed', densityPerCell: 0.25, assetIds: ['reed_01'], rules: { onlyShore: true } },
    { biome: 0, category: 'flower', densityPerCell: 0.015, assetIds: ['flower_01'], rules: { minWaterDistCells: 2, maxSlopeDm: 10 } },
  ];
  const errors = validateTemplate(template);
  if (errors.length) throw new Error(errors.join('\n'));
  return template;
}
