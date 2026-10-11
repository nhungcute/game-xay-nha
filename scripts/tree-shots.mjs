// D030 visual QA: every tree/bush variant framed up close in the game scene, near→far LOD zoom-outs,
// map overviews at high/low graphics, a dense conifer forest, a clear-trees before/after, mobile views
// (Pixel 7 / iPhone 13 from G3) and the settings "Ghi công" panel. Records draw calls / triangles from
// window.__debug.metrics() and the aimed instance id (targetId) per shot.
// The farm's unlocked zones contain all 12 asset ids, so variant close-ups happen there; the city provides
// its own overviews. Usage: (vite offline dev on 5190) node scripts/tree-shots.mjs
import { chromium, devices } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dismissLevelUp, openSettings } from './lib/hud.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5190', OUT = 'docs/evidence/g4/trees';
const SRC = 'docs/evidence/g4/full-world';
const ALL_IDS = ['tree_deciduous_01', 'tree_deciduous_02', 'tree_deciduous_03', 'tree_deciduous_04',
  'tree_conifer_01', 'tree_conifer_02', 'tree_conifer_03', 'tree_conifer_04', 'bush_01', 'bush_02', 'bush_03', 'bush_04'];
await mkdir(`${OUT}/mobile`, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = { base: BASE, at: new Date().toISOString(), shots: [], errors: [] };

async function loadWorld(page, kind) {
  const template = await readFile(`apps/web/public/worlds/${kind === 'city' ? 'city-coast-01' : 'farm-valley-01'}/template.v2.json`, 'utf8');
  const snapshot = JSON.parse(await readFile(`${SRC}/${kind}-snapshot.json`, 'utf8'));
  await page.route('**/worlds/farm-g1/template.v1.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: template }));
  await page.goto(`${BASE}/?debug=1&test=1`);
  await page.waitForFunction(() => !!window.__debug?.loadSnapshot, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const loaded = await page.evaluate(s => { const cur = window.__debug.snapshot(); s.worldId = cur.worldId; s.accountId = cur.accountId; return window.__debug.loadSnapshot(s); }, snapshot);
  if (!loaded.ok) throw new Error(`${kind} snapshot rejected: ${JSON.stringify(loaded.errors).slice(0, 300)}`);
  await page.waitForTimeout(3000);
  await dismissLevelUp(page);
}

async function shoot(page, file, label, meta = {}) {
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `${OUT}/${file}`, type: 'jpeg', quality: 82 });
  const m = await page.evaluate(() => window.__debug.metrics());
  report.shots.push({ file, label, ...meta, drawCalls: m.drawCalls, triangles: m.triangles, fps: Math.round(m.fps) });
  console.log(`${file} ${m.drawCalls} calls ${m.triangles} tris ${Math.round(m.fps)} fps`);
}

/** Aim the camera at a world point and confirm the aim point projects into the viewport. */
async function aim(page, x, z, distance, pitch = 24, yaw = 30) {
  await page.evaluate(([x, z, distance, yaw, pitch]) => window.__debug.camera(x, z, distance, yaw, pitch), [x, z, distance, yaw, pitch]);
  await page.waitForTimeout(700);
  return page.evaluate(([x, z]) => window.__debug.project(x, z), [x, z]);
}

const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('pageerror', e => report.errors.push(`farm: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') report.errors.push(`farm: ${m.text()}`); });
await loadWorld(page, 'farm');

/** One representative playable instance per asset id (closest to the map centre so shots stay on dry land). */
const instances = await page.evaluate(ids => {
  const env = window.__debug.env();
  return ids.map(id => env.filter(e => e.assetId === id)
    .sort((a, b) => Math.hypot((a.cell[0] - 64) * 2, (a.cell[1] - 64) * 2) - Math.hypot((b.cell[0] - 64) * 2, (b.cell[1] - 64) * 2))[0])
    .filter(Boolean);
}, ALL_IDS);
if (instances.length < 12) report.errors.push(`farm: only ${instances.length}/12 asset ids found in unlocked zones`);
const worldPoint = instance => [(instance.cell[0] + 0.5) * 2 + (instance.offsetXZ?.[0] ?? 0), (instance.cell[1] + 0.5) * 2 + (instance.offsetXZ?.[1] ?? 0)]; // env() omits offsetXZ; cell centre is close enough to frame

// ---------- 12 variant close-ups (near LOD) + the far twin of one conifer ----------
for (const instance of instances) {
  const [x, z] = worldPoint(instance);
  const projected = await aim(page, x, z, 14);
  await shoot(page, `variant-${instance.assetId}.jpg`, 'near LOD close-up', { targetId: instance.id, assetId: instance.assetId, lod: 'near', projected });
}
const conifer = instances.find(instance => instance.assetId === 'tree_conifer_01') ?? instances[0];
for (const [label, distance] of [['far-twin', 90], ['zoom-40', 40], ['zoom-110', 110], ['zoom-220', 220]]) {
  const [x, z] = worldPoint(conifer);
  await aim(page, x, z, distance, 35, 30);
  await shoot(page, `lod-${label}.jpg`, `near→far LOD ${label}`, { targetId: conifer.id, assetId: conifer.assetId, lod: label, cameraDistance: distance });
}

// ---------- dense conifer forest at 45° + clear before/after ----------
const forest = await page.evaluate(() => {
  const env = window.__debug.env();
  const conifers = env.filter(e => e.assetId.startsWith('tree_conifer'));
  let best = null, bestCount = -1;
  for (const e of conifers) {
    const x = (e.cell[0] + 0.5) * 2, z = (e.cell[1] + 0.5) * 2;
    const count = conifers.filter(o => { const ox = (o.cell[0] + 0.5) * 2, oz = (o.cell[1] + 0.5) * 2; return Math.hypot(ox - x, oz - z) <= 12; }).length;
    if (count > bestCount) { bestCount = count; best = { ...e, x, z }; }
  }
  return best ? { ...best, neighbours: bestCount } : null;
});
if (forest) {
  await aim(page, forest.x, forest.z, 55, 45, 45);
  await shoot(page, 'forest-conifer-45.jpg', `dense conifer forest (${forest.neighbours} conifers within 12 m), 45° oblique`, { targetId: forest.id });
}
{
  const targets = await page.evaluate(() => window.__debug.env().filter(e => e.assetId.startsWith('tree_'))
    .map(e => ({ ...e, d: Math.hypot((e.cell[0] + 0.5) * 2 - 128, (e.cell[1] + 0.5) * 2 - 128) }))
    .sort((a, b) => a.d - b.d).slice(0, 6));
  const [x, z] = worldPoint(targets[0]);
  await aim(page, x, z, 70, 40, 45);
  await shoot(page, 'clear-before.jpg', 'before CLEAR_ENV', { targetId: targets[0].id, cleared: targets.map(t => t.id) });
  const result = await page.evaluate(ids => window.__debug.command('CLEAR_ENV', { envIds: ids }), targets.map(t => t.id));
  await page.waitForTimeout(1500);
  await shoot(page, 'clear-after.jpg', `after CLEAR_ENV (${result.accepted ? 'accepted' : `rejected ${result.code}`})`, { targetId: targets[0].id, command: result });
}

// ---------- farm overviews high/low ----------
for (const quality of ['high', 'low']) {
  if (quality === 'low') { await openSettings(page); await page.locator('.settings button', { hasText: 'Thấp' }).click(); await page.locator('.side.panel .close').click(); await page.waitForTimeout(900); }
  await aim(page, 128, 128, 220, 75, 45);
  await shoot(page, `farm-${quality}-overview.jpg`, `farm overview ${quality}`, { quality });
  await aim(page, 128, 128, 110, 45, 200);
  await shoot(page, `farm-${quality}-oblique.jpg`, `farm oblique ${quality}`, { quality });
}
// Credits panel, desktop.
await openSettings(page);
await page.waitForTimeout(900);
await page.evaluate(() => { document.querySelector('.hud3-credits ul')?.scrollIntoView({ block: 'start' }); });
await shoot(page, 'credits-desktop.jpg', 'settings → Ghi công (desktop)', { panel: 'credits' });
await page.context().close();

// ---------- city overviews high/low ----------
const cityPage = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
cityPage.on('pageerror', e => report.errors.push(`city: ${e.message}`));
cityPage.on('console', m => { if (m.type() === 'error') report.errors.push(`city: ${m.text()}`); });
await loadWorld(cityPage, 'city');
for (const quality of ['high', 'low']) {
  if (quality === 'low') { await openSettings(cityPage); await cityPage.locator('.settings button', { hasText: 'Thấp' }).click(); await cityPage.locator('.side.panel .close').click(); await cityPage.waitForTimeout(900); }
  await aim(cityPage, 128, 128, 220, 75, 45);
  await shoot(cityPage, `city-${quality}-overview.jpg`, `city overview ${quality}`, { quality });
  await aim(cityPage, 128, 128, 110, 45, 200);
  await shoot(cityPage, `city-${quality}-oblique.jpg`, `city oblique ${quality}`, { quality });
}
await cityPage.context().close();

// ---------- mobile: Pixel 7 and iPhone 13 (G3 devices), farm views + credits ----------
for (const [name, device] of [['pixel7', devices['Pixel 7']], ['iphone13', devices['iPhone 13']]]) {
  const context = await browser.newContext({ ...device, deviceScaleFactor: 1 });
  const mobile = await context.newPage();
  mobile.on('pageerror', e => report.errors.push(`${name}: ${e.message}`));
  mobile.on('console', m => { if (m.type() === 'error') report.errors.push(`${name}: ${m.text()}`); });
  await loadWorld(mobile, 'farm');
  await dismissLevelUp(mobile);
  await aim(mobile, 128, 128, 120, 45, 45);
  await shoot(mobile, `mobile/${name}-farm.jpg`, `farm on ${name} (touch defaults to low graphics)`, { device: name });
  const instance = instances.find(instance => instance.assetId.startsWith('tree_conifer')) ?? instances[0];
  const [x, z] = worldPoint(instance);
  await aim(mobile, x, z, 30, 40, 30);
  await shoot(mobile, `mobile/${name}-close.jpg`, `close on ${name}`, { device: name, targetId: instance.id });
  // Credits panel on mobile (phone-width layout check).
  await openSettings(mobile);
  await mobile.waitForTimeout(900);
  await mobile.evaluate(() => { document.querySelector('.hud3-credits ul')?.scrollIntoView({ block: 'start' }); });
  await shoot(mobile, `mobile/${name}-credits.jpg`, 'Ghi công on mobile', { device: name, panel: 'credits' });
  await context.close();
}

await browser.close();
await writeFile(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(`saved ${report.shots.length} shots → ${OUT}/report.json; errors: ${report.errors.length}`);
if (report.errors.length) process.exitCode = 1;
