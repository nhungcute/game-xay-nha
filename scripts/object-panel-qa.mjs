// D033 visual QA: click real map objects (tree, rock, large rock, crop, road) and record the object panel; check a
// camera drag that starts on a tree opens nothing; capture daytime building glass and the income coins.
// Usage: start the offline Vite server, set BASE_URL when it is not :5190, then run this script.
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dismissLevelUp } from './lib/hud.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5190';
const OUT = 'docs/evidence/g4/object-panel';
const FULL_WORLD = 'docs/evidence/g4/full-world';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const report = { base: BASE, at: new Date().toISOString(), picks: [], drag: null, shots: [], notes: [], errors: [] };

async function loadWorld(page, kind) {
  const mapId = kind === 'city' ? 'city-coast-01' : 'farm-valley-01';
  const template = await readFile(`apps/web/public/worlds/${mapId}/template.v2.json`, 'utf8');
  const snapshot = JSON.parse(await readFile(`${FULL_WORLD}/${kind}-snapshot.json`, 'utf8'));
  await page.route('**/worlds/farm-g1/template.v1.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: template }));
  await page.goto(`${BASE}/?debug=1&test=1`);
  await page.waitForFunction(() => !!window.__debug?.loadSnapshot, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const loaded = await page.evaluate(s => { const cur = window.__debug.snapshot(); s.worldId = cur.worldId; s.accountId = cur.accountId; return window.__debug.loadSnapshot(s); }, snapshot);
  if (!loaded.ok) throw new Error(`${kind} snapshot rejected`);
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__debug.timeOfDay(13));
  await dismissLevelUp(page);
}

async function aim(page, x, z, distance = 34, pitch = 42, yaw = 35) {
  await page.evaluate(([tx, tz, d, y, p]) => window.__debug.camera(tx, tz, d, y, p), [x, z, distance, yaw, pitch]);
  await page.waitForTimeout(900);
  return page.evaluate(([tx, tz]) => window.__debug.project(tx, tz), [x, z]);
}

async function pick(page, label, x, z) {
  await page.keyboard.press('Escape');
  const point = await aim(page, x, z);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(500);
  const panel = page.locator('.object-detail');
  const text = await panel.count() ? (await panel.innerText()).replace(/\s+\n/g, '\n').trim() : null;
  const file = `pick-${label}.jpg`;
  await page.screenshot({ path: `${OUT}/${file}`, type: 'jpeg', quality: 84 });
  report.picks.push({ label, cell: [Math.floor(x / 2), Math.floor(z / 2)], file, panel: text });
  console.log(`${label}: ${text ? text.split('\n').join(' | ') : 'NO PANEL'}`);
  return text;
}

const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('pageerror', e => report.errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });

// ---- Farm: scenery, crop and road picks ----
await loadWorld(page, 'farm');
const env = await page.evaluate(() => window.__debug.env());
const center = e => [e.cell[0] * 2 + e.footprint, e.cell[1] * 2 + e.footprint];
const firstOf = prefix => env.find(e => e.assetId.startsWith(prefix) && (prefix !== 'rock_0' || e.footprint === 1));
for (const [label, prefix] of [['tree', 'tree_deciduous'], ['conifer', 'tree_conifer'], ['rock', 'rock_0'], ['rock_large', 'rock_large'], ['bush', 'bush']]) {
  const target = firstOf(prefix);
  if (!target) { report.notes.push(`farm: no ${label} in unlocked zones`); continue; }
  await pick(page, label, ...center(target));
}
const snapshot = await page.evaluate(() => window.__debug.snapshot());
const crop = snapshot.crops[0];
if (crop) await pick(page, 'crop', crop.cell[0] * 2 + 1, crop.cell[1] * 2 + 1);
const template = JSON.parse(await readFile('apps/web/public/worlds/farm-valley-01/template.v2.json', 'utf8'));
const entry = template.entryCells[0];
await pick(page, 'road-entry', entry[0] * 2 + 1, entry[1] * 2 + 1);

// ---- Drag that starts on a tree must orbit the camera, not open a panel ----
{
  await page.keyboard.press('Escape');
  const tree = firstOf('tree_deciduous'), point = await aim(page, ...center(tree));
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 60, point.y + 10, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(400);
  report.drag = { opened: await page.locator('.object-detail').count() > 0 };
  console.log(`drag from a tree opened a panel: ${report.drag.opened}`);
}

// ---- Clear one tree through the panel ----
{
  const tree = firstOf('tree_deciduous');
  await page.keyboard.press('Escape');
  const point = await aim(page, ...center(tree));
  await page.mouse.click(point.x, point.y); await page.waitForTimeout(400);
  const before = (await page.evaluate(() => window.__debug.snapshot())).wallet;
  await page.locator('.object-detail button', { hasText: 'Chặt cây' }).click();
  await page.waitForTimeout(700);
  const after = (await page.evaluate(() => window.__debug.snapshot())).wallet;
  report.clearTree = { woodGained: after.wood - before.wood, cashSpent: before.cash - after.cash, panelClosed: await page.locator('.object-detail').count() === 0 };
  console.log(`clear tree: ${JSON.stringify(report.clearTree)}`);
}

// ---- City: daytime glass and income coins ----
// A fresh context: the farm's local save must not leak into the city load ("Bản lưu không hợp lệ" banner).
const cityPage = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
cityPage.on('pageerror', e => report.errors.push(e.message));
await loadWorld(cityPage, 'city');
{
  const cityEnv = await cityPage.evaluate(() => window.__debug.env()), large = cityEnv.find(e => e.assetId.startsWith('rock_large'));
  if (large) await pick(cityPage, 'rock_large', large.cell[0] * 2 + large.footprint, large.cell[1] * 2 + large.footprint);
  else report.notes.push('city: no rock_large in unlocked zones');
  await cityPage.keyboard.press('Escape');
}
for (const [file, x, z, d, yaw, pitch] of [['city-glass-day.jpg', 132, 98, 42, 35, 22], ['city-coins-day.jpg', 124, 114, 60, 210, 38]]) {
  await aim(cityPage, x, z, d, pitch, yaw);
  await cityPage.waitForTimeout(800);
  await cityPage.screenshot({ path: `${OUT}/${file}`, type: 'jpeg', quality: 86 });
  report.shots.push(file);
}
await cityPage.evaluate(() => window.__debug.timeOfDay(22)); await cityPage.waitForTimeout(1500);
await cityPage.screenshot({ path: `${OUT}/city-coins-night.jpg`, type: 'jpeg', quality: 86 });
report.shots.push('city-coins-night.jpg');

await writeFile(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
const failed = report.errors.length || report.drag?.opened || report.picks.some(p => !p.panel && p.label !== 'road-entry') || !(report.clearTree?.woodGained > 0);
if (failed) { console.error('D033 object panel QA FAILED'); process.exitCode = 1; }
