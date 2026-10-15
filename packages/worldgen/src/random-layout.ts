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

function noise2D(seed: number, x: number, z: number): number {
  const sample = (sx: number, sz: number) => hash32(seed, sx, sz, 'rnd-lake') / 4294967295 * 2 - 1;
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const tx = fx * fx * (3 - 2 * fx), tz = fz * fz * (3 - 2 * fz);
  const top = sample(ix, iz) * (1 - tx) + sample(ix + 1, iz) * tx;
  const bottom = sample(ix, iz + 1) * (1 - tx) + sample(ix + 1, iz + 1) * tx;
  return top * (1 - tz) + bottom * tz;
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

interface LakeSpec {
  id: string;
  cx: number;
  cz: number;
  baseR: number;
}

export function generateRandomLayout(
  mapKind: MapKind,
  seed: number,
  attempt = 0,
): RandomAuthoredLayout {
  const waterLevelDm = mapKind === 'farm' ? 30 : 20;

  // Fast internal trial loop to pre-validate water topology and bridge constraints in < 15ms
  for (let trial = 0; trial < 100; trial++) {
    const subSeed = hash32(seed, attempt * 100 + trial, mapKind === 'city' ? 101 : 202, 'rnd-v12');
    const rng = mulberry32(subSeed);

    // 1. Khu khởi đầu: 4 khu (2x2) gần giữa map
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

    // 2. Sông chính (Main river): chảy từ mép này sang mép khác qua góc startZones
    const corner = Math.floor(rng() * 4);
    const cutOffset = 28 + Math.floor(rng() * 3); // 28..30 m for ample far-bank land

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
      if (inSZ < 45) return 7.5; // Nhịp cầu 3-4 ô nước trong startZones
      return 11.5;
    });

    // Tributary 1
    const forkProgress1 = 0.15 + rng() * 0.70;
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
    const trib1Widths: number[] = trib1Centerline.map(pt => {
      const distToFork = Math.hypot(pt[0] - forkP1[0], pt[1] - forkP1[1]);
      if (distToFork < 25) return 4.0 + (distToFork / 25) * 2.0;
      return 6.0;
    });

    // Sông thứ 2 (River 2) chạy ngang ở nửa còn lại của bản đồ
    const r2SideZ = (szCenterM_z > 128) ? 48 : 208;
    const r2Start: [number, number] = [0, r2SideZ + Math.round(rng() * 20 - 10)];
    const r2Mid: [number, number] = [128 + Math.round(rng() * 20 - 10), r2SideZ + Math.round(rng() * 20 - 10)];
    const r2End: [number, number] = [256, r2SideZ + Math.round(rng() * 20 - 10)];
    const r2Centerline = smoothPolyline([r2Start, r2Mid, r2End], 3);
    const r2Widths: number[] = r2Centerline.map(() => 9.5);

    function distToAllRivers(x: number, z: number): number {
      let minD = Infinity;
      for (const r of [mainCenterline, trib1Centerline, r2Centerline]) {
        for (let i = 1; i < r.length; i++) {
          const dx = r[i]![0] - r[i - 1]![0], dz = r[i]![1] - r[i - 1]![1], len = dx * dx + dz * dz;
          const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - r[i - 1]![0]) * dx + (z - r[i - 1]![1]) * dz) / len));
          const d = Math.hypot(x - (r[i - 1]![0] + t * dx), z - (r[i - 1]![1] + t * dz));
          if (d < minD) minD = d;
        }
      }
      return minD;
    }

    // 3. Hồ nước: 4–5 hồ ở các giao điểm khu cách xa sông
    const allJunctions: readonly (readonly [number, number])[] = [
      [64, 64], [192, 64], [64, 192], [192, 192],
      [96, 32], [160, 32], [96, 224], [160, 224],
      [32, 96], [32, 160], [224, 96], [224, 160],
      [32, 32], [224, 32], [32, 224], [224, 224],
      [64, 128], [192, 128], [128, 64], [128, 192],
    ];
    const candidateJunctions = allJunctions.filter(([jx, jz]) =>
      Math.hypot(jx - szCenterM_x, jz - szCenterM_z) > 60 && distToAllRivers(jx, jz) > 34,
    );

    const safeJunctions: [number, number][] = [];
    for (const cand of candidateJunctions) {
      if (safeJunctions.every(([sx, sz]) => Math.hypot(cand[0] - sx, cand[1] - sz) >= 55)) {
        safeJunctions.push([cand[0], cand[1]]);
        if (safeJunctions.length >= 5) break;
      }
    }

    if (safeJunctions.length < 3) continue;

    const majorR = 23.0 + rng() * 1.0;
    const minorR1 = 14.5 + rng() * 1.0;
    const minorR2 = 13.0 + rng() * 1.0;
    const minorR3 = 11.5 + rng() * 1.0;
    const minorR4 = 10.5 + rng() * 1.0;

    const lakeSpecs: LakeSpec[] = [
      { id: 'l1', cx: safeJunctions[0]![0], cz: safeJunctions[0]![1], baseR: majorR },
    ];
    if (safeJunctions.length > 1) lakeSpecs.push({ id: 'l2', cx: safeJunctions[1]![0], cz: safeJunctions[1]![1], baseR: minorR1 });
    if (safeJunctions.length > 2) lakeSpecs.push({ id: 'l3', cx: safeJunctions[2]![0], cz: safeJunctions[2]![1], baseR: minorR2 });
    if (safeJunctions.length > 3) lakeSpecs.push({ id: 'l4', cx: safeJunctions[3]![0], cz: safeJunctions[3]![1], baseR: minorR3 });
    if (safeJunctions.length > 4) lakeSpecs.push({ id: 'l5', cx: safeJunctions[4]![0], cz: safeJunctions[4]![1], baseR: minorR4 });

    const allRadii = lakeSpecs.map(l => l.baseR);
    const areas = allRadii.map(r => Math.PI * r * r);
    const meanArea = areas.reduce((s, a) => s + a, 0) / areas.length;
    const varArea = areas.reduce((s, a) => s + (a - meanArea) ** 2, 0) / areas.length;
    const lakeCV = Math.sqrt(varArea) / meanArea;
    if (lakeCV < 0.43) continue;

    function buildLakes(specs: typeof lakeSpecs): WorldTemplate['water']['lakes'] {
      return specs.map((s, lIdx) => {
        const polygon: [number, number][] = [];
        const numVerts = 18;
        for (let i = 0; i < numVerts; i++) {
          const a = (i / numVerts) * Math.PI * 2;
          const vx = Math.cos(a), vz = Math.sin(a);
          const n = noise2D(subSeed + lIdx * 10, s.cx / 20 + vx * 1.5, s.cz / 20 + vz * 1.5);
          const r = s.baseR * (1 + 0.12 * n);
          polygon.push([
            Math.round(Math.max(2, Math.min(254, s.cx + vx * r))),
            Math.round(Math.max(2, Math.min(254, s.cz + vz * r))),
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
        { id: 'r2', centerlineXZ: r2Centerline, widthM: r2Widths },
      ],
      waterfalls: [],
    };

    // Fast convergence of total water
    for (let iter = 0; iter < 10; iter++) {
      const mask = rasterizeWater(water);
      let count = 0;
      for (let i = 0; i < mask.length; i++) if (mask[i]) count++;
      if (count >= 3255 && count <= 3315) break;
      const scale = Math.sqrt(3277 / Math.max(1, count));
      const clamped = Math.max(0.92, Math.min(1.08, scale));
      for (const spec of lakeSpecs) spec.baseR = Math.max(9, Math.min(22.0, spec.baseR * clamped));
      for (let j = 0; j < mainWidths.length; j++) {
        if (Math.hypot(mainCenterline[j]![0] - szCenterM_x, mainCenterline[j]![1] - szCenterM_z) >= 45) {
          mainWidths[j] = Math.max(7, Math.min(12.0, mainWidths[j]! * clamped));
        }
      }
      for (let j = 0; j < trib1Widths.length; j++) trib1Widths[j] = Math.max(4.5, Math.min(7.5, trib1Widths[j]! * clamped));
      for (let j = 0; j < r2Widths.length; j++) r2Widths[j] = Math.max(6.5, Math.min(11.0, r2Widths[j]! * clamped));
      water.lakes = buildLakes(lakeSpecs);
    }

    const finalMask = rasterizeWater(water);
    const totalWater = finalMask.reduce((s, w) => s + w, 0);
    if (totalWater < 3120 || totalWater > 3435) continue;

    const lakeOnly = rasterizeWater({ lakes: water.lakes, rivers: [], waterfalls: [] });
    const lakeWater = lakeOnly.reduce((s, w) => s + w, 0);
    const lakeShare = lakeWater / totalWater;
    if (lakeShare > 0.60) continue;

    let maxZ = 0, minDry = 256;
    for (let zid = 0; zid < 64; zid++) {
      const ox = (zid % 8) * 16, oz = Math.floor(zid / 8) * 16;
      let zw = 0;
      for (let dz = 0; dz < 16; dz++) for (let dx = 0; dx < 16; dx++) {
        if (finalMask[(oz + dz) * 128 + (ox + dx)]) zw++;
      }
      if (zw > maxZ) maxZ = zw;
      if (256 - zw < minDry) minDry = 256 - zw;
    }
    if (maxZ > 153 || minDry < 103) continue;

    let startWater = 0;
    for (const zid of startZones) {
      const ox = (zid % 8) * 16, oz = Math.floor(zid / 8) * 16;
      for (let dz = 0; dz < 16; dz++) for (let dx = 0; dx < 16; dx++) {
        if (finalMask[(oz + dz) * 128 + (ox + dx)]) startWater++;
      }
    }
    if (startWater > 101) continue;

    // 5. Địa hình gồ ghề: 5–7 đồi/rặng núi ngoài khu khởi đầu
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
      const heightDm = 90 + Math.floor(rng() * 25); // 9..11.5 m (chênh cao toàn map 16..22m)
      hills.push({ x: hx, z: hz, radius, heightDm });
    }

    // 6. Gợi ý lô đất
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

  throw new Error(`Failed to generate playable layout for ${mapKind} seed ${seed} after internal trials`);
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

  // 8. Tỉ lệ ô bờ có chênh cao bờ–nước > 2 m <= 10%
  let totalShoreCells = 0;
  let steepShoreCells = 0;
  for (let cz = 0; cz < 128; cz++) {
    for (let cx = 0; cx < 128; cx++) {
      const idx = cz * 128 + cx;
      if (water[idx]) continue;
      let isShore = false;
      for (const [nx, nz] of [[cx - 1, cz], [cx + 1, cz], [cx, cz - 1], [cx, cz + 1]]) {
        if (nx! >= 0 && nx! < 128 && nz! >= 0 && nz! < 128 && water[nz! * 128 + nx!]) {
          isShore = true;
          break;
        }
      }
      if (isShore) {
        totalShoreCells++;
        const verts = cellVertices(cx, cz).map(v => layers.heightsDm[v]!);
        const meanH = (verts[0]! + verts[1]! + verts[2]! + verts[3]!) / 4;
        if (meanH - template.waterLevelDm > 20) {
          steepShoreCells++;
        }
      }
    }
  }
  const steepRatio = totalShoreCells > 0 ? steepShoreCells / totalShoreCells : 0;
  if (steepRatio > 0.10) {
    errors.push(`SHORE_HEIGHT_RATIO: ${(steepRatio * 100).toFixed(1)}% (${steepShoreCells}/${totalShoreCells}) shore cells have height > 2m above water, required <= 10%`);
  }

  // 9 & 10. Chỗ bắc cầu <= 6 ô và bờ bên kia >= 24 ô khô, bằng
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
            const deckHeight = Math.max(hH, tH);
            if (Math.abs(hH - tH) <= 10 && Math.abs(hH - deckHeight) <= 10 && Math.abs(tH - deckHeight) <= 10) {
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

  // 11. Chênh cao toàn map: 12-25m (120-250 dm)
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

  // 12. Cây/đá trong khu khởi đầu không chặn quá 25% số ô xây được
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

  // 13. Ràng buộc đa dạng: Hệ số biến thiên kích thước hồ CV >= 0.4
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
