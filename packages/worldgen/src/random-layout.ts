import {
  type Cell, type MapKind, type WorldTemplate,
} from '@xay-nha/contracts';
import { rasterizeWater, cellFootprint, cellVertices, zoneOfCell } from './geometry';
import { decodeLayers } from './layers';
import { generateZone } from './environment';
import { hash32, mulberry32 } from './random';
import { buildAuthoredTemplate, type AuthoredLayout } from './authored-template';

// 16 directional unit vectors for polygonal lake generation without Math.sin / Math.cos
const DIRS16: readonly [number, number][] = [
  [1.0, 0.0],
  [0.92388, 0.38268],
  [0.70711, 0.70711],
  [0.38268, 0.92388],
  [0.0, 1.0],
  [-0.38268, 0.92388],
  [-0.70711, 0.70711],
  [-0.92388, 0.38268],
  [-1.0, 0.0],
  [-0.92388, -0.38268],
  [-0.70711, -0.70711],
  [-0.38268, -0.92388],
  [0.0, -1.0],
  [0.38268, -0.92388],
  [0.70711, -0.70711],
  [0.92388, -0.38268],
];

export function generateRandomLayout(mapKind: MapKind, seed: number, attempt = 0): AuthoredLayout {
  const subSeed = hash32(seed, attempt, mapKind === 'city' ? 101 : 202, 'rnd-v1');
  const rng = mulberry32(subSeed);

  const waterLevelDm = mapKind === 'farm' ? 30 : 20;

  // 1. Khu khởi đầu: 4 khu (2x2) gần giữa map, tâm được dịch ngẫu nhiên ±1 khu
  const rowOffset = Math.floor(rng() * 3) - 1; // -1, 0, 1
  const colOffset = Math.floor(rng() * 3) - 1; // -1, 0, 1
  const r0 = 3 + rowOffset; // 2, 3, 4
  const c0 = 3 + colOffset; // 2, 3, 4
  const startZones = [r0 * 8 + c0, r0 * 8 + c0 + 1, (r0 + 1) * 8 + c0, (r0 + 1) * 8 + c0 + 1];

  // Start zone boundaries in cells: [szX0..szX1, szZ0..szZ1]
  const szX0 = c0 * 16;
  const szX1 = (c0 + 2) * 16 - 1;
  const szZ0 = r0 * 16;
  const szZ1 = (r0 + 2) * 16 - 1;

  // Start zone coordinates in metres:
  const szM_x0 = szX0 * 2;
  const szM_x1 = (szX1 + 1) * 2;
  const szM_z0 = szZ0 * 2;
  const szM_z1 = (szZ1 + 1) * 2;
  const szCenterM_x = (szM_x0 + szM_x1) / 2;
  const szCenterM_z = (szM_z0 + szM_z1) / 2;

  // 2. Sông: 1 sông chính cắt qua 1 góc của khu khởi đầu.
  // Chiều rộng trong startZones: 7m (3.5 ô nước).
  // cutOffset = 26..30m (13..15 ô) => tam giác ~14x14 ô (98 ô), trừ sông còn ~50 ô khô cho bờ bên kia.
  const corner = Math.floor(rng() * 4);
  const cutOffset = 26 + Math.floor(rng() * 5); // 26..30 m

  let riverInM: [number, number];
  let riverOutM: [number, number];
  let riverStartM: [number, number];
  let riverEndM: [number, number];

  if (corner === 0) {
    // NW corner cut
    riverInM = [szM_x0 + cutOffset, szM_z0];
    riverOutM = [szM_x0, szM_z0 + cutOffset];
    riverStartM = [Math.max(10, riverInM[0] + (rng() * 16 - 8)), 0];
    riverEndM = [0, Math.min(246, riverOutM[1] + 30 + rng() * 30)];
  } else if (corner === 1) {
    // NE corner cut
    riverInM = [szM_x1 - cutOffset, szM_z0];
    riverOutM = [szM_x1, szM_z0 + cutOffset];
    riverStartM = [Math.min(246, riverInM[0] + (rng() * 16 - 8)), 0];
    riverEndM = [256, Math.min(246, riverOutM[1] + 30 + rng() * 30)];
  } else if (corner === 2) {
    // SW corner cut
    riverInM = [szM_x0 + cutOffset, szM_z1];
    riverOutM = [szM_x0, szM_z1 - cutOffset];
    riverStartM = [Math.max(10, riverInM[0] + (rng() * 16 - 8)), 256];
    riverEndM = [0, Math.max(10, riverOutM[1] - 30 - rng() * 30)];
  } else {
    // SE corner cut
    riverInM = [szM_x1 - cutOffset, szM_z1];
    riverOutM = [szM_x1, szM_z1 - cutOffset];
    riverStartM = [Math.min(246, riverInM[0] + (rng() * 16 - 8)), 256];
    riverEndM = [256, Math.max(10, riverOutM[1] - 30 - rng() * 30)];
  }

  const mid1: [number, number] = [
    Math.round((riverStartM[0] + riverInM[0]) / 2 + (rng() * 10 - 5)),
    Math.round((riverStartM[1] + riverInM[1]) / 2 + (rng() * 10 - 5)),
  ];
  const midRiver: [number, number] = [
    Math.round((riverInM[0] + riverOutM[0]) / 2),
    Math.round((riverInM[1] + riverOutM[1]) / 2),
  ];
  const mid2: [number, number] = [
    Math.round((riverOutM[0] + riverEndM[0]) / 2 + (rng() * 10 - 5)),
    Math.round((riverOutM[1] + riverEndM[1]) / 2 + (rng() * 10 - 5)),
  ];

  const riverCenterline: [number, number][] = [
    riverStartM, mid1, riverInM, midRiver, riverOutM, mid2, riverEndM,
  ];
  const riverWidths: number[] = [10, 8, 7, 7, 7, 9, 11];

  // 3. Hồ nước: 7 hồ đặt tại các giao điểm 4 khu (bội số của 32m) ngoài khu khởi đầu
  interface LakeSpec {
    id: string;
    cx: number;
    cz: number;
    radius: number;
  }
  const lakeSpecs: LakeSpec[] = [];

  const gridJunctions: [number, number][] = [
    [32, 32], [96, 32], [160, 32], [224, 32],
    [32, 96], [96, 96], [160, 96], [224, 96],
    [32, 160], [96, 160], [160, 160], [224, 160],
    [32, 224], [96, 224], [160, 224], [224, 224],
    [64, 64], [192, 64], [64, 192], [192, 192],
  ];

  function distToRiver(x: number, z: number): number {
    let minD = Infinity;
    for (let i = 1; i < riverCenterline.length; i++) {
      const p1 = riverCenterline[i - 1]!, p2 = riverCenterline[i]!;
      const dx = p2[0] - p1[0], dz = p2[1] - p1[1];
      const lenSq = dx * dx + dz * dz;
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - p1[0]) * dx + (z - p1[1]) * dz) / lenSq));
      const d = Math.hypot(x - (p1[0] + t * dx), z - (p1[1] + t * dz));
      if (d < minD) minD = d;
    }
    return minD;
  }

  const safeJunctions = gridJunctions.filter(([jx, jz]) => {
    const distToStart = Math.hypot(jx - szCenterM_x, jz - szCenterM_z);
    return distToStart > 58 && distToRiver(jx, jz) > 30;
  });

  const shuffled = safeJunctions.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }

  // Chọn các giao điểm cách nhau ít nhất 60m để không có 2 hồ nào ảnh hưởng cùng 1 khu
  const chosenJunctions: [number, number][] = [];
  for (const candidate of shuffled) {
    if (chosenJunctions.every(([cx, cz]) => Math.hypot(cx - candidate[0], cz - candidate[1]) >= 60)) {
      chosenJunctions.push(candidate);
      if (chosenJunctions.length >= 7) break;
    }
  }

  for (let i = 0; i < chosenJunctions.length; i++) {
    const [jx, jz] = chosenJunctions[i]!;
    const baseR = 22 + rng() * 2; // 22..24 m
    lakeSpecs.push({ id: `lake-${i + 1}`, cx: jx, cz: jz, radius: baseR });
  }

  function buildLakePolygons(specs: LakeSpec[]): WorldTemplate['water']['lakes'] {
    return specs.map(spec => {
      const polygon: [number, number][] = [];
      for (let i = 0; i < 16; i++) {
        const pR = spec.radius * (0.92 + ((i * 5 + attempt) % 5) * 0.04);
        const x = Math.round(Math.max(2, Math.min(254, spec.cx + DIRS16[i]![0] * pR)));
        const z = Math.round(Math.max(2, Math.min(254, spec.cz + DIRS16[i]![1] * pR)));
        polygon.push([x, z]);
      }
      return { id: spec.id, polygonXZ: polygon };
    });
  }

  const water: WorldTemplate['water'] = {
    lakes: buildLakePolygons(lakeSpecs),
    rivers: [{ id: 'main-river', centerlineXZ: riverCenterline, widthM: riverWidths }],
    waterfalls: [],
  };

  // 4. Cân chỉnh tổng nước về 20% ± 1% (3.113 - 3.441 ô trên 16.384)
  for (let iter = 0; iter < 12; iter++) {
    const mask = rasterizeWater(water);
    let wetCount = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) wetCount++;

    if (wetCount >= 3150 && wetCount <= 3400) break;

    const scale = Math.sqrt(3277 / Math.max(1, wetCount));
    const clamped = Math.max(0.85, Math.min(1.18, scale));

    for (const spec of lakeSpecs) {
      spec.radius = Math.max(14, Math.min(26, spec.radius * clamped));
    }
    water.lakes = buildLakePolygons(lakeSpecs);
  }

  // 5. Địa hình: đồi ngoài khu khởi đầu (tọa độ tính bằng ĐƠN VỊ Ô 0..128 để khớp buildAuthoredTemplate)
  const hills: { x: number; z: number; radius: number; heightDm: number }[] = [];
  const numHills = 5 + Math.floor(rng() * 2); // 5..6 hills
  const szCenterCellX = (szX0 + szX1) / 2;
  const szCenterCellZ = (szZ0 + szZ1) / 2;

  for (let i = 0; i < numHills; i++) {
    let hx = 0, hz = 0;
    for (let tries = 0; tries < 20; tries++) {
      hx = 12 + Math.floor(rng() * 104);
      hz = 12 + Math.floor(rng() * 104);
      if (Math.hypot(hx - szCenterCellX, hz - szCenterCellZ) > 28) break;
    }
    const radius = 14 + Math.floor(rng() * 8); // 14..22 ô bán kính
    const heightDm = 140 + Math.floor(rng() * 40); // 14..18 m chiều cao đồi
    hills.push({ x: hx, z: hz, radius, heightDm });
  }

  // 6. Gợi ý lô đất (suggestedLots): 4 lô đất trong khu khởi đầu
  const homeCornerX = corner === 0 || corner === 2 ? szX1 - 12 : szX0 + 2;
  const homeCornerZ = corner === 0 || corner === 1 ? szZ1 - 12 : szZ0 + 2;

  const suggestedLots: NonNullable<WorldTemplate['suggestedLots']> = [
    { id: 'lot-a', cells: [homeCornerX, homeCornerZ, homeCornerX + 5, homeCornerZ + 5] },
    { id: 'lot-b', cells: [homeCornerX + 6, homeCornerZ, homeCornerX + 10, homeCornerZ + 5] },
    { id: 'lot-c', cells: [homeCornerX, homeCornerZ + 6, homeCornerX + 5, homeCornerZ + 10] },
    { id: 'lot-d', cells: [homeCornerX + 6, homeCornerZ + 6, homeCornerX + 10, homeCornerZ + 10] },
  ];

  // 7. Rừng & đá
  const forests: [number, number, number, number][] = [
    [0, 0, 12, 127],
    [115, 0, 127, 127],
    [0, 0, 127, 10],
    [0, 117, 127, 127],
  ];
  const rocky: [number, number, number, number][] = hills.slice(0, 2).map(h => {
    return [Math.max(0, h.x - 6), Math.max(0, h.z - 6), Math.min(127, h.x + 6), Math.min(127, h.z + 6)] as [number, number, number, number];
  });

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
    entryCells: [], // Map random KHÔNG CÓ ô đường nào và entryCells rỗng
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
      amplitude: 0.40,
      hills,
    },
    forests,
    rocky,
  };
}

function bridgeEdgeHeight(heights: Int16Array, [x, z]: Cell, [dx, dz]: readonly [number, number]): number {
  const v = dx ? [z * 129 + x + (dx > 0 ? 1 : 0), (z + 1) * 129 + x + (dx > 0 ? 1 : 0)]
    : [(z + (dz > 0 ? 1 : 0)) * 129 + x, (z + (dz > 0 ? 1 : 0)) * 129 + x + 1];
  return (heights[v[0]!]! + heights[v[1]!]!) / 2;
}

export function checkPlayability(template: WorldTemplate): string[] {
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

  // 2. Nước trong khu khởi đầu <= 10% (<= 102 ô)
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

  // 3 & 4. Nước mỗi khu khác <= 60% (<= 153 ô) và mỗi khu >= 40% ô khô (>= 103 ô)
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

  // 5. Đất bằng xây được trong khu khởi đầu (độ dốc <= 10 dm, khô): >= 55% số ô (>= 564 ô)
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

  // 6. Ô bờ nước trong khu khởi đầu >= 12 ô
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

  // 7 & 8. Chỗ bắc cầu <= 6 ô và bờ bên kia >= 24 ô khô, bằng
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

  // Tìm chỗ bắc cầu gỗ hợp lệ (nhịp nước 1..6 ô thẳng hàng giữa homeBank và farBank)
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

  // 9. Chênh cao toàn map: 12-25m (120-250 dm)
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

  // 10. Cây/đá trong khu khởi đầu không chặn quá 25% số ô xây được
  // Tối ưu: chỉ sinh env cho 4 startZones thay vì 64 zones
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

  return errors;
}

export function generateWorldTemplate(
  mapKind: MapKind,
  seed: number,
  maxAttempts = 50,
): { template: WorldTemplate; attempt: number; layout: AuthoredLayout } {
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const layout = generateRandomLayout(mapKind, seed, attempt);
    const template = buildAuthoredTemplate(layout);
    const errors = checkPlayability(template);
    if (errors.length === 0) {
      return { template, attempt, layout };
    }
    lastErrors = errors;
  }
  throw new Error(`Failed to generate playable ${mapKind} map for seed ${seed} after ${maxAttempts} attempts. Last errors:\n${lastErrors.join('\n')}`);
}
