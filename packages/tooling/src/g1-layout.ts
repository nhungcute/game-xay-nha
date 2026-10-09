import type { Cell } from '@xay-nha/contracts';
import { rasterizeWater } from '@xay-nha/worldgen';
import type { AuthoredLayout } from './authored-template';

/** Compact FARM slice, provisional through G3 art review; not the final docs/04 layout. */
export function createG1FarmLayout(): AuthoredLayout {
  const water: AuthoredLayout['water'] = {
    lakes: [{ id: 'lake-sw', polygonXZ: [[0, 184], [50, 174], [88, 190], [102, 226], [76, 256], [0, 256]] },
      { id: 'pond-east', polygonXZ: [[196, 126], [218, 122], [228, 144], [208, 154], [194, 144]] }],
    rivers: [{ id: 'creek', centerlineXZ: [[224, 20], [190, 36], [124, 56], [124, 186], [74, 212]], widthM: [8, 8, 8, 8, 12] }],
    waterfalls: [{ id: 'falls-ne', topXZ: [224, 8], bottomXZ: [224, 20], widthM: 6 }],
  };
  const wet = rasterizeWater(water), home: Cell[] = [], far: Cell[] = [];
  for (let z = 48; z < 80; z++) for (let x = 48; x < 80; x++) if (!wet[z * 128 + x]) {
    if (x >= 64) home.push([x, z]);
    else if (x <= 59) far.push([x, z]);
  }
  return {
    schemaVersion: 1, provisional: true, kind: 'authored-fixture', mapKind: 'farm', mapId: 'farm-g1', seed: 20261009,
    waterLevelDm: 30, water, startZones: [27, 28, 35, 36], entryCells: [[70, 79]],
    roads: [Array.from({ length: 49 }, (_, index) => [70, 79 + index])],
    suggestedLots: [{ id: 'home-lot', cells: [72, 68, 78, 78] }, { id: 'far-lot', cells: [52, 68, 58, 78] }],
    bankRegions: [{ id: 'entry-bank', cells: home }, { id: 'far-bank', cells: far }],
    protectedCells: Array.from({ length: 10 }, (_, z) => Array.from({ length: 7 }, (_, x) => [109 + x, 3 + z] as Cell)).flat(),
    camera: { target: [128, 3, 140], yawDeg: 25, pitchDeg: 55, distance: 140 },
  };
}
