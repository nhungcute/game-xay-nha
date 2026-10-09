import type { Cell, WorldTemplate } from '@xay-nha/contracts';
import { rasterizeWater } from '@xay-nha/worldgen';
import type { AuthoredLayout } from './authored-template';

type Rect = [number, number, number, number];
const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const rectCells = ([x0, z0, x1, z1]: Rect): Cell[] => range(z0, z1).flatMap(z => range(x0, x1).map(x => [x, z] as Cell));
/** Regular polygon in world metres (cell = 2 m), for natural ponds. */
const pond = (cx: number, cz: number, r: number, n = 9): [number, number][] =>
  Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2, k = 1 + 0.18 * Math.sin(i * 2.7); return [Math.round(cx + Math.cos(a) * r * k), Math.round(cz + Math.sin(a) * r * k)]; });

/**
 * CITY — docs/03 §2: coastal/river plain. North river belt one zone row away from the start (narrowest
 * span 5 cells for a wooden bridge), south-west bay, a small pond, low eastern hills, forested borders.
 * ENTRY on the west edge of zone 35; the village road leaves the map westwards.
 */
export function createCityLayout(): AuthoredLayout {
  const water: WorldTemplate['water'] = {
    lakes: [
      { id: 'bay-sw', polygonXZ: [[0, 140], [26, 146], [58, 176], [86, 200], [106, 228], [112, 256], [0, 256]] },
      { id: 'pond-se', polygonXZ: pond(176, 178, 12) },
    ],
    rivers: [{ id: 'river-north', centerlineXZ: [[0, 40], [64, 34], [120, 46], [176, 38], [256, 28]], widthM: [22, 18, 10, 16, 22] }],
    waterfalls: [{ id: 'falls-ne', topXZ: [214, 4], bottomXZ: [212, 22], widthM: 5 }],
  };
  return {
    schemaVersion: 1, provisional: true, kind: 'authored-fixture', mapKind: 'city', mapId: 'city-coast-01', seed: 20261011,
    templateVersion: 2, waterLevelDm: 20, water, startZones: [27, 28, 35, 36], entryCells: [[48, 66]],
    roads: [range(0, 48).map(x => [x, 66] as Cell)],
    suggestedLots: [{ id: 'centre-a', cells: [52, 50, 61, 58] }, { id: 'centre-b', cells: [65, 50, 76, 58] }, { id: 'centre-c', cells: [52, 70, 61, 77] }, { id: 'centre-d', cells: [66, 68, 77, 77] }],
    protectedCells: rectCells([103, 0, 110, 10]),
    camera: { target: [128, 0, 132], yawDeg: 40, pitchDeg: 55, distance: 160 },
    terrain: { baseDm: 25, amplitude: 0.5, hills: [{ x: 107, z: 2, radius: 12, heightDm: 140 }, { x: 122, z: 56, radius: 22, heightDm: 80 }] },
    forests: [[0, 0, 127, 12], [0, 13, 9, 62], [118, 13, 127, 34], [100, 118, 127, 127], [86, 100, 99, 127]],
    rocky: [[112, 40, 127, 72]],
  };
}

/**
 * FARM — docs/04 §2: valley. Waterfall cliff in the north-east feeds a creek that runs just west of the
 * start zones (3–5 cells wide, wooden-bridge span) into the south-west lake; two ponds; rocky hills in
 * the south-east; forest margins. ENTRY on the south edge of zone 36; road leaves the map southwards.
 * The creek begins below the cliff, so the banks meet around its head: authored bank regions (D012/D018).
 */
export function createFarmLayout(): AuthoredLayout {
  const creek: [number, number][] = [[232, 26], [200, 44], [160, 52], [122, 70], [92, 100], [88, 140], [74, 170], [50, 192]];
  const water: WorldTemplate['water'] = {
    lakes: [
      { id: 'lake-sw', polygonXZ: [[0, 160], [38, 166], [72, 186], [96, 214], [100, 240], [92, 256], [0, 256]] },
      { id: 'pond-east', polygonXZ: pond(208, 112, 11) },
      { id: 'pond-south', polygonXZ: pond(176, 176, 9) },
    ],
    rivers: [{ id: 'creek', centerlineXZ: creek, widthM: [6, 7, 8, 8, 8, 9, 10, 12] }],
    waterfalls: [{ id: 'falls-ne', topXZ: [238, 8], bottomXZ: [234, 22], widthM: 6 }],
  };
  const wet = rasterizeWater(water);
  // Side of the creek polyline (extended past its head) decides the bank; cross-product sign per nearest segment.
  const side = (x: number, z: number): number => {
    let best = Infinity, sign = 0;
    for (let i = 1; i < creek.length; i++) {
      const [ax, az] = creek[i - 1]!, [bx, bz] = creek[i]!, dx = bx - ax, dz = bz - az, len = dx * dx + dz * dz;
      const t = i === 1 ? Math.min(1, ((x - ax) * dx + (z - az) * dz) / len) : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len));
      const d = (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2;
      if (d < best) { best = d; sign = Math.sign(dx * (z - az) - dz * (x - ax)); }
    }
    return sign;
  };
  const home: Cell[] = [], far: Cell[] = [];
  const entrySide = side(72 * 2 + 1, 79 * 2 + 1);
  for (let z = 0; z < 128; z++) for (let x = 0; x < 128; x++) if (!wet[z * 128 + x]) (side(x * 2 + 1, z * 2 + 1) === entrySide ? home : far).push([x, z]);
  return {
    schemaVersion: 1, provisional: true, kind: 'authored-fixture', mapKind: 'farm', mapId: 'farm-valley-01', seed: 20261012,
    templateVersion: 2, waterLevelDm: 30, water, startZones: [27, 28, 35, 36], entryCells: [[72, 79]],
    roads: [range(79, 127).map(z => [72, z] as Cell)],
    suggestedLots: [{ id: 'fields-west', cells: [49, 52, 56, 62] }, { id: 'yard-north', cells: [62, 50, 72, 57] }, { id: 'fields-south', cells: [50, 68, 58, 76] }, { id: 'yard-east', cells: [74, 62, 79, 72] }],
    bankRegions: [{ id: 'home-bank', cells: home }, { id: 'far-bank', cells: far }],
    protectedCells: rectCells([113, 0, 122, 12]),
    camera: { target: [130, 0, 136], yawDeg: 10, pitchDeg: 55, distance: 160 },
    terrain: { baseDm: 25, amplitude: 1, hills: [{ x: 119, z: 4, radius: 18, heightDm: 170 }, { x: 110, z: 108, radius: 20, heightDm: 120 }, { x: 8, z: 30, radius: 26, heightDm: 60 }] },
    forests: [[0, 0, 12, 80], [13, 0, 60, 10], [116, 20, 127, 80], [24, 112, 60, 127]],
    rocky: [[98, 90, 127, 127], [100, 0, 112, 18]],
  };
}
