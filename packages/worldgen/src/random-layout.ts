import {
  type Cell, type MapKind, type WorldTemplate,
} from '@xay-nha/contracts';
import { rasterizeWater, cellFootprint, cellVertices, zoneOfCell } from './geometry';
import { decodeLayers } from './layers';
import { generateZone } from './environment';
import { hash32, mulberry32 } from './random';
import { buildAuthoredTemplate, type AuthoredLayout } from './authored-template';

function catmullRom(
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
  t: number,
): [number, number] {
  const t2 = t * t, t3 = t2 * t;
  const v0 = (p2[0] - p0[0]) * 0.5, v1 = (p3[0] - p1[0]) * 0.5;
  const x = (2 * p1[0] - 2 * p2[0] + v0 + v1) * t3 + (-3 * p1[0] + 3 * p2[0] - 2 * v0 - v1) * t2 + v0 * t + p1[0];
  const u0 = (p2[1] - p0[1]) * 0.5, u1 = (p3[1] - p1[1]) * 0.5;
  const z = (2 * p1[1] - 2 * p2[1] + u0 + u1) * t3 + (-3 * p1[1] + 3 * p2[1] - 2 * u0 - u1) * t2 + u0 * t + p1[1];
  return [Math.round(x), Math.round(z)];
}

function smoothPolyline(pts: readonly [number, number][], steps = 3): [number, number][] {
  const result: [number, number][] = [pts[0] as [number, number]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    for (let s = 1; s <= steps; s++) {
      result.push(catmullRom(p0, p1, p2, p3, s / steps));
    }
  }
  return result;
}

export interface RiverForkInfo {
  x: number;
  z: number;
  distToStartM: number;
  angleToStartDeg: number;
}

export interface GeneratedLayoutMeta {
  fork: RiverForkInfo;
  lakeCV: number;
  lakeRadii: number[];
  elevationRangeM: number;
}

export type RandomAuthoredLayout = AuthoredLayout & { meta: GeneratedLayoutMeta };

export function generateRandomLayout(
  mapKind: MapKind,
  seed: number,
  attempt = 0,
): RandomAuthoredLayout {
  const subSeed = hash32(seed, attempt, mapKind === 'city' ? 101 : 202, 'rnd-v6');
  const rng = mulberry32(subSeed);

  const waterLevelDm = mapKind === 'farm' ? 30 : 20;

  // 1. Khu khởi đầu: 4 khu (2x2) gần giữa map, dịch ngẫu nhiên ±1 khu
  const rowOffset = Math.floor(rng() * 3) - 1; // -1, 0, 1
  const colOffset = Math.floor(rng() * 3) - 1; // -1, 0, 1
  const r0 = 3 + rowOffset; // 2, 3, 4
  const c0 = 3 + colOffset; // 2, 3, 4
  const startZones = [r0 * 8 + c0, r0 * 8 + c0 + 1, (r0 + 1) * 8 + c0, (r0 + 1) * 8 + c0 + 1];

  const szX0 = c0 * 16;
  const szX1 = (c0 + 2) * 16 - 1;
  const szZ0 = r0 * 16;
  const szZ1 = (r0 + 2) * 16 - 1;

  const szM_x0 = szX0 * 2;
  const szM_x1 = (szX1 + 1) * 2;
  const szM_z0 = szZ0 * 2;
  const szM_z1 = (szZ1 + 1) * 2;
  const szCenterM_x = (szM_x0 + szM_x1) / 2;
  const szCenterM_z = (szM_z0 + szM_z1) / 2;

  // 2. Sông chính 1 (Main river): chảy từ một mép qua góc startZones sang mép đối diện
  const corner = Math.floor(rng() * 4);
  const cutOffset = 25 + Math.floor(rng() * 4); // 25..28 m

  let riverInM: [number, number];
  let riverOutM: [number, number];

  if (corner === 0) {
    riverInM = [szM_x0 + cutOffset, szM_z0];
    riverOutM = [szM_x0, szM_z0 + cutOffset];
  } else if (corner === 1) {
    riverInM = [szM_x1 - cutOffset, szM_z0];
    riverOutM = [szM_x1, szM_z0 + cutOffset];
  } else if (corner === 2) {
    riverInM = [szM_x0 + cutOffset, szM_z1];
    riverOutM = [szM_x0, szM_z1 - cutOffset];
  } else {
    riverInM = [szM_x1 - cutOffset, szM_z1];
    riverOutM = [szM_x1, szM_z1 - cutOffset];
  }

  const dirChoice = Math.floor(rng() * 4);
  let mainStart: [number, number];
  let mainEnd: [number, number];

  if (corner === 0 || corner === 1) {
    mainStart = [Math.max(16, Math.min(240, riverInM[0] + (rng() * 30 - 15))), 0];
    if (dirChoice === 0) {
      mainEnd = [corner === 0 ? 0 : 256, Math.max(30, Math.min(230, riverOutM[1] + 45 + rng() * 30))];
    } else {
      mainEnd = [Math.max(16, Math.min(240, (corner === 0 ? 30 : 220) + rng() * 30)), 256];
    }
  } else {
    mainStart = [Math.max(16, Math.min(240, riverInM[0] + (rng() * 30 - 15))), 256];
    if (dirChoice === 0) {
      mainEnd = [corner === 2 ? 0 : 256, Math.max(30, Math.min(230, riverOutM[1] - 45 - rng() * 30))];
    } else {
      mainEnd = [Math.max(16, Math.min(240, (corner === 2 ? 30 : 220) + rng() * 30)), 0];
    }
  }

  const midUp1: [number, number] = [
    Math.round((mainStart[0] + riverInM[0]) / 2 + (rng() * 14 - 7)),
    Math.round((mainStart[1] + riverInM[1]) / 2 + (rng() * 14 - 7)),
  ];
  const midSZ1: [number, number] = [
    Math.round((riverInM[0] + riverOutM[0]) / 2),
    Math.round((riverInM[1] + riverOutM[1]) / 2),
  ];
  const midDown1: [number, number] = [
    Math.round((riverOutM[0] + mainEnd[0]) / 2 + (rng() * 14 - 7)),
    Math.round((riverOutM[1] + mainEnd[1]) / 2 + (rng() * 14 - 7)),
  ];

  const mainCenterline = smoothPolyline([mainStart, midUp1, riverInM, midSZ1, riverOutM, midDown1, mainEnd], 3);
  const mainWidths: number[] = mainCenterline.map(pt => {
    const inSZ = Math.hypot(pt[0] - szCenterM_x, pt[1] - szCenterM_z);
    if (inSZ < 45) return 7.5; // Nhịp cầu 4-5 ô trong startZones
    return 13.0;
  });

  // Nhánh phụ 1 (Tributary 1) tạo ngã ba sông:
  const forkProgress1 = 0.25 + rng() * 0.1;
  const forkIdx1 = Math.floor(forkProgress1 * (mainCenterline.length - 1));
  const forkP1 = mainCenterline[forkIdx1]!;

  const forkInfo: RiverForkInfo = {
    x: forkP1[0],
    z: forkP1[1],
    distToStartM: Math.round(Math.hypot(forkP1[0] - szCenterM_x, forkP1[1] - szCenterM_z)),
    angleToStartDeg: Math.round(Math.atan2(forkP1[1] - szCenterM_z, forkP1[0] - szCenterM_x) * 180 / Math.PI),
  };

  let trib1Start: [number, number];
  if (forkP1[0] < 128) {
    trib1Start = [0, Math.min(240, Math.max(16, forkP1[1] + (rng() * 40 - 20)))];
  } else {
    trib1Start = [256, Math.min(240, Math.max(16, forkP1[1] + (rng() * 40 - 20)))];
  }
  const trib1Mid: [number, number] = [
    Math.round((trib1Start[0] + forkP1[0]) / 2 + (rng() * 10 - 5)),
    Math.round((trib1Start[1] + forkP1[1]) / 2 + (rng() * 10 - 5)),
  ];
  const trib1Centerline = smoothPolyline([trib1Start, trib1Mid, forkP1], 3);
  const trib1Widths: number[] = trib1Centerline.map(() => 8.5);

  // Nhánh phụ 2 (Tributary 2):
  const forkProgress2 = 0.75 + rng() * 0.1;
  const forkIdx2 = Math.floor(forkProgress2 * (mainCenterline.length - 1));
  const forkP2 = mainCenterline[forkIdx2]!;

  let trib2Start: [number, number];
  if (forkP2[0] < 128) {
    trib2Start = [0, Math.min(240, Math.max(16, forkP2[1] + (rng() * 40 - 20)))];
  } else {
    trib2Start = [256, Math.min(240, Math.max(16, forkP2[1] + (rng() * 40 - 20)))];
  }
  const trib2Mid: [number, number] = [
    Math.round((trib2Start[0] + forkP2[0]) / 2 + (rng() * 10 - 5)),
    Math.round((trib2Start[1] + forkP2[1]) / 2 + (rng() * 10 - 5)),
  ];
  const trib2Centerline = smoothPolyline([trib2Start, trib2Mid, forkP2], 3);
  const trib2Widths: number[] = trib2Centerline.map(() => 8.5);

  function distToAllRivers(x: number, z: number): number {
    let minD = Infinity;
    for (const r of [mainCenterline, trib1Centerline, trib2Centerline]) {
      for (let i = 1; i < r.length; i++) {
        const p1 = r[i - 1]!, p2 = r[i]!;
        const dx = p2[0] - p1[0], dz = p2[1] - p1[1];
        const lenSq = dx * dx + dz * dz;
        const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - p1[0]) * dx + (z - p1[1]) * dz) / lenSq));
        const d = Math.hypot(x - (p1[0] + t * dx), z - (p1[1] + t * dz));
        if (d < minD) minD = d;
      }
    }
    return minD;
  }

  // 3. Hồ nước: 4 hồ (1 hồ lớn R=24..26m + 3 ao nhỏ R=12..16m)
  // Đặt tại các giao điểm khu cách xa sông >= 36m, cách startZones >= 60m, cách nhau >= 65m
  const allJunctions: [number, number][] = [
    [64, 64], [192, 64], [64, 192], [192, 192],
    [96, 32], [160, 32], [96, 224], [160, 224],
    [32, 96], [32, 160], [224, 96], [224, 160],
    [32, 32], [224, 32], [32, 224], [224, 224],
    [64, 128], [192, 128], [128, 64], [128, 192],
  ];

  const candidateJunctions = allJunctions.filter(([jx, jz]) =>
    Math.hypot(jx - szCenterM_x, jz - szCenterM_z) > 60 && distToAllRivers(jx, jz) > 36,
  );

  const shuffledJunctions = candidateJunctions.slice();
  for (let i = shuffledJunctions.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffledJunctions[i]!;
    shuffledJunctions[i] = shuffledJunctions[j]!;
    shuffledJunctions[j] = tmp;
  }

  const safeJunctions: [number, number][] = [];
  for (const cand of shuffledJunctions) {
    if (safeJunctions.every(([sx, sz]) => Math.hypot(cand[0] - sx, cand[1] - sz) >= 65)) {
      safeJunctions.push(cand);
      if (safeJunctions.length >= 4) break;
    }
  }

  const majorR = 24.5 + rng() * 1.5;
  const minorR1 = 16.0 + rng() * 1.5;
  const minorR2 = 14.0 + rng() * 1.5;
  const minorR3 = 12.5 + rng() * 1.5;

  interface LakeSpec {
    id: string;
    cx: number;
    cz: number;
    baseR: number;
  }
  const lakeSpecs: LakeSpec[] = [
    { id: 'lake-major', cx: safeJunctions[0]![0], cz: safeJunctions[0]![1], baseR: majorR },
  ];
  if (safeJunctions.length > 1) lakeSpecs.push({ id: 'lake-p1', cx: safeJunctions[1]![0], cz: safeJunctions[1]![1], baseR: minorR1 });
  if (safeJunctions.length > 2) lakeSpecs.push({ id: 'lake-p2', cx: safeJunctions[2]![0], cz: safeJunctions[2]![1], baseR: minorR2 });
  if (safeJunctions.length > 3) lakeSpecs.push({ id: 'lake-p3', cx: safeJunctions[3]![0], cz: safeJunctions[3]![1], baseR: minorR3 });

  const allRadii = lakeSpecs.map(l => l.baseR);
  const areas = allRadii.map(r => Math.PI * r * r);
  const meanArea = areas.reduce((s, a) => s + a, 0) / areas.length;
  const varArea = areas.reduce((s, a) => s + (a - meanArea) ** 2, 0) / areas.length;
  const lakeCV = Math.sqrt(varArea) / meanArea;

  function buildLakes(specs: LakeSpec[]): WorldTemplate['water']['lakes'] {
    return specs.map((s, lIdx) => {
      const polygon: [number, number][] = [];
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const r = s.baseR * (1 + 0.15 * Math.sin(i * 2.3 + lIdx * 1.5));
        polygon.push([
          Math.round(Math.max(2, Math.min(254, s.cx + Math.cos(a) * r))),
          Math.round(Math.max(2, Math.min(254, s.cz + Math.sin(a) * r))),
        ]);
      }
      return { id: s.id, polygonXZ: polygon };
    });
  }

  const water: WorldTemplate['water'] = {
    lakes: buildLakes(lakeSpecs),
    rivers: [
      { id: 'main', centerlineXZ: mainCenterline, widthM: mainWidths },
      { id: 'trib1', centerlineXZ: trib1Centerline, widthM: trib1Widths },
      { id: 'trib2', centerlineXZ: trib2Centerline, widthM: trib2Widths },
    ],
    waterfalls: [],
  };

  // 4. Cân chỉnh nước về chính xác 20.0% (3,277 ô), không lệch về dưới
  for (let iter = 0; iter < 12; iter++) {
    const mask = rasterizeWater(water);
    let count = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) count++;

    if (count >= 3240 && count <= 3315) break;

    const scale = Math.sqrt(3277 / Math.max(1, count));
    const clamped = Math.max(0.92, Math.min(1.08, scale));

    for (const spec of lakeSpecs) {
      spec.baseR = Math.max(9, Math.min(25.5, spec.baseR * clamped));
    }
    for (let j = 0; j < mainWidths.length; j++) {
      if (Math.hypot(mainCenterline[j]![0] - szCenterM_x, mainCenterline[j]![1] - szCenterM_z) >= 45) {
        mainWidths[j] = Math.max(7, Math.min(14.5, mainWidths[j]! * clamped));
      }
    }
    for (let j = 0; j < trib1Widths.length; j++) {
      trib1Widths[j] = Math.max(5, Math.min(9.5, trib1Widths[j]! * clamped));
    }
    for (let j = 0; j < trib2Widths.length; j++) {
      trib2Widths[j] = Math.max(5, Math.min(9.5, trib2Widths[j]! * clamped));
    }
    water.lakes = buildLakes(lakeSpecs);
  }

  // 5. Địa hình gồ ghề: 5–7 đồi/rặng núi ngoài khu khởi đầu, chênh cao 14–22m
  const hills: { x: number; z: number; radius: number; heightDm: number }[] = [];
  const numHills = 5 + Math.floor(rng() * 3);
  const szCenterCellX = (szX0 + szX1) / 2;
  const szCenterCellZ = (szZ0 + szZ1) / 2;

  for (let i = 0; i < numHills; i++) {
    let hx = 0, hz = 0;
    for (let tries = 0; tries < 20; tries++) {
      hx = 14 + Math.floor(rng() * 100);
      hz = 14 + Math.floor(rng() * 100);
      if (Math.hypot(hx - szCenterCellX, hz - szCenterCellZ) > 28) break;
    }
    const radius = 13 + Math.floor(rng() * 8); // 13..20 ô
    const heightDm = 110 + Math.floor(rng() * 25); // 11..13.5 m (đảm bảo chênh cao tổng 15..22m)
    hills.push({ x: hx, z: hz, radius, heightDm });
  }

  // 6. Gợi ý lô đất (suggestedLots): không san phẳng
  const homeCornerX = corner === 0 || corner === 2 ? szX1 - 10 : szX0 + 2;
  const homeCornerZ = corner === 0 || corner === 1 ? szZ1 - 10 : szZ0 + 2;

  const suggestedLots: NonNullable<WorldTemplate['suggestedLots']> = [
    { id: 'lot-a', cells: [homeCornerX, homeCornerZ, homeCornerX + 4, homeCornerZ + 4] },
    { id: 'lot-b', cells: [homeCornerX + 5, homeCornerZ, homeCornerX + 9, homeCornerZ + 4] },
    { id: 'lot-c', cells: [homeCornerX, homeCornerZ + 5, homeCornerX + 4, homeCornerZ + 9] },
    { id: 'lot-d', cells: [homeCornerX + 5, homeCornerZ + 5, homeCornerX + 9, homeCornerZ + 9] },
  ];

  const meta: GeneratedLayoutMeta = {
    fork: forkInfo,
    lakeCV: Math.round(lakeCV * 100) / 100,
    lakeRadii: lakeSpecs.map(l => Math.round(l.baseR * 10) / 10),
    elevationRangeM: 0,
  };

  return {
    schemaVersion: 1,
    provisional: true,
    kind: 'authored-fixture',
    mapKind,
    mapId: `rnd-${mapKind}-${seed}`,
    seed,
    templateVersion: 2,
    waterLevelDm,
    water,
    startZones,
    entryCells: [],
    roads: [],
    suggestedLots,
    protectedCells: [],
    camera: {
      target: [Math.round(szCenterM_x), 0, Math.round(szCenterM_z)],
      yawDeg: 35,
      pitchDeg: 55,
      distance: 160,
    },
    terrain: {
      baseDm: 25,
      amplitude: 0.42,
      hills,
    },
    organicBiomes: true,
    meta,
  };
}

function bridgeEdgeHeight(heights: Int16Array, [x, z]: Cell, [dx, dz]: readonly [number, number]): number {
  const v = dx ? [z * 129 + x + (dx > 0 ? 1 : 0), (z + 1) * 129 + x + (dx > 0 ? 1 : 0)]
    : [(z + (dz > 0 ? 1 : 0)) * 129 + x, (z + (dz > 0 ? 1 : 0)) * 129 + x + 1];
  return (heights[v[0]!]! + heights[v[1]!]!) / 2;
}

export function checkPlayability(template: WorldTemplate, meta?: GeneratedLayoutMeta): string[] {
  const errors: string[] = [];
  const layers = decodeLayers(template);
  const water = rasterizeWater(template.water);
  const totalCells = 128 * 128; // 16384

  // 1. Tổng nước: 20% ± 1% (3.113 - 3.441 ô)
  let totalWater = 0;
  for (let i = 0; i < totalCells; i++) if (water[i]) totalWater++;
  if (totalWater < 3113 || totalWater > 3441) {
    errors.push(`WATER_TOTAL: ${totalWater} cells (${(totalWater / 163.84).toFixed(1)}%), required 3113..3441 (19..21%)`);
  }

  // 2. Nước hồ chiếm <= 60% tổng nước
  const lakeOnlyWater = rasterizeWater({ lakes: template.water.lakes, rivers: [], waterfalls: [] });
  let lakeCells = 0;
  for (let i = 0; i < totalCells; i++) if (lakeOnlyWater[i]) lakeCells++;
  const lakePctOfTotalWater = totalWater > 0 ? (lakeCells / totalWater) * 100 : 0;
  if (lakePctOfTotalWater > 60) {
    errors.push(`LAKE_SHARE_MAX: lakes occupy ${lakePctOfTotalWater.toFixed(1)}% of total water (${lakeCells}/${totalWater}), required <= 60%`);
  }

  // 3. Nước trong khu khởi đầu <= 10% (<= 102 ô)
  const startZonesSet = new Set(template.startZones);
  let startWater = 0;
  const startDryCells: Cell[] = [];
  for (const zid of template.startZones) {
    const ox = (zid % 8) * 16, oz = Math.floor(zid / 8) * 16;
    for (let dz = 0; dz < 16; dz++) for (let dx = 0; dx < 16; dx++) {
      const cx = ox + dx, cz = oz + dz;
      const i = cz * 128 + cx;
      if (water[i]) startWater++;
      else startDryCells.push([cx, cz]);
    }
  }
  if (startWater > 102) {
    errors.push(`WATER_START_ZONE: ${startWater}/1024 (${(startWater / 10.24).toFixed(1)}%), required <= 10% (102 cells)`);
  }

  // 4 & 5. Nước mỗi khu khác <= 60% và mỗi khu >= 40% ô khô
  for (let zid = 0; zid < 64; zid++) {
    const ox = (zid % 8) * 16, oz = Math.floor(zid / 8) * 16;
    let zoneWater = 0;
    for (let dz = 0; dz < 16; dz++) for (let dx = 0; dx < 16; dx++) {
      if (water[(oz + dz) * 128 + (ox + dx)]) zoneWater++;
    }
    if (zoneWater > 153) {
      errors.push(`WATER_ZONE_MAX: zone ${zid} has ${zoneWater}/256 (${(zoneWater / 2.56).toFixed(1)}%) water, required <= 60%`);
    }
    const zoneDry = 256 - zoneWater;
    if (zoneDry < 103) {
      errors.push(`DRY_ZONE_MIN: zone ${zid} has ${zoneDry}/256 (${(zoneDry / 2.56).toFixed(1)}%) dry land, required >= 40%`);
    }
  }

  // 6. Đất bằng xây được trong khu khởi đầu (độ dốc <= 10 dm, khô): >= 55% số ô (>= 564 ô)
  const isFlatDry = new Uint8Array(totalCells);
  let flatBuildable = 0;
  for (const [cx, cz] of startDryCells) {
    const i = cz * 128 + cx;
    const verts = cellVertices(cx, cz).map(v => layers.heightsDm[v]!);
    const slope = Math.max(...verts) - Math.min(...verts);
    if (slope <= 10) {
      flatBuildable++;
      isFlatDry[i] = 1;
    }
  }
  if (flatBuildable < 564) {
    errors.push(`START_ZONE_FLAT: ${flatBuildable}/1024 (${(flatBuildable / 10.24).toFixed(1)}%) flat buildable, required >= 55% (564 cells)`);
  }

  // 7. Ô bờ nước trong khu khởi đầu >= 12 ô
  let shoreCount = 0;
  for (const [cx, cz] of startDryCells) {
    let touchesWater = false;
    for (const [nx, nz] of [[cx - 1, cz], [cx + 1, cz], [cx, cz - 1], [cx, cz + 1]]) {
      if (nx! >= 0 && nx! < 128 && nz! >= 0 && nz! < 128 && water[nz! * 128 + nx!]) {
        touchesWater = true;
        break;
      }
    }
    if (touchesWater) shoreCount++;
  }
  if (shoreCount < 12) {
    errors.push(`START_ZONE_SHORE: ${shoreCount} shore cells in startZones, required >= 12`);
  }

  // 8 & 9. Chỗ bắc cầu <= 6 ô và bờ bên kia >= 24 ô khô, bằng
  const visited = new Uint8Array(totalCells);
  const dryComponents: Cell[][] = [];
  for (const [cx, cz] of startDryCells) {
    const idx = cz * 128 + cx;
    if (visited[idx]) continue;
    const comp: Cell[] = [];
    const queue = [idx];
    visited[idx] = 1;
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head]!;
      const x = cur % 128, z = Math.floor(cur / 128);
      comp.push([x, z]);
      for (const [nx, nz] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]) {
        if (nx! >= 0 && nx! < 128 && nz! >= 0 && nz! < 128) {
          const nIdx = nz! * 128 + nx!;
          if (!visited[nIdx] && !water[nIdx] && startZonesSet.has(zoneOfCell(nx!, nz!))) {
            visited[nIdx] = 1;
            queue.push(nIdx);
          }
        }
      }
    }
    dryComponents.push(comp);
  }

  dryComponents.sort((a, b) => b.length - a.length);
  const homeBank = dryComponents[0] ?? [];
  const homeBankSet = new Set(homeBank.map(([x, z]) => z * 128 + x));

  const farBanks = dryComponents.slice(1);
  let maxFarBankFlat = 0;
  for (const farBank of farBanks) {
    let farFlat = 0;
    for (const [x, z] of farBank) {
      if (isFlatDry[z * 128 + x]) farFlat++;
    }
    if (farFlat > maxFarBankFlat) maxFarBankFlat = farFlat;
  }
  if (maxFarBankFlat < 24) {
    errors.push(`FAR_BANK_FLAT: largest far bank in startZones has only ${maxFarBankFlat} flat cells, required >= 24`);
  }

  let foundBridge = false;
  bridgeSearch:
  for (const [hx, hz] of homeBank) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      for (let span = 1; span <= 6; span++) {
        const mx = hx + dx * span;
        const mz = hz + dz * span;
        if (mx < 0 || mx >= 128 || mz < 0 || mz >= 128 || !water[mz * 128 + mx]) break;
        const tx = hx + dx * (span + 1);
        const tz = hz + dz * (span + 1);
        if (tx >= 0 && tx < 128 && tz >= 0 && tz < 128 && startZonesSet.has(zoneOfCell(tx, tz))) {
          const tIdx = tz * 128 + tx;
          if (!water[tIdx] && !homeBankSet.has(tIdx)) {
            const hH = bridgeEdgeHeight(layers.heightsDm, [hx, hz], [dx, dz]);
            const tH = bridgeEdgeHeight(layers.heightsDm, [tx, tz], [-dx, -dz]);
            if (Math.abs(hH - tH) <= 10) {
              foundBridge = true;
              break bridgeSearch;
            }
          }
        }
      }
    }
  }
  if (!foundBridge) {
    errors.push('BRIDGE_SPAN: no valid wooden bridge location (1..6 water cells) between home and far bank in startZones');
  }

  // 10. Chênh cao toàn map: 12-25m (120-250 dm)
  let minH = Infinity, maxH = -Infinity;
  for (let i = 0; i < layers.heightsDm.length; i++) {
    const h = layers.heightsDm[i]!;
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  const diffDm = maxH - minH;
  if (diffDm < 120 || diffDm > 250) {
    errors.push(`ELEVATION_RANGE: ${(diffDm / 10).toFixed(1)} m (min ${minH / 10}m, max ${maxH / 10}m), required 12..25 m`);
  }
  if (meta) {
    meta.elevationRangeM = Math.round((diffDm / 10) * 10) / 10;
  }

  // 11. Cây/đá trong khu khởi đầu không chặn quá 25% số ô xây được
  let blockedCells = 0;
  for (const zid of template.startZones) {
    const zoneEnv = generateZone(template, zid);
    for (const item of zoneEnv) {
      if (!item.blocking) continue;
      for (const [fx, fz] of cellFootprint(...item.cell, item.footprint)) {
        if (startZonesSet.has(zoneOfCell(fx, fz)) && isFlatDry[fz * 128 + fx]) {
          blockedCells++;
        }
      }
    }
  }
  const blockPct = flatBuildable > 0 ? (blockedCells / flatBuildable) * 100 : 100;
  if (blockPct > 25) {
    errors.push(`START_ZONE_BLOCKING: ${blockPct.toFixed(1)}% (${blockedCells}/${flatBuildable}) buildable cells blocked, required <= 25%`);
  }

  // 12. Ràng buộc đa dạng: Hệ số biến thiên kích thước hồ CV >= 0.4
  if (meta && meta.lakeCV < 0.4) {
    errors.push(`LAKE_CV_MIN: lake size variation CV is ${meta.lakeCV}, required >= 0.4`);
  }

  return errors;
}

export function generateWorldTemplate(
  mapKind: MapKind,
  seed: number,
  maxAttempts = 50,
): { template: WorldTemplate; attempt: number; layout: RandomAuthoredLayout; meta: GeneratedLayoutMeta } {
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const layout = generateRandomLayout(mapKind, seed, attempt);
    const template = buildAuthoredTemplate(layout);
    const errors = checkPlayability(template, layout.meta);
    if (errors.length === 0) {
      return { template, attempt, layout, meta: layout.meta };
    }
    lastErrors = errors;
  }
  throw new Error(`Failed to generate playable ${mapKind} map for seed ${seed} after ${maxAttempts} attempts. Last errors:\n${lastErrors.join('\n')}`);
}
