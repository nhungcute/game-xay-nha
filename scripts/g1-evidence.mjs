/**
 * G1 browser evidence (docs/14 §0.1b G1 exit criteria, docs/10 §4.1, §5).
 * Requires: `npx tsx scripts/g1-plan.ts` first, and the web dev server (VITE_OFFLINE=1) at BASE_URL.
 * Drives the REAL UI with mouse events (tool buttons + clicks/drags on the 3D canvas).
 * Writes docs/evidence/g1/*.jpg and docs/evidence/g1/g1-evidence.json. Exit code 1 on any failed check.
 */
import { chromium } from '@playwright/test';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5190';
const OUT = 'docs/evidence/g1';
await mkdir(OUT, { recursive: true });
for (const f of await readdir(OUT)) if (f.endsWith('.jpg')) await rm(`${OUT}/${f}`);
const plan = JSON.parse(await readFile('test-results/g1/plan.json', 'utf8'));
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], failedRequests = [], checks = [], shots = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()} @ ${m.location()?.url ?? ''}`); });
page.on('requestfailed', r => failedRequests.push(`failed ${r.url()} ${r.failure()?.errorText ?? ''}`));
page.on('response', r => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); };
const debug = (fn, arg) => page.evaluate(([f, a]) => window.__debug[f](...(a ?? [])), [fn, arg]);
const snap = () => debug('snapshot');
const settle = (ms = 400) => page.waitForTimeout(ms);
let shotNo = 0;
async function shot(name, note) {
  const file = `${OUT}/${String(++shotNo).padStart(2, '0')}-${name}.jpg`;
  await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
  shots.push({ file, note });
}

await page.goto(`${BASE}/?debug=1&test=1`);
await page.waitForFunction(() => !!window.__debug?.loadSnapshot, null, { timeout: 30000 });
await settle(1500);

// ---- 1. Load the level-4 snapshot produced by real sim play (validate-then-swap path) ----
const loaded = await debug('loadSnapshot', [plan.snapshot]);
check('snapshot loads through validateSnapshot', loaded.ok, loaded.errors);
await settle(800);
await debug('camera', [125, 141, 70, 35, 58]);
await settle(600);
await shot('loaded-level4', 'Bản lưu cấp 4 (chơi thật bằng sim) đã nạp; camera tại khu bắc cầu');

const toolLabel = { explore: 'Khám phá', clear: 'Dọn', terraform: 'San nền', till: 'Cuốc', road: 'Đường', embank: 'Kè', bridge: 'Cầu', build: 'Xây', plant: 'Gieo', harvest: 'Thu hoạch', demolish: 'Phá', zone: 'Khu đất' };
async function tool(name) { await page.locator('nav.tools button', { hasText: toolLabel[name] }).first().click(); await settle(150); }
async function at(cell) {
  const p = await debug('project', [cell[0] * 2 + 1, cell[1] * 2 + 1]);
  const tag = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [p.x, p.y]);
  if (tag !== 'CANVAS') throw new Error(`cell ${cell} at ${Math.round(p.x)},${Math.round(p.y)} is covered by ${tag}`);
  return p;
}
async function frame(cells, distance = 80) {
  const xs = cells.map(c => c[0] * 2 + 1), zs = cells.map(c => c[1] * 2 + 1);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  await debug('camera', [cx, cz + 6, distance, 0, 62]); await settle(250);
}
async function click(cell) { const p = await at(cell); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up(); await settle(250); }
async function drag(cells) {
  const first = await at(cells[0]); await page.mouse.move(first.x, first.y); await page.mouse.down();
  for (const c of cells.slice(1)) { const p = await at(c); await page.mouse.move(p.x, p.y, { steps: 3 }); }
  await page.mouse.up(); await settle(300);
}
async function expectRevisionUp(label, before) {
  const after = (await snap()).revision;
  check(`${label} accepted via UI`, after > before, { before, after, message: await page.locator('.feedback span').innerText() });
}
const rectEnds = r => [[r[0], r[1]], [r[2], r[3]]];

// ---- 2. Required tool sequence through the real UI ----
for (const step of plan.steps) {
  const rev = (await snap()).revision;
  switch (step.tool) {
    case 'buy': {
      await page.locator('.resources button').first().click(); await settle(200);
      for (const [material, label] of [['wood', 'Gỗ'], ['stone', 'Đá']]) {
        const item = page.locator('.side.panel .item', { hasText: label });
        for (let i = 0; i < step.options[material] / 10; i++) { await item.locator('button', { hasText: 'Mua 10' }).click(); await settle(80); }
      }
      await page.locator('.side.panel .close').click();
      await expectRevisionUp(step.note, rev); break;
    }
    case 'clear': {
      await tool('clear');
      await frame(rectEnds(step.rect));
      await drag(rectEnds(step.rect));
      await shot('clear-done', step.note);
      await expectRevisionUp(step.note, rev); break;
    }
    case 'road': await tool('road'); await frame(step.cells); await drag(step.cells); await expectRevisionUp(step.note, rev); break;
    case 'embank': await tool('embank'); await frame(step.cells); await click(step.cells[0]); await expectRevisionUp(step.note, rev); break;
    case 'terraform': await tool('terraform'); await frame(rectEnds(step.rect)); await page.locator('.tool-options button', { hasText: 'Phẳng' }).click(); await drag(rectEnds(step.rect)); await expectRevisionUp(step.note, rev); break;
    case 'bridge': await tool('bridge'); await frame(step.cells); await click(step.cells[0]); await click(step.cells[1]); await expectRevisionUp(step.note, rev); break;
    case 'build': {
      await tool('build');
      await page.locator('.catalog button', { hasText: 'Chuồng gà' }).click(); await settle(150);
      await frame([step.cells[0], [step.cells[0][0] - 8, step.cells[0][1]]]);
      const p = await at(step.cells[0]); await page.mouse.move(p.x, p.y); await settle(300);
      await shot('ghost-preview', 'Bóng ma công trình (xanh = hợp lệ) trước khi đặt');
      await click(step.cells[0]); await expectRevisionUp(step.note, rev); break;
    }
    case 'wait': await debug('advance', [step.advanceMs]); await settle(1200); break;
    default: throw new Error(`unknown step ${step.tool}`);
  }
  await tool('explore').catch(() => {});
  await shot(step.tool, step.note);
}
const final = await snap();
const bridge = final.bridges[0], coop = final.buildings.find(b => b.defId === plan.sites.buildingId);
check('wooden bridge exists and is ACTIVE', bridge?.status === 'ACTIVE' && bridge.typeId === 'bridge_wood', bridge);
check('far-bank building exists and is ACTIVE', coop?.status === 'ACTIVE', coop && { status: coop.status, anchor: coop.anchor });
await tool('explore');
await frame([[plan.sites.buildRect[0] + 1, plan.sites.buildRect[1] + 1]]);
await click([plan.sites.buildRect[0] + 1, plan.sites.buildRect[1] + 1]);
const panelText = await page.locator('aside.side.panel').innerText().catch(() => '');
check('far-bank building is connected to the road network (UI shows "Đang hoạt động")', /Đang hoạt động/.test(panelText) && !/Chưa nối đường/.test(panelText), panelText.split('\n').slice(0, 3));
await page.locator('aside.side.panel .close').click().catch(() => {});
await shot('far-bank-built', 'Chuồng gà ở bờ xa, nối đường qua cầu gỗ');

// ---- 3. Real 3D: orbit 180° and scene audit ----
await debug('camera', [125, 141, 90, 35, 45]);
await settle(500);
const before = await debug('screenshot');
await shot('orbit-0', 'Góc 0°');
await debug('orbit', [180]); await settle(600);
const after = await debug('screenshot');
await shot('orbit-180', 'Xoay 180°: địa hình, nước, cây, cầu đều là hình khối thật');
check('orbit 180° changes the rendered image', before !== after);
await debug('camera', [125, 141, 60, 200, 36]); await settle(500);
await shot('low-angle', 'Góc thấp: thấy mặt dốc bờ sông, tường kè và trụ cầu');
const audit = await debug('auditScene');
check('no textured image planes or sprites faking 3D', audit.texturedPlanes === 0 && audit.sprites === 0, audit);

// ---- 4. Performance (docs/11 §8, desktop) ----
await debug('camera', [128, 140, 140, 25, 55]); await settle(2500);
const samples = [];
for (let i = 0; i < 5; i++) { await settle(1000); samples.push(await debug('metrics')); }
const fps = samples.reduce((v, m) => v + m.fps, 0) / samples.length;
const perf = { fps: +fps.toFixed(1), drawCalls: Math.max(...samples.map(m => m.drawCalls)), triangles: Math.max(...samples.map(m => m.triangles)),
  zoneRebuildMaxMs: Math.max(...samples.map(m => m.terrain.maxRebuildMs)), geometries: samples.at(-1).geometries, textures: samples.at(-1).textures, programs: samples.at(-1).programs };
check('desktop FPS ≥ 55 (target 60)', perf.fps >= 55, perf.fps);
check('draw calls ≤ 300', perf.drawCalls <= 300, perf.drawCalls);
check('triangles ≤ 1.5M', perf.triangles <= 1_500_000, perf.triangles);
check('terrain zone rebuild ≤ 16 ms (max seen)', perf.zoneRebuildMaxMs <= 16, perf.zoneRebuildMaxMs);

// ---- 5. GPU leak checks (docs/10 §4.1) ----
const mem = async () => { const m = await debug('metrics'); return { geometries: m.geometries, textures: m.textures, programs: m.programs }; };
await frame([[66, 66]], 90);
const center = await at([66, 66]);
const cycleTools = async () => {
  for (const name of Object.keys(toolLabel)) {
    await tool(name);
    if (name === 'build') for (const label of ['Chợ', 'Nhà nông', 'Giếng', 'Kho', 'Chuồng gà']) { await page.locator('.catalog button', { hasText: label }).first().click(); await page.mouse.move(center.x, center.y); await page.mouse.move(center.x + 5, center.y + 5); }
    else { await page.mouse.move(center.x, center.y); await page.mouse.move(center.x + 5, center.y + 5); }
  }
};
await cycleTools(); await tool('explore'); await settle(500);
const memBefore = await mem();
for (let i = 0; i < 50; i++) await cycleTools();
await tool('explore'); await settle(500);
const memTools = await mem();
check('switching all tools + ghosts 50× does not grow GPU memory', memTools.geometries - memBefore.geometries <= 2 && memTools.textures - memBefore.textures <= 2 && memTools.programs - memBefore.programs <= 2, { before: memBefore, after: memTools });
const placeCycle = async n => { for (let i = 0; i < n; i++) {
  const s = await snap();
  const r = await debug('command', ['PLACE_BUILDING', { defId: 'deco_flowerbed', anchor: plan.sites.freeCell, rotation: 0 }]);
  if (!r.accepted) throw new Error(`place failed ${r.code}`);
  const id = (await snap()).buildings.find(b => b.anchor[0] === plan.sites.freeCell[0] && b.anchor[1] === plan.sites.freeCell[1] && b.status === 'CONSTRUCTING')?.id;
  const c = await debug('command', ['CANCEL_CONSTRUCTION', { buildingId: id }]); if (!c.accepted) throw new Error(`cancel failed ${c.code} rev ${s.revision}`);
  await settle(60);
} };
await placeCycle(3); await settle(400);
const memPlaceBefore = await mem();
await placeCycle(50); await settle(600);
const memPlace = await mem();
check('placing + cancelling a building 50× does not grow GPU memory', memPlace.geometries - memPlaceBefore.geometries <= 2 && memPlace.textures - memPlaceBefore.textures <= 2 && memPlace.programs - memPlaceBefore.programs <= 2, { before: memPlaceBefore, after: memPlace });

// ---- 6. Lighting / contrast (docs/10 §5) ----
await debug('camera', [140, 150, 90, 25, 55]); await settle(800);
const grassCell = plan.sites.grass, roadCell = [70, 74];
const g = await debug('project', [grassCell[0] * 2 + 1, grassCell[1] * 2 + 1]), r = await debug('project', [roadCell[0] * 2 + 1, roadCell[1] * 2 + 1]);
const contrast = await page.evaluate(async ([dataUrl, gp, rp]) => {
  const img = new Image(); img.src = dataUrl; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const lum = (i) => (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  let blown = 0; for (let i = 0; i < data.length; i += 4) if (data[i] >= 250 && data[i + 1] >= 250 && data[i + 2] >= 250) blown++;
  const sx = c.width / innerWidth, sy = c.height / innerHeight;
  const sample = (p) => { let t = 0, n = 0; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = Math.round(p.x * sx) + dx, y = Math.round(p.y * sy) + dy; t += lum((y * c.width + x) * 4); n++; } return t / n; };
  const lg = sample(gp), lr = sample(rp);
  return { blownPct: +(100 * blown / (data.length / 4)).toFixed(2), grassLum: +lg.toFixed(3), roadLum: +lr.toFixed(3), diffPct: +(100 * Math.abs(lg - lr) / Math.max(lg, lr)).toFixed(1) };
}, [await debug('screenshot'), g, r]);
check('≤ 5% blown-out pixels', contrast.blownPct <= 5, contrast);
check('grass vs dirt road luminance differs ≥ 15%', contrast.diffPct >= 15, contrast);
await shot('contrast', 'Ảnh dùng đo độ tương phản cỏ / đường đất');

// ---- 7. Errors ----
check('no page/console errors', errors.length === 0, errors);
check('no failed HTTP requests', failedRequests.length === 0, failedRequests);

const result = { base: BASE, at: new Date().toISOString(), userAgent: await page.evaluate(() => navigator.userAgent), perf, audit, contrast, memory: { tools: { before: memBefore, after: memTools }, placeCancel: { before: memPlaceBefore, after: memPlace } }, checks, shots, errors, failedRequests };
await writeFile(`${OUT}/g1-evidence.json`, JSON.stringify(result, null, 2));
await browser.close();
const failed = checks.filter(c => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exitCode = 1;
