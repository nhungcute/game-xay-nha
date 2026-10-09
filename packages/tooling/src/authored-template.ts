import { CellFlag, Surface, WorldTemplateSchema, type Cell, type WorldTemplate } from '@xay-nha/contracts';
import { createTestTemplate, encodeLayers, hash32, rasterizeWater, validateTemplate, zoneOfCell, type DecodedLayers } from '@xay-nha/worldgen';

export interface AuthoredLayout {
  schemaVersion: 1; provisional: true; kind: 'authored-fixture'; mapKind: 'farm' | 'city'; mapId: string; seed: number;
  waterLevelDm: number; water: WorldTemplate['water']; startZones: number[]; entryCells: Cell[];
  roads: Cell[][]; suggestedLots: NonNullable<WorldTemplate['suggestedLots']>;
  bankRegions?: WorldTemplate['bankRegions'];
  protectedCells: Cell[];
  camera: WorldTemplate['camera'];
}

function noise(seed: number, x: number, z: number): number {
  const sample = (sx: number, sz: number) => hash32(seed, sx, sz, 'terrain-1') / 4294967295 * 2 - 1;
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const tx = fx * fx * (3 - 2 * fx), tz = fz * fz * (3 - 2 * fz);
  const top = sample(ix, iz) * (1 - tx) + sample(ix + 1, iz) * tx;
  const bottom = sample(ix, iz + 1) * (1 - tx) + sample(ix + 1, iz + 1) * tx;
  return top * (1 - tz) + bottom * tz;
}

/** Provisional G1 terrain authoring. Vector water stays available for true water meshes. */
export function buildAuthoredTemplate(layout: AuthoredLayout): WorldTemplate {
  const template = createTestTemplate(layout.mapKind);
  Object.assign(template, { mapId: layout.mapId, seed: layout.seed, waterLevelDm: layout.waterLevelDm,
    water: layout.water, startZones: layout.startZones, entryCells: layout.entryCells,
    suggestedLots: layout.suggestedLots, camera: layout.camera, ...(layout.bankRegions ? { bankRegions: layout.bankRegions } : {}) });
  // Validate authored geometry before using coordinates to index terrain arrays.
  const checked = WorldTemplateSchema.safeParse(template);
  if (!checked.success) throw new Error(checked.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n'));
  const water = rasterizeWater(template.water), level = template.waterLevelDm;
  const layers: DecodedLayers = { heightsDm: new Int16Array(129 * 129), surface: new Uint8Array(128 * 128),
    roadTier: new Uint8Array(128 * 128), flags: new Uint8Array(128 * 128), biome: new Uint8Array(128 * 128) };
  for (let z = 0; z <= 128; z++) for (let x = 0; x <= 128; x++) {
    const fbm = noise(template.seed, x / 32, z / 32) * 12 + noise(template.seed + 1, x / 16, z / 16) * 5 + noise(template.seed + 2, x / 8, z / 8) * 2;
    const hill = Math.max(0, 1 - Math.hypot(x - 114, z - 8) / 24) * 160;
    layers.heightsDm[z * 129 + x] = Math.round((level + 25 + fbm + hill) / 5) * 5;
  }
  for (const lot of layout.suggestedLots) for (let z = lot.cells[1]; z <= lot.cells[3] + 1; z++) for (let x = lot.cells[0]; x <= lot.cells[2] + 1; x++) layers.heightsDm[z * 129 + x] = level + 20;
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
  for (let z = 0; z <= 128; z++) for (let x = 0; x <= 128; x++) {
    const adjacent: number[] = [];
    for (const cz of [z - 1, z]) for (const cx of [x - 1, x]) if (cx >= 0 && cx < 128 && cz >= 0 && cz < 128) adjacent.push(water[cz * 128 + cx]!);
    if (adjacent.some(Boolean)) layers.heightsDm[z * 129 + x] = adjacent.every(Boolean) ? level - 15 : level + 5;
  }
  template.layers = encodeLayers(layers);
  template.env.anchors = template.env.anchors.filter(anchor => !water[anchor.cell[1] * 128 + anchor.cell[0]]);
  template.env.scatter = [
    { biome: 0, category: 'tree_deciduous', densityPerCell: 0.06, assetIds: ['tree_deciduous_01', 'tree_deciduous_02', 'tree_deciduous_03'], rules: { minWaterDistCells: 2, maxSlopeDm: 10, avoidSuggestedLots: true } },
    { biome: 0, category: 'rock', densityPerCell: 0.02, assetIds: ['rock_01'], rules: { maxSlopeDm: 20, avoidSuggestedLots: true } },
    { biome: 0, category: 'reed', densityPerCell: 0.25, assetIds: ['reed_01'], rules: { onlyShore: true } },
    { biome: 0, category: 'flower', densityPerCell: 0.015, assetIds: ['flower_01'], rules: { minWaterDistCells: 2, maxSlopeDm: 10 } },
  ];
  const errors = validateTemplate(template);
  if (errors.length) throw new Error(errors.join('\n'));
  return template;
}
