/** Builds the G3 CITY and FARM templates (docs/03, docs/04) and prints docs/03 §6 / docs/04 §6 QA facts. */
import { mkdir, writeFile } from 'node:fs/promises';
import { cellIndex, Surface, type WorldTemplate } from '@xay-nha/contracts';
import { decodeLayers, generateEnvironment, validateTemplate } from '@xay-nha/worldgen';
import { buildAuthoredTemplate } from '../packages/tooling/src/authored-template';
import { createCityLayout, createFarmLayout } from '../packages/tooling/src/maps';

function facts(t: WorldTemplate) {
  const l = decodeLayers(t), env = generateEnvironment(t);
  const zoneCells = (zone: number) => { const out: [number, number][] = []; for (let z = Math.floor(zone / 8) * 16; z < Math.floor(zone / 8) * 16 + 16; z++) for (let x = (zone % 8) * 16; x < (zone % 8) * 16 + 16; x++) out.push([x, z]); return out; };
  const start = t.startZones.flatMap(zoneCells);
  const h = (vx: number, vz: number) => l.heightsDm[vz * 129 + vx]!;
  const slope = (x: number, z: number) => { const v = [h(x, z), h(x + 1, z), h(x, z + 1), h(x + 1, z + 1)]; return Math.max(...v) - Math.min(...v); };
  const blocked = new Set(env.filter(e => e.blocking).map(e => cellIndex(...e.cell)));
  const buildable = start.filter(([x, z]) => l.surface[cellIndex(x, z)] !== Surface.WATER && !l.roadTier[cellIndex(x, z)] && slope(x, z) <= 10).length;
  const free = start.filter(([x, z]) => l.surface[cellIndex(x, z)] !== Surface.WATER && !blocked.has(cellIndex(x, z))).length;
  const water = l.surface.reduce((n, s) => n + Number(s === Surface.WATER), 0);
  const nearWater = start.filter(([x, z]) => { for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) { const nx = x + dx, nz = z + dz; if (nx >= 0 && nz >= 0 && nx < 128 && nz < 128 && l.surface[cellIndex(nx, nz)] === Surface.WATER) return true; } return false; }).length;
  // Narrowest straight water span (x or z direction) with dry, unprotected ends — the cheapest bridge.
  let span = Infinity;
  for (let z = 0; z < 128; z++) for (let x = 0; x < 128; x++) for (const [dx, dz] of [[1, 0], [0, 1]]) {
    const i = cellIndex(x, z); if (l.surface[i] === Surface.WATER) continue;
    let n = 0, cx = x + dx, cz = z + dz;
    while (cx < 128 && cz < 128 && l.surface[cellIndex(cx, cz)] === Surface.WATER) { n++; cx += dx; cz += dz; }
    if (n > 0 && cx < 128 && cz < 128 && n < span) span = n;
  }
  // Bridge-relevant spans: city river belt (rows 5–35, measured along z per column); farm creek beside the start (rows 48–79, along x).
  const runs: number[] = [];
  if (t.mapKind === 'city') for (let x = 0; x < 128; x++) { let n = 0; for (let z = 5; z <= 35; z++) if (l.surface[cellIndex(x, z)] === Surface.WATER) n++; if (n) runs.push(n); }
  else for (let z = 48; z <= 79; z++) { let n = 0; for (let x = 30; x <= 47; x++) if (l.surface[cellIndex(x, z)] === Surface.WATER) n++; if (n) runs.push(n); }
  const mainSpan = { min: Math.min(...runs), max: Math.max(...runs) };
  const heights = Array.from(l.heightsDm);
  return { mapId: t.mapId, version: t.templateVersion, waterPct: +(100 * water / 16384).toFixed(1), startBuildableCells: buildable, startFreeCells: free,
    startCellsWithin3OfWater: nearWater, narrowestWaterSpanCells: span, mainCrossingSpanCells: mainSpan, heightRangeM: (Math.max(...heights) - Math.min(...heights)) / 10, envObjects: env.length,
    blockingEnv: blocked.size, buildings: 0, bridges: 0, tilled: l.surface.reduce((n, s) => n + Number(s === Surface.TILLED), 0) };
}

for (const layout of [createCityLayout(), createFarmLayout()]) {
  const template = buildAuthoredTemplate(layout);
  const errors = validateTemplate(template);
  if (errors.length) throw new Error(`${layout.mapId}: ${errors.slice(0, 5).join('; ')}`);
  const dir = `apps/web/public/worlds/${template.mapId}`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/template.v${template.templateVersion}.json`, JSON.stringify(template) + '\n');
  console.log(JSON.stringify(facts(template)));
}
