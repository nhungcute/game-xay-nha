import { CellFlag, Surface, type MapKind, type WorldTemplate } from '@xay-nha/contracts';
import { encodeLayers, type DecodedLayers } from './layers';
import { rasterizeWater, zoneOfCell } from './geometry';

/** G0/G1 rule fixture; intentionally provisional, not the final authored City/Farm map. */
export function createTestTemplate(mapKind: MapKind = 'farm'): WorldTemplate {
  const waterLevelDm = mapKind === 'farm' ? 30 : 20;
  const water: WorldTemplate['water'] = { lakes: [], rivers: [{ id: 'fixture-river', centerlineXZ: [[124, 0], [124, 256]], widthM: [8, 8] }], waterfalls: [] };
  const mask = rasterizeWater(water);
  const startZones = [27, 28, 35, 36];
  const layers: DecodedLayers = { heightsDm: new Int16Array(129 * 129).fill(waterLevelDm + 20),
    surface: new Uint8Array(128 * 128), flags: new Uint8Array(128 * 128), roadTier: new Uint8Array(128 * 128), biome: new Uint8Array(128 * 128) };
  mask.forEach((wet, index) => { if (wet) layers.surface[index] = Surface.WATER; });
  // Shared shore vertices are high; vertices touching only water are carved below water (D002).
  for (let vz = 0; vz <= 128; vz++) for (let vx = 0; vx <= 128; vx++) {
    const adjacent: number[] = [];
    for (const z of [vz - 1, vz]) for (const x of [vx - 1, vx]) if (x >= 0 && x < 128 && z >= 0 && z < 128) adjacent.push(mask[z * 128 + x]!);
    if (adjacent.some(Boolean)) layers.heightsDm[vz * 129 + vx] = adjacent.every(Boolean) ? waterLevelDm - 15 : waterLevelDm + 5;
  }
  const entry: [number, number] = mapKind === 'farm' ? [70, 79] : [48, 70];
  // The entry reaches the outside border along one dry natural village path.
  const road: [number, number][] = mapKind === 'farm'
    ? Array.from({ length: 49 }, (_, n) => [70, 79 + n])
    : Array.from({ length: 49 }, (_, n) => [n, 70]);
  for (const [x, z] of road) {
    const i = z * 128 + x;
    layers.roadTier[i] = 1; layers.surface[i] = Surface.ROAD;
    if (!startZones.includes(zoneOfCell(x, z))) layers.flags[i] = layers.flags[i]! | CellFlag.PROTECTED;
  }
  layers.flags[entry[1] * 128 + entry[0]]! |= CellFlag.ENTRY;
  const anchors: WorldTemplate['env']['anchors'] = [
    { id: 'A-0', assetId: 'tree_deciduous_01', cell: [50, 50], footprint: 1, offsetXZ: [0, 0], yawDeg: 15, scale: 1, blocking: true },
    { id: 'A-1', assetId: 'tree_deciduous_02', cell: [53, 51], footprint: 1, offsetXZ: [0, 0], yawDeg: 90, scale: 1, blocking: true },
    { id: 'A-2', assetId: 'tree_deciduous_03', cell: [55, 53], footprint: 1, offsetXZ: [0, 0], yawDeg: 180, scale: 1, blocking: true },
    { id: 'A-3', assetId: 'rock_01', cell: [51, 55], footprint: 1, offsetXZ: [0, 0], yawDeg: 0, scale: 1, blocking: true },
    { id: 'A-4', assetId: 'rock_large_01', cell: [66, 52], footprint: 2, offsetXZ: [0, 0], yawDeg: 45, scale: 1, blocking: true },
  ];
  return {
    schemaVersion: 1, mapId: `${mapKind}-test-01`, mapKind, templateVersion: 1, generatorVersion: 'veg-1.0.0', seed: 20261009,
    waterLevelDm, grid: { size: 128, cellSizeM: 2 }, layers: encodeLayers(layers), water, startZones, entryCells: [entry],
    env: { catalogVersion: 1, anchors, scatter: [{ biome: 0, category: 'tree_deciduous', densityPerCell: 0.03,
      assetIds: ['tree_deciduous_01', 'tree_deciduous_02', 'tree_deciduous_03'], rules: { minWaterDistCells: 2, maxSlopeDm: 10, avoidSuggestedLots: true } }] },
    suggestedLots: [{ id: 'lot-1', cells: [72, 50, 78, 58] }, { id: 'lot-2', cells: [50, 60, 58, 66] }],
    camera: { target: [128, 0, 128], yawDeg: 45, pitchDeg: 55, distance: 140 },
    palette: { grass: '#7fbf4d', dirt: '#c9a26b', water: '#2f8fd8' },
  };
}
