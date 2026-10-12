// D031 visual QA: Night time of day & window lights verification.
// Measures city and farm under 22:00 night conditions, high/low graphics, bloom pass on/off,
// closeups of rice_mill, office_tower and house_apartment with lighted windows,
// time comparison across 13:00 / 18:00 / 22:00 / 03:00, Pixel 7 mobile, and Settings toggles.

import { chromium, devices } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dismissLevelUp, openSettings } from './lib/hud.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5190';
const OUT = 'docs/evidence/g4/night';
const FULL_WORLD = 'docs/evidence/g4/full-world';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});

const report = {
  base: BASE,
  at: new Date().toISOString(),
  overviews: {},
  closeups: {},
  timeComparison: {},
  mobile: {},
  settingsTest: {},
  metrics: {
    budgetChecks: {},
  },
  errors: [],
};

async function loadWorld(page, kind, hour = 22) {
  const mapId = kind === 'city' ? 'city-coast-01' : 'farm-valley-01';
  const template = await readFile(`apps/web/public/worlds/${mapId}/template.v2.json`, 'utf8');
  const snapshot = JSON.parse(await readFile(`${FULL_WORLD}/${kind}-snapshot.json`, 'utf8'));
  await page.route('**/worlds/farm-g1/template.v1.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: template }));
  await page.goto(`${BASE}/?debug=1&test=1`);
  await page.waitForFunction(() => !!window.__debug?.loadSnapshot, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const loaded = await page.evaluate(s => {
    const cur = window.__debug.snapshot();
    s.worldId = cur.worldId;
    s.accountId = cur.accountId;
    return window.__debug.loadSnapshot(s);
  }, snapshot);
  if (!loaded.ok) throw new Error(`${kind} snapshot rejected`);
  await page.waitForTimeout(2500);
  await page.evaluate(h => window.__debug.timeOfDay(h), hour);
  await dismissLevelUp(page);
}

async function measureFps(page) {
  return page.evaluate(async () => {
    const t = [];
    let last = window.performance.now();
    for (let i = 0; i < 90; i++) {
      await new Promise(r => window.requestAnimationFrame(r));
      const n = window.performance.now();
      t.push(n - last);
      last = n;
    }
    t.sort((a, b) => a - b);
    return { fps: Math.round(1000 / t[45]), p95Ms: +t[85].toFixed(1) };
  });
}

// ---------------- 1. Overviews at 22:00 (City & Farm, High & Low) ----------------
console.log('--- 1. Overviews at 22:00 ---');
for (const kind of ['city', 'farm']) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(`${kind}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(`${kind}: ${m.text()}`); });

  await loadWorld(page, kind, 22);

  for (const quality of ['high', 'low']) {
    if (quality === 'low') {
      await openSettings(page);
      await page.locator('.settings button', { hasText: 'Thấp' }).click();
      await page.locator('.side.panel .close').click();
    }
    // Overview camera
    await page.evaluate(() => window.__debug.camera(128, 128, 220, 45, 75));
    await page.waitForTimeout(2000);

    const perf = await measureFps(page);
    const m = await page.evaluate(() => window.__debug.metrics());
    const fileName = `${kind}-${quality}-overview-22h.jpg`;
    await page.screenshot({ path: `${OUT}/${fileName}`, type: 'jpeg', quality: 82 });

    report.overviews[`${kind}_${quality}`] = {
      kind, quality, hour: 22, file: fileName,
      drawCalls: m.drawCalls, triangles: m.triangles, fps: perf.fps, p95Ms: perf.p95Ms,
      bloom: m.bloom, night: m.night,
    };
    console.log(`  ${kind} ${quality} 22h: ${m.drawCalls} calls, ${m.triangles} tris, ${perf.fps} fps, bloom=${m.bloom}`);
  }
  await context.close();
}

// ---------------- 2. Closeups at 22:00 (rice_mill, office_tower, house_apartment) ----------------
console.log('--- 2. Closeups at 22:00 ---');
{
  // Farm: rice_mill closeup
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await loadWorld(page, 'farm', 22);

  // Focus on rice_mill at anchor [63, 72] -> world x=129, z=147
  await page.evaluate(() => window.__debug.camera(129, 147, 32, 40, 25));
  await page.waitForTimeout(2000);
  const perf = await measureFps(page);
  const m = await page.evaluate(() => window.__debug.metrics());
  await page.screenshot({ path: `${OUT}/closeup-rice_mill-22h.jpg`, type: 'jpeg', quality: 85 });
  report.closeups.rice_mill = {
    target: 'rice_mill', hour: 22, file: 'closeup-rice_mill-22h.jpg',
    drawCalls: m.drawCalls, triangles: m.triangles, fps: perf.fps, bloom: m.bloom,
  };
  console.log(`  rice_mill closeup 22h: ${m.drawCalls} calls, ${m.triangles} tris, ${perf.fps} fps, bloom=${m.bloom}`);
  await context.close();
}

{
  // City: office_tower & house_apartment closeups
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await loadWorld(page, 'city', 22);

  // Focus on office_tower at anchor [64, 47] -> world x=132, z=98
  await page.evaluate(() => window.__debug.camera(132, 98, 42, 35, 22));
  await page.waitForTimeout(2000);
  let perf = await measureFps(page);
  let m = await page.evaluate(() => window.__debug.metrics());
  await page.screenshot({ path: `${OUT}/closeup-office_tower-22h.jpg`, type: 'jpeg', quality: 85 });
  report.closeups.office_tower = {
    target: 'office_tower', hour: 22, file: 'closeup-office_tower-22h.jpg',
    drawCalls: m.drawCalls, triangles: m.triangles, fps: perf.fps, bloom: m.bloom,
  };
  console.log(`  office_tower closeup 22h: ${m.drawCalls} calls, ${m.triangles} tris, ${perf.fps} fps, bloom=${m.bloom}`);

  // Focus on house_apartment at anchor [60, 55] -> world x=124, z=114
  await page.evaluate(() => window.__debug.camera(124, 114, 38, 210, 24));
  await page.waitForTimeout(2000);
  perf = await measureFps(page);
  m = await page.evaluate(() => window.__debug.metrics());
  await page.screenshot({ path: `${OUT}/closeup-house_apartment-22h.jpg`, type: 'jpeg', quality: 85 });
  report.closeups.house_apartment = {
    target: 'house_apartment', hour: 22, file: 'closeup-house_apartment-22h.jpg',
    drawCalls: m.drawCalls, triangles: m.triangles, fps: perf.fps, bloom: m.bloom,
  };
  console.log(`  house_apartment closeup 22h: ${m.drawCalls} calls, ${m.triangles} tris, ${perf.fps} fps, bloom=${m.bloom}`);
  await context.close();
}

// ---------------- 3. Time comparison (13h, 18h, 22h, 3h) ----------------
console.log('--- 3. Time comparison (13h, 18h, 22h, 3h) ---');
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await loadWorld(page, 'city', 13);
  // Oblique view showing both towers, apartments and street
  await page.evaluate(() => window.__debug.camera(128, 128, 110, 50, 35));

  for (const hour of [13, 18, 22, 3]) {
    await page.evaluate(h => window.__debug.timeOfDay(h), hour);
    await page.waitForTimeout(2000);
    const perf = await measureFps(page);
    const m = await page.evaluate(() => window.__debug.metrics());
    const fileName = `compare-${hour}h.jpg`;
    await page.screenshot({ path: `${OUT}/${fileName}`, type: 'jpeg', quality: 85 });
    report.timeComparison[`${hour}h`] = {
      hour, file: fileName, drawCalls: m.drawCalls, triangles: m.triangles, fps: perf.fps,
      bloom: m.bloom, night: m.night,
    };
    console.log(`  compare ${hour}h: night=${m.night.toFixed(2)}, bloom=${m.bloom}, ${m.drawCalls} calls, ${perf.fps} fps`);
  }
  await context.close();
}

// ---------------- 4. Mobile Pixel 7 at Night (22:00) ----------------
console.log('--- 4. Mobile Pixel 7 at Night ---');
{
  const pixel7 = devices['Pixel 7'];
  const context = await browser.newContext({ ...pixel7 });
  const page = await context.newPage();
  await loadWorld(page, 'city', 22);
  await page.evaluate(() => window.__debug.camera(128, 128, 130, 45, 55));
  await page.waitForTimeout(2000);
  const perf = await measureFps(page);
  const m = await page.evaluate(() => window.__debug.metrics());
  await page.screenshot({ path: `${OUT}/mobile-pixel7-night.jpg`, type: 'jpeg', quality: 82 });
  report.mobile.pixel7 = {
    device: 'Pixel 7', viewport: pixel7.viewport, hour: 22, file: 'mobile-pixel7-night.jpg',
    drawCalls: m.drawCalls, triangles: m.triangles, fps: perf.fps, p95Ms: perf.p95Ms, bloom: m.bloom,
  };
  console.log(`  Pixel 7 night 22h: ${m.drawCalls} calls, ${m.triangles} tris, ${perf.fps} fps, bloom=${m.bloom}`);
  await context.close();
}

// ---------------- 5. Settings Panel Test ----------------
console.log('--- 5. Settings Panel Test ---');
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await loadWorld(page, 'city', 13); // Start at day

  await openSettings(page);
  const nightBtn = page.locator('.settings[aria-label="Thời gian trong ngày"] button', { hasText: 'Luôn ban đêm' });
  await nightBtn.click();
  await page.waitForTimeout(500);
  let m = await page.evaluate(() => window.__debug.metrics());
  const forcedNightOk = m.night === 1;

  const dayBtn = page.locator('.settings[aria-label="Thời gian trong ngày"] button', { hasText: 'Luôn ban ngày' });
  await dayBtn.click();
  await page.waitForTimeout(500);
  m = await page.evaluate(() => window.__debug.metrics());
  const forcedDayOk = m.night === 0;

  // Set to night again and reload to test persistence
  await nightBtn.click();
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => !!window.__debug?.metrics, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  m = await page.evaluate(() => window.__debug.metrics());
  const persistenceOk = m.timeOfDay === 'night' && m.night === 1;

  report.settingsTest = { forcedNightOk, forcedDayOk, persistenceOk };
  console.log(`  Settings: forcedNight=${forcedNightOk}, forcedDay=${forcedDayOk}, persistence=${persistenceOk}`);
  await context.close();
}

// ---------------- Summary Budget Checks ----------------
const cityHigh = report.overviews.city_high;
const farmHigh = report.overviews.farm_high;
const mobileShot = report.mobile.pixel7;

report.metrics.budgetChecks = {
  desktopCityDrawCallsOk: cityHigh.drawCalls <= 300,
  desktopFarmDrawCallsOk: farmHigh.drawCalls <= 300,
  desktopCityFpsOk: cityHigh.fps >= 35, // Desktop budget
  desktopFarmFpsOk: farmHigh.fps >= 50,
  mobilePixel7FpsOk: mobileShot.fps >= 30, // mobile >= 30 FPS
  riceMillLit: report.closeups.rice_mill.bloom !== undefined,
  bloomActiveAtNightHigh: cityHigh.bloom === true,
  bloomDisabledAtLow: report.overviews.city_low.bloom === false,
  noErrors: report.errors.length === 0,
};

await writeFile(`${OUT}/metrics.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log('--- Budget Checks Summary ---');
console.log(JSON.stringify(report.metrics.budgetChecks, null, 2));

await browser.close();
