// Parallel quests (D041) in-game QA on the offline dev server (BASE_URL, default :5196): the City at start lists five open quests,
// a later quest ("Làm 6 ô đường") is claimed before the first one, and the panel never overlaps the tool dock (desktop + Pixel 7).
// Usage: BASE_URL=http://127.0.0.1:5196 node scripts/quests-qa.mjs
import { chromium, devices } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dismissLevelUp } from './lib/hud.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5196', OUT = 'docs/evidence/g4/quests';
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const templates = { city: await readFile('apps/web/public/worlds/city-coast-01/template.v2.json', 'utf8'), farm: await readFile('apps/web/public/worlds/farm-valley-01/template.v2.json', 'utf8') };
const report = { base: BASE, at: new Date().toISOString(), runs: {}, failures: [] };

async function open(kind, options) {
  const context = await browser.newContext(options), page = await context.newPage();
  await page.route('**/worlds/farm-g1/template.v1.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: templates[kind] }));
  await page.goto(`${BASE}/?debug=1&test=1`);
  await page.waitForFunction(() => !!window.__debug?.command, null, { timeout: 60000 });
  await page.addStyleTag({ content: '.debug{display:none!important}' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__debug.timeOfDay(13));
  await dismissLevelUp(page);
  // The panel starts folded on phones: unfold it like a player would.
  const head = page.locator('.hud3-missions-head');
  if ((await head.getAttribute('aria-expanded')) !== 'true') { await head.click(); await page.waitForTimeout(400); }
  return { context, page };
}
const titles = page => page.evaluate(() => [...document.querySelectorAll('.hud3-missions .hud3-mission')].map(el => ({
  title: el.querySelector('strong')?.textContent, done: el.classList.contains('is-done'), claim: !!el.querySelector('.hud3-claim'), progress: el.querySelector('.hud3-progress small')?.textContent ?? null })));
const heading = page => page.evaluate(() => document.querySelector('.hud3-missions-head small')?.textContent);
async function overlap(page, name) {
  const boxes = await page.evaluate(() => Object.fromEntries([['missions', '.hud3-missions'], ['dock', '.hud3-dock'], ['minimap', '.hud3-minimap']].map(([k, s]) => {
    const e = document.querySelector(s); if (!e) return [k, null]; const r = e.getBoundingClientRect(); return [k, { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right }]; })));
  const a = boxes.missions, b = boxes.dock;
  if (a && b && a.bottom > b.y + 1 && a.right > b.x + 1 && a.x < b.right - 1) report.failures.push(`${name}: missions overlap the dock`);
  if (a && boxes.minimap && a.bottom > boxes.minimap.y + 1 && a.right > boxes.minimap.x + 1 && a.x < boxes.minimap.right - 1) report.failures.push(`${name}: missions overlap the minimap`);
  return boxes;
}

for (const [name, options] of [['1440x900', { viewport: { width: 1440, height: 900 } }], ['1366x768', { viewport: { width: 1366, height: 768 } }], ['pixel7', devices['Pixel 7']]]) {
  const run = report.runs[name] = {};
  // City: start, then out-of-order claim.
  let { context, page } = await open('city', options);
  run.cityStart = { heading: await heading(page), quests: await titles(page), boxes: await overlap(page, `${name} city start`) };
  if (run.cityStart.quests.length !== 5) report.failures.push(`${name}: expected 5 open quests, got ${run.cityStart.quests.length}`);
  await page.screenshot({ path: `${OUT}/city-start-${name}.jpg`, type: 'jpeg', quality: 80 });
  if (name === '1440x900') {
    const entry = JSON.parse(templates.city).entryCells[0] ?? [60, 60];
    let accepted = null;
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const cells = Array.from({ length: 7 }, (_, n) => [entry[0] + dx * n, entry[1] + dz * n]);
      const result = await page.evaluate(c => window.__debug.command('BUILD_ROAD', { tier: 1, cells: c }), cells);
      if (result.accepted) { accepted = cells; break; }
    }
    run.road = accepted;
    await page.waitForTimeout(800);
    run.cityAfterRoad = { heading: await heading(page), quests: await titles(page) };
    await page.screenshot({ path: `${OUT}/city-road-done-${name}.jpg`, type: 'jpeg', quality: 80 });
    const first = page.locator('.hud3-missions .hud3-mission.is-done .hud3-claim').first();
    if (await first.count()) { await first.click(); await page.waitForTimeout(800); await dismissLevelUp(page); }
    else report.failures.push(`${name}: no claimable quest after the road`);
    run.cityAfterClaim = { heading: await heading(page), quests: await titles(page), claimed: await page.evaluate(() => window.__debug.snapshot().progress.claimedQuests) };
    if (JSON.stringify(run.cityAfterClaim.claimed) !== JSON.stringify(['city-2'])) report.failures.push(`${name}: expected city-2 claimed first, got ${JSON.stringify(run.cityAfterClaim.claimed)}`);
    await page.screenshot({ path: `${OUT}/city-claimed-out-of-order-${name}.jpg`, type: 'jpeg', quality: 80 });
  }
  await context.close();
  // Farm: start.
  ({ context, page } = await open('farm', options));
  run.farmStart = { heading: await heading(page), quests: await titles(page), boxes: await overlap(page, `${name} farm start`) };
  if (run.farmStart.quests.length !== 5) report.failures.push(`${name}: farm expected 5 open quests`);
  await page.screenshot({ path: `${OUT}/farm-start-${name}.jpg`, type: 'jpeg', quality: 80 });
  await context.close();
  console.log(name, 'city', run.cityStart.heading, run.cityStart.quests.length, 'farm', run.farmStart.heading, run.farmStart.quests.length);
}
await writeFile(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
if (report.failures.length) { console.error(`Quests QA FAILED:\n  ${report.failures.join('\n  ')}`); process.exitCode = 1; } else console.log('Quests QA passed');
