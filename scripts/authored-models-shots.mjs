// D028 B5 visual check: authored Building_3D_POC models (house_small, shop_cafe, farmhouse) in the game scene.
// Loads the G4 full-world snapshots into the offline dev client and frames each authored building up close,
// plus an overview, and records draw calls. Usage: (vite offline dev on 5190) node scripts/authored-models-shots.mjs
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5190', SRC = 'docs/evidence/g4/full-world', OUT = 'docs/evidence/g4/authored-models';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = { base: BASE, at: new Date().toISOString(), shots: [], errors: [] };
for (const [kind, mapId, ids] of [['city', 'city-coast-01', ['house_small', 'shop_cafe']], ['farm', 'farm-valley-01', ['farmhouse']]]) {
  const template = await readFile(`apps/web/public/worlds/${mapId}/template.v2.json`, 'utf8');
  const snapshot = JSON.parse(await readFile(`${SRC}/${kind}-snapshot.json`, 'utf8'));
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await context.newPage();
  page.on('pageerror', e => report.errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  await page.route('**/worlds/farm-g1/template.v1.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: template }));
  await page.goto(`${BASE}/?debug=1&test=1`);
  await page.waitForFunction(() => !!window.__debug?.loadSnapshot, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const loaded = await page.evaluate(s => { const cur = window.__debug.snapshot(); s.worldId = cur.worldId; s.accountId = cur.accountId; return window.__debug.loadSnapshot(s); }, snapshot);
  if (!loaded.ok) { report.errors.push(`${kind}: ${JSON.stringify(loaded.errors).slice(0, 300)}`); await context.close(); continue; }
  await page.waitForTimeout(2500);
  // The loaded max-level snapshot raises a level-up card; close it so it does not cover the building.
  for (let i = 0; i < 3 && await page.locator('.levelup-card .primary').isVisible().catch(() => false); i++) await page.locator('.levelup-card .primary').click();
  await page.locator('.debug').evaluate(el => { el.style.display = 'none'; }).catch(() => {});
  for (const id of ids) {
    const b = snapshot.buildings.find(building => building.defId === id), size = id === 'farmhouse' ? 3 : 2;
    const x = (b.anchor[0] + size / 2) * 2, z = (b.anchor[1] + size / 2) * 2;
    for (const [label, cam] of [['front', [x, z, 14, 0, 32]], ['side', [x, z, 14, 135, 28]], ['back', [x, z, 14, 180, 32]]]) {
      await page.evaluate(c => window.__debug.camera(...c), cam); await page.waitForTimeout(1200);
      const file = `${OUT}/${kind}-${id}-${label}.jpg`;
      await page.screenshot({ path: file, type: 'jpeg', quality: 80 });
      report.shots.push({ kind, id, label, file, drawCalls: (await page.evaluate(() => window.__debug.metrics())).drawCalls });
    }
  }
  // D028 upgrade flow on the first authored building: open its panel, upgrade, show the scaffold ring + panel.
  {
    const b = snapshot.buildings.find(building => building.defId === ids[0]), size = ids[0] === 'farmhouse' ? 3 : 2;
    const x = (b.anchor[0] + size / 2) * 2, z = (b.anchor[1] + size / 2) * 2;
    await page.evaluate(() => window.__debug.command('BUY_MATERIAL', { wood: 50, stone: 50 }));
    await page.evaluate(c => window.__debug.camera(...c), [x, z, 18, 0, 40]); await page.waitForTimeout(1000);
    const point = await page.evaluate(([px, pz]) => window.__debug.project(px, pz), [x, z]);
    await page.mouse.click(point.x, point.y); await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${kind}-upgrade-panel.jpg`, type: 'jpeg', quality: 80 });
    const button = page.locator('.upgrade-row button.primary');
    report.upgrade ??= {};
    report.upgrade[kind] = { panel: await page.locator('.upgrade-row').textContent().catch(() => null) };
    if (await button.isEnabled().catch(() => false)) {
      await button.click(); await page.waitForTimeout(1200);
      report.upgrade[kind].running = await page.locator('.upgrade-row.is-running').textContent().catch(() => null);
      await page.screenshot({ path: `${OUT}/${kind}-upgrade-running.jpg`, type: 'jpeg', quality: 80 });
    }
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => window.__debug.camera(128, 128, 120, 30, 55)); await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/${kind}-overview.jpg`, type: 'jpeg', quality: 78 });
  report.shots.push({ kind, id: 'overview', file: `${OUT}/${kind}-overview.jpg`, drawCalls: (await page.evaluate(() => window.__debug.metrics())).drawCalls });
  await context.close();
}
await browser.close();
await writeFile(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.upgrade), JSON.stringify(report.shots.map(s => `${s.kind}/${s.id}/${s.label ?? ''}: ${s.drawCalls} calls`)), 'errors', report.errors.length, report.errors.slice(0, 3));
