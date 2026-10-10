// docs/10 §6 full-world render check: loads the sim-built snapshots from scripts/g4-full-world.ts into the
// offline dev client (validate-then-swap via the dev-only test hook) and measures docs/11 §8 budgets at several
// camera views, high and low graphics, plus a terrain rebuild after a real command.
// Usage: (vite offline dev on 5190) node scripts/g4-full-world.mjs
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5190', OUT = 'docs/evidence/g4/full-world';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = { base: BASE, at: new Date().toISOString(), maps: {} };
let failed = false;
for (const [kind, mapId] of [['city', 'city-coast-01'], ['farm', 'farm-valley-01']]) {
  const template = await readFile(`apps/web/public/worlds/${mapId}/template.v2.json`, 'utf8');
  const snapshot = JSON.parse(await readFile(`${OUT}/${kind}-snapshot.json`, 'utf8'));
  const world = JSON.parse(await readFile(`${OUT}/${kind}-world.json`, 'utf8'));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/worlds/farm-g1/template.v1.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: template }));
  await page.goto(`${BASE}/?debug=1&test=1`);
  await page.waitForFunction(() => !!window.__debug?.loadSnapshot, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const loaded = await page.evaluate(s => { const cur = window.__debug.snapshot(); s.worldId = cur.worldId; s.accountId = cur.accountId; return window.__debug.loadSnapshot(s); }, snapshot);
  if (!loaded.ok) { console.error(kind, 'snapshot rejected', JSON.stringify(loaded.errors).slice(0, 500)); failed = true; await context.close(); continue; }
  await page.waitForTimeout(3000);
  const views = [];
  for (const quality of ['high', 'low']) {
    if (quality === 'low') { await page.locator('header .brand').click(); await page.locator('.settings button', { hasText: 'Thấp' }).click(); await page.locator('.side.panel .close').click(); }
    for (const [label, cam] of [['default', null], ['overview-75', [128, 128, 220, 45, 75]], ['oblique-45', [128, 128, 160, 200, 45]], ['close', [128, 128, 45, 30, 40]]]) {
      if (cam) await page.evaluate(c => window.__debug.camera(...c), cam);
      await page.waitForTimeout(1600);
      const m = await page.evaluate(() => window.__debug.metrics());
      views.push({ quality, view: label, fps: Math.round(m.fps), drawCalls: m.drawCalls, triangles: m.triangles, geometries: m.geometries });
      if (label === 'overview-75') await page.screenshot({ path: `${OUT}/${kind}-${quality}-overview.jpg`, type: 'jpeg', quality: 78 });
    }
  }
  // One real terrain command in an unlocked zone: zone rebuild time is measured by TerrainRenderer.stats.
  const rebuild = await page.evaluate(() => {
    const s = window.__debug.snapshot(), zone = s.unlockedZones.at(-1), x = (zone % 8) * 16 + 8, z = Math.floor(zone / 8) * 16 + 8;
    const r = window.__debug.command('TERRAFORM', { rect: [x, z, x, z], mode: 'RAISE' });
    return { accepted: r.accepted, code: r.code, stats: window.__debug.metrics().terrain };
  });
  const high = views.filter(v => v.quality === 'high'), low = views.filter(v => v.quality === 'low');
  const checks = {
    desktopDrawCalls: Math.max(...high.map(v => v.drawCalls)) <= 300,
    desktopTriangles: Math.max(...high.map(v => v.triangles)) <= 1_500_000,
    lowDrawCalls: Math.max(...low.map(v => v.drawCalls)) <= 150,
    lowTriangles: Math.max(...low.map(v => v.triangles)) <= 500_000,
    zoneRebuildMs: rebuild.stats.maxRebuildMs <= 8,
    noErrors: errors.length === 0,
  };
  if (Object.values(checks).some(v => !v)) failed = true;
  report.maps[kind] = { world, views, rebuild, checks, errors };
  console.log(kind, JSON.stringify(world), '\n ', views.map(v => `${v.quality}/${v.view}: ${v.drawCalls} calls ${v.triangles} tris ${v.fps} fps`).join(' | '), '\n ', JSON.stringify(checks), 'rebuild', rebuild.stats.maxRebuildMs);
  await context.close();
}
await browser.close();
await writeFile(`${OUT}/render.json`, `${JSON.stringify(report, null, 2)}\n`);
if (failed) process.exitCode = 1;
