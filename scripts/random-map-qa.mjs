// D039 step 4: in-game QA of random maps. 6 seeds per map kind, routed through the existing trick of answering
// **/worlds/farm-g1/template.v1.json with a generated template (offline dev server, ?debug=1&test=1).
// Per seed: overview at 13:00 and 23:00, river and lake close-ups, and a real flow (short dirt road, a building next to it,
// time passes, income arrives). Gates: draw calls <= 300 and triangles <= 1.5M at the overview shots, zero console errors.
// Usage: BASE_URL=http://127.0.0.1:5195 node --import tsx scripts/random-map-qa.mjs   (exit 1 on any failed gate)
// Env: QA_SEEDS (default 6), QA_KEEP (shots kept per kind, default 2 seeds), BROWSER_EXECUTABLE.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { generateWorldTemplate, generateEnvironment } from '../packages/worldgen/src/index.ts';
import { access, advanceTime, createState, execute, recompute } from '../packages/sim/src/index.ts';
import { catalog } from '../packages/content/src/index.ts';
import { Surface } from '../packages/contracts/src/index.ts';
import { dismissLevelUp } from './lib/hud.mjs';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:5195';
const SEEDS = Number(process.env.QA_SEEDS ?? 6), KEEP = Number(process.env.QA_KEEP ?? 2);
const OUT_DIR = 'docs/evidence/g4/random-maps/qa';
const START_SEED = 20260100, MAX_CALLS = 300, MAX_TRIS = 1_500_000;
await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

/** Plans the real flow against a local copy of the sim, so the page replays commands that are known to be legal. */
function planFlow(template) {
  const T0 = Date.UTC(2026, 9, 10, 8, 0, 0);
  let now = T0;
  let st = createState(template, now, generateEnvironment(template), { worldId: 'qa', accountId: 'qa', displayName: 'QA', tag: '0001' });
  recompute(st);
  const steps = [];
  const run = (type, payload) => {
    const cmd = { type, payload, commandId: randomUUID(), worldId: st.snapshot.worldId, expectedRevision: st.snapshot.revision, clientTime: now };
    const res = execute(st, cmd, now);
    if (res.result.accepted) { st = res.state; steps.push({ type, payload }); }
    return res.result.accepted;
  };
  const advance = ms => { now += ms; advanceTime(st, now); steps.push({ type: 'ADVANCE', ms }); };
  const clearEnv = cells => {
    const ids = [...new Set(cells.map(([x, z]) => st.occupancy.get(z * 128 + x)).filter(id => id !== undefined && st.env.some(e => e.id === id)))];
    return !ids.length || run('CLEAR_ENV', { envIds: ids });
  };
  const sz = template.startZones, cx = sz.reduce((a, z) => a + (z % 8) * 16 + 8, 0) / sz.length, cz = sz.reduce((a, z) => a + Math.floor(z / 8) * 16 + 8, 0) / sz.length;
  const dist = ([x, z]) => Math.abs(x - cx) + Math.abs(z - cz);
  const unlocked = new Set(st.snapshot.unlockedZones);
  const dry = ([x, z]) => unlocked.has(Math.floor(z / 16) * 8 + Math.floor(x / 16)) && st.surface[z * 128 + x] !== Surface.WATER;

  // 1. A short dirt road: 6 cells in a row, as close to the middle of the start zones as the terrain allows.
  const runs = [];
  for (let z = 1; z < 127; z++) for (let x = 1; x < 120; x++) {
    const cells = Array.from({ length: 6 }, (_, i) => [x + i, z]);
    if (cells.every(dry)) runs.push({ cells, d: dist(cells[3]) });
  }
  runs.sort((a, b) => a.d - b.d);
  let road;
  for (const candidate of runs.slice(0, 40)) {
    if (clearEnv(candidate.cells) && run('BUILD_ROAD', { tier: 1, cells: candidate.cells })) { road = candidate.cells; break; }
  }
  if (!road) return { error: 'no 6-cell dirt road could be built near the start zones' };

  // 2. A building next to the road (it must have road access, otherwise it would not earn).
  const kind = template.mapKind;
  const defId = kind === 'city' ? 'house_small' : 'farmhouse';
  const def = catalog.buildings[defId];
  const [bw, bh] = def.size;
  let placed;
  const anchors = [];
  for (let x = road[0][0] - bw + 1; x <= road[5][0]; x++) { anchors.push([x, road[0][1] - bh], [x, road[0][1] + 1]); }
  for (const anchor of anchors) {
    const cells = [];
    for (let dz = 0; dz < bh; dz++) for (let dx = 0; dx < bw; dx++) cells.push([anchor[0] + dx, anchor[1] + dz]);
    if (!cells.every(dry) || !clearEnv(cells)) continue;
    if (!run('PLACE_BUILDING', { defId, anchor, rotation: 0 })) {
      run('TERRAFORM', { rect: [anchor[0], anchor[1], anchor[0] + bw - 1, anchor[1] + bh - 1], mode: 'FLATTEN' });
      if (!run('PLACE_BUILDING', { defId, anchor, rotation: 0 })) continue;
    }
    placed = st.snapshot.buildings.at(-1);
    if (access(st, placed) > 0) break;
    placed = undefined;
  }
  if (!placed) return { error: `no ${defId} could be placed next to the road` };

  // 3. Time passes and income arrives.
  advance(20 * 60 * 1000);
  const cashBefore = st.snapshot.wallet.cash;
  let incomeCash = 0;
  if (kind === 'city') {
    advance(2 * 3600 * 1000);
    const b = st.snapshot.buildings.find(item => item.id === placed.id);
    if (!run('COLLECT', { buildingIds: [b.id] })) return { error: 'COLLECT rejected' };
    incomeCash = st.snapshot.wallet.cash - cashBefore;
  } else {
    // Farm: a market next to the road, a few field cells, one crop cycle, then sell.
    let market;
    const mdef = catalog.buildings.market;
    for (let x = road[0][0] - 2; x <= road[5][0] && !market; x++) for (const z of [road[0][1] - 3, road[0][1] + 1]) {
      const anchor = [x, z], cells = [];
      for (let dz = 0; dz < mdef.size[1]; dz++) for (let dx = 0; dx < mdef.size[0]; dx++) cells.push([x + dx, z + dz]);
      if (!cells.every(dry) || !clearEnv(cells)) continue;
      if (run('PLACE_BUILDING', { defId: 'market', anchor, rotation: 0 }) && access(st, st.snapshot.buildings.at(-1)) > 0) { market = anchor; break; }
    }
    if (!market) return { error: 'no market could be placed next to the road' };
    advance(20 * 60 * 1000);
    let field;
    for (let z = Math.max(1, Math.round(cz) - 12); z < Math.min(127, Math.round(cz) + 12) && !field; z++) for (let x = Math.max(1, Math.round(cx) - 12); x < Math.round(cx) + 6 && !field; x++) {
      const cells = Array.from({ length: 6 }, (_, i) => [x + i, z]);
      if (cells.every(dry) && clearEnv(cells) && run('TILL', { rect: [x, z, x + 5, z] })) field = [x, z];
    }
    if (!field) return { error: 'no field could be tilled' };
    if (!run('PLANT', { rect: [field[0], field[1], field[0] + 5, field[1]], cropId: 'veg_greens' })) return { error: 'PLANT rejected' };
    const cashBeforeSale = st.snapshot.wallet.cash;
    advance((catalog.crops.veg_greens.growSeconds + 120) * 1000);
    if (!run('HARVEST', { cells: Array.from({ length: 6 }, (_, i) => [field[0] + i, field[1]]) })) return { error: 'HARVEST rejected' };
    if (!run('SELL', { items: { ...st.snapshot.inventory } })) return { error: 'SELL rejected' };
    incomeCash = st.snapshot.wallet.cash - cashBeforeSale;
  }
  return { steps, road, placed: { defId, anchor: placed.anchor }, incomeCash, focus: placed.anchor };
}

const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const report = { at: new Date().toISOString(), baseUrl: BASE_URL, gates: { maxDrawCalls: MAX_CALLS, maxTriangles: MAX_TRIS, consoleErrors: 0 }, seeds: [] };
const failures = [];

for (const kind of ['city', 'farm']) {
  for (let i = 0; i < SEEDS; i++) {
    const seed = START_SEED + i, label = `${kind}-${seed}`;
    const keep = i < KEEP;
    const row = { kind, seed, label, errors: [], metrics: {}, flow: null };
    report.seeds.push(row);
    const { template } = generateWorldTemplate(kind, seed);
    const flow = planFlow(template);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('console', msg => { if (msg.type() === 'error' && !/favicon/.test(msg.text())) row.errors.push(msg.text().slice(0, 300)); });
    page.on('pageerror', error => row.errors.push(String(error.message ?? error).slice(0, 300)));
    await page.route('**/worlds/farm-g1/template.v1.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(template) }));
    await page.goto(`${BASE_URL}/?debug=1&test=1`);
    await page.waitForFunction(() => !!window.__debug?.camera, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const shot = async (name, hour, view) => {
      await page.evaluate(({ hour, view }) => { window.__debug.timeOfDay(hour); window.__debug.camera(view.x, view.z, view.d, view.yaw, view.pitch); }, { hour, view });
      await dismissLevelUp(page); await page.waitForTimeout(1400); await dismissLevelUp(page);
      const metrics = await page.evaluate(() => { const m = window.__debug.metrics(); return { drawCalls: m.drawCalls, triangles: m.triangles, fps: Math.round(m.fps) }; });
      row.metrics[name] = metrics;
      if (keep) await page.screenshot({ path: `${OUT_DIR}/${label}-${name}.jpg`, type: 'jpeg', quality: 62 });
      return metrics;
    };
    const [tx, , tz] = template.camera.target;
    const sz = template.startZones, cx = sz.reduce((a, z) => a + (z % 8) * 32 + 16, 0) / sz.length, cz = sz.reduce((a, z) => a + Math.floor(z / 8) * 32 + 16, 0) / sz.length; // meters
    for (const [name, hour] of [['overview-1300', 13], ['overview-2300', 23]]) {
      const m = await shot(name, hour, { x: tx, z: tz, d: 165, yaw: 35, pitch: 48 });
      if (m.drawCalls > MAX_CALLS) failures.push(`${label} ${name}: ${m.drawCalls} draw calls > ${MAX_CALLS}`);
      if (m.triangles > MAX_TRIS) failures.push(`${label} ${name}: ${m.triangles} triangles > ${MAX_TRIS}`);
    }
    // River close-up (the river point nearest the start zones) and lake shore close-up (nearest lake).
    let best, bestD = Infinity;
    for (const river of template.water.rivers) for (const [x, z] of river.centerlineXZ) { const d = Math.hypot(x - cx, z - cz); if (d < bestD && x > 8 && x < 248 && z > 8 && z < 248) { bestD = d; best = [x, z]; } }
    if (best) await shot('river', 13, { x: best[0], z: best[1], d: 55, yaw: 30, pitch: 38 });
    let lake, lakeD = Infinity;
    for (const l of template.water.lakes) {
      const mx = l.polygonXZ.reduce((a, p) => a + p[0], 0) / l.polygonXZ.length, mz = l.polygonXZ.reduce((a, p) => a + p[1], 0) / l.polygonXZ.length;
      const d = Math.hypot(mx - cx, mz - cz); if (d < lakeD) { lakeD = d; lake = [mx, mz]; }
    }
    if (lake) await shot('lake', 13, { x: lake[0], z: lake[1], d: 70, yaw: -30, pitch: 40 });
    for (const wf of template.water.waterfalls) await shot(`waterfall-${wf.id}`, 13, { x: wf.topXZ[0], z: wf.topXZ[1], d: 45, yaw: 30, pitch: 35 });

    // Real flow in the page.
    if (flow.error) { row.flow = { ok: false, error: flow.error }; failures.push(`${label} flow: ${flow.error}`); }
    else {
      const out = await page.evaluate(async steps => {
        const results = [];
        for (const step of steps) {
          if (step.type === 'ADVANCE') { window.__debug.advance(step.ms); results.push(true); continue; }
          results.push(window.__debug.command(step.type, step.payload).accepted === true);
        }
        const snap = window.__debug.snapshot();
        return { results, cash: snap.wallet.cash, buildings: snap.buildings.map(b => ({ defId: b.defId, status: b.status })) };
      }, flow.steps);
      const rejected = flow.steps.filter((_, k) => !out.results[k]).map(s => s.type);
      row.flow = { ok: rejected.length === 0 && flow.incomeCash > 0, roadCells: flow.road.length, building: flow.placed, incomeCash: flow.incomeCash, pageRejected: rejected, buildings: out.buildings };
      if (rejected.length) failures.push(`${label} flow: page rejected ${rejected.join(',')}`);
      if (!(flow.incomeCash > 0)) failures.push(`${label} flow: no income earned`);
      await shot('flow', 13, { x: flow.road[3][0] * 2, z: flow.road[3][1] * 2, d: 40, yaw: 30, pitch: 42 });
    }
    await page.waitForTimeout(300);
    if (row.errors.length) failures.push(`${label}: ${row.errors.length} console error(s): ${row.errors[0]}`);
    console.log(`${label}: ${JSON.stringify(row.metrics['overview-1300'])} night ${JSON.stringify(row.metrics['overview-2300'])} flow ${row.flow?.ok ? 'ok +' + row.flow.incomeCash : 'FAILED'} errors ${row.errors.length}`);
    await page.close();
  }
}
await browser.close();
report.passed = failures.length === 0;
report.failures = failures;
await writeFile(`${OUT_DIR}/qa.json`, JSON.stringify(report, null, 2));
console.log(report.passed ? 'random-map QA PASSED' : `random-map QA FAILED:\n${failures.join('\n')}`);
process.exitCode = report.passed ? 0 : 1;
