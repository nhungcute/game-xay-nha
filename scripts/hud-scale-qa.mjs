// D034 HUD scale QA: the farm at common desktop/laptop/phone viewports with the missions list and an object panel open.
// Records each HUD block's on-screen box and fails on overlaps (missions/panel under the top bar, dock off screen,
// missions over the dock). Usage: offline Vite on :5190 (or BASE_URL), then `node scripts/hud-scale-qa.mjs [label]`.
import { chromium, devices } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dismissLevelUp } from './lib/hud.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5190';
const LABEL = process.argv[2] ?? 'after';
const OUT = 'docs/evidence/g4/hud-scale';
await mkdir(OUT, { recursive: true });
const VIEWPORTS = [
  ['1920x909', { viewport: { width: 1920, height: 909 } }],
  ['1440x900', { viewport: { width: 1440, height: 900 } }],
  ['1366x768', { viewport: { width: 1366, height: 768 } }],
  ['2560x1305', { viewport: { width: 2560, height: 1305 } }],
  ['pixel7', devices['Pixel 7']],
];
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const template = await readFile('apps/web/public/worlds/farm-valley-01/template.v2.json', 'utf8');
const snapshot = JSON.parse(await readFile('docs/evidence/g4/full-world/farm-snapshot.json', 'utf8'));
const report = { label: LABEL, base: BASE, at: new Date().toISOString(), viewports: {}, failures: [] };

for (const [name, options] of VIEWPORTS) {
  const context = await browser.newContext(options), page = await context.newPage();
  await page.route('**/worlds/farm-g1/template.v1.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: template }));
  await page.goto(`${BASE}/?debug=1&test=1`);
  await page.waitForFunction(() => !!window.__debug?.loadSnapshot, null, { timeout: 60000 });
  await page.addStyleTag({ content: '.debug{display:none!important}' });
  await page.waitForTimeout(1500);
  await page.evaluate(s => { const cur = window.__debug.snapshot(); s.worldId = cur.worldId; s.accountId = cur.accountId; return window.__debug.loadSnapshot(s); }, snapshot);
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__debug.timeOfDay(13));
  await dismissLevelUp(page);
  // Open an object panel on the first tree in view.
  const tree = (await page.evaluate(() => window.__debug.env())).find(e => e.assetId.startsWith('tree_deciduous'));
  if (tree) {
    await page.evaluate(([x, z]) => window.__debug.camera(x, z, 60, 35, 45), [tree.cell[0] * 2 + 1, tree.cell[1] * 2 + 1]);
    await page.waitForTimeout(800);
    const point = await page.evaluate(([x, z]) => window.__debug.project(x, z), [tree.cell[0] * 2 + 1, tree.cell[1] * 2 + 1]);
    if (options.hasTouch) await page.touchscreen.tap(point.x, point.y); else await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(600);
  }
  const boxes = await page.evaluate(() => Object.fromEntries([
    ['top', '.hud3-top'], ['missions', '.hud3-missions'], ['minimap', '.hud3-minimap'], ['controls', '.hud3-controls'],
    ['dock', '.hud3-dock'], ['panel', '.hud3-shell .side'],
  ].map(([key, selector]) => {
    const element = document.querySelector(selector);
    if (!element) return [key, null];
    const r = element.getBoundingClientRect();
    return [key, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) }];
  })));
  const size = page.viewportSize();
  const fail = message => report.failures.push(`${name}: ${message}`);
  const topBar = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.hud3-top > *')].map(e => e.getBoundingClientRect().bottom)));
  if (boxes.missions && boxes.missions.y < topBar - 1) fail(`missions (${boxes.missions.y}) under top bar (${Math.round(topBar)})`);
  if (boxes.panel && boxes.panel.y < topBar - 1) fail(`panel (${boxes.panel.y}) under top bar (${Math.round(topBar)})`);
  if (boxes.dock && (boxes.dock.bottom > size.height || boxes.dock.x < 0 || boxes.dock.right > size.width)) fail('dock off screen');
  if (boxes.missions && boxes.dock && boxes.missions.bottom > boxes.dock.y + 1 && boxes.missions.right > boxes.dock.x) fail('missions overlap the dock');
  const zoom = await page.evaluate(() => window.getComputedStyle(document.documentElement).getPropertyValue('--hud-zoom').trim() || '1');
  report.viewports[name] = { size, zoom, topBarBottom: Math.round(topBar), boxes, panelOpen: !!boxes.panel };
  await page.screenshot({ path: `${OUT}/${LABEL}-${name}.jpg`, type: 'jpeg', quality: 80 });
  console.log(`${name}: zoom ${zoom} · top bar ${Math.round(topBar)}px · dock ${boxes.dock?.w}×${boxes.dock?.h} · missions ${boxes.missions?.w}px · panel ${boxes.panel ? `${boxes.panel.w}px` : 'closed'}`);
  await context.close();
}
await writeFile(`${OUT}/${LABEL}.json`, `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
if (report.failures.length) { console.error(`HUD scale QA FAILED:\n  ${report.failures.join('\n  ')}`); process.exitCode = 1; }
