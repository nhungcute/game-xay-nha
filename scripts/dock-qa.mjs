// Dock reorg QA (offline dev server, BASE_URL default :5197): bar, Công trình tray (bank), Đất đai tray, Phá quick button
// (pressed), tutorial hint dot on Đất đai, no overlap of the quick button with minimap/controls/tray/missions, and a Phá click-test.
// Usage: BASE_URL=http://127.0.0.1:5197 node scripts/dock-qa.mjs
import { chromium, devices } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dismissLevelUp } from './lib/hud.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5197', OUT = 'docs/evidence/g4/dock', FULL = 'docs/evidence/g4/full-world';
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const maps = { city: 'city-coast-01', farm: 'farm-valley-01' };
const report = { base: BASE, at: new Date().toISOString(), runs: {}, failures: [] };
const fail = m => { report.failures.push(m); console.log('FAIL', m); };

async function open(kind, options, snapshotFile) {
  const context = await browser.newContext(options), page = await context.newPage();
  const template = await readFile(`apps/web/public/worlds/${maps[kind]}/template.v2.json`, 'utf8');
  await page.route('**/worlds/farm-g1/template.v1.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: template }));
  await page.goto(`${BASE}/?debug=1&test=1`);
  await page.waitForFunction(() => !!window.__debug?.command, null, { timeout: 60000 });
  await page.addStyleTag({ content: '.debug{display:none!important}' });
  await page.waitForTimeout(1500);
  if (snapshotFile) {
    const snapshot = JSON.parse(await readFile(snapshotFile, 'utf8'));
    const ok = await page.evaluate(s => { const cur = window.__debug.snapshot(); s.worldId = cur.worldId; s.accountId = cur.accountId; return window.__debug.loadSnapshot(s); }, snapshot);
    if (!ok.ok) throw new Error('snapshot rejected');
  }
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__debug.timeOfDay(13));
  await dismissLevelUp(page);
  return { context, page };
}
const rects = page => page.evaluate(() => Object.fromEntries([['quick', '.hud3-quick'], ['bar', 'nav.hud3-bar'], ['tray', '.hud3-tray'], ['minimap', '.hud3-minimap'], ['controls', '.hud3-controls'], ['missions', '.hud3-missions'], ['top', '.hud3-top']].map(([k, s]) => {
  const e = document.querySelector(s); if (!e) return [k, null]; const r = e.getBoundingClientRect(); return [k, { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right }]; })));
const hit = (a, b) => a && b && a.x < b.right - 1 && a.right > b.x + 1 && a.y < b.bottom - 1 && a.bottom > b.y + 1;
async function checkOverlap(page, name) {
  const r = await rects(page);
  for (const other of ['minimap', 'controls', 'tray', 'missions', 'top', 'bar']) if (hit(r.quick, r[other])) fail(`${name}: quick button overlaps ${other}`);
  if (r.quick && (r.quick.right > page.viewportSize().width + 1 || r.quick.x < -1)) fail(`${name}: quick button off-screen`);
  return r;
}
const shot = (page, file) => page.screenshot({ path: `${OUT}/${file}.jpg`, type: 'jpeg', quality: 82 });
const cats = page => page.evaluate(() => [...document.querySelectorAll('.hud3-cat')].map(e => e.dataset.cat));
const cat = (page, id) => page.locator(`.hud3-cat[data-cat=${id}]`);

for (const [name, options] of [['1440x900', { viewport: { width: 1440, height: 900 } }], ['1366x768', { viewport: { width: 1366, height: 768 } }], ['pixel7', devices['Pixel 7']]]) {
  const tap = name === 'pixel7', click = l => tap ? l.tap() : l.click();
  const run = report.runs[name] = {};
  for (const kind of ['city', 'farm']) {
    const { context, page } = await open(kind, options), r = run[kind] = { tabs: await cats(page) };
    const tag = `${name}-${kind}`;
    r.rest = await checkOverlap(page, `${tag} bar`);
    await shot(page, `bar-${tag}`);
    await click(cat(page, 'buildings')); await page.waitForTimeout(300);
    r.bankInBuildings = await page.locator('.hud3-tray .hud3-card[data-def=bank]').count();
    if (kind === 'city' && r.bankInBuildings !== 1) fail(`${tag}: bank not in Công trình`);
    if (kind === 'farm' && r.bankInBuildings) fail(`${tag}: bank in farm tray`);
    r.buildingsTray = await checkOverlap(page, `${tag} buildings tray`);
    await shot(page, `tray-buildings-${tag}`);
    await click(cat(page, 'land')); await page.waitForTimeout(300);
    r.landTools = await page.evaluate(() => [...document.querySelectorAll('.hud3-tray .hud3-tool')].map(e => e.dataset.tool));
    if (r.landTools.join() !== 'clear,terraform,zone') fail(`${tag}: land tools ${r.landTools}`);
    if (await page.locator('.hud3-tray [data-tool=demolish]').count()) fail(`${tag}: demolish still in a tray`);
    await checkOverlap(page, `${tag} land tray`);
    await shot(page, `tray-land-${tag}`);
    // Phá from any tab: pressed, and back to explore on a second press.
    await click(page.locator('.hud3-quick')); await page.waitForTimeout(300);
    r.demolishPressed = await page.locator('.hud3-quick').getAttribute('aria-pressed');
    r.tool = await page.evaluate(() => document.querySelector('.tool-options strong')?.textContent);
    if (r.demolishPressed !== 'true' || r.tool !== 'Phá') fail(`${tag}: Phá did not activate (${r.demolishPressed}/${r.tool})`);
    await checkOverlap(page, `${tag} phá active`);
    await shot(page, `demolish-active-${tag}`);
    await click(page.locator('.hud3-quick')); await page.waitForTimeout(300);
    if ((await page.locator('.hud3-quick').getAttribute('aria-pressed')) !== 'false' || await page.locator('.tool-options').count()) fail(`${tag}: second press did not return to explore`);
    // Switching tab while Phá is on drops it.
    await click(page.locator('.hud3-quick')); await page.waitForTimeout(200);
    await click(cat(page, 'buildings')); await page.waitForTimeout(300);
    r.demolishAfterTab = await page.locator('.hud3-quick').getAttribute('aria-pressed');
    if (r.demolishAfterTab !== 'false') fail(`${tag}: Phá stayed on after switching tab`);
    // 44px touch target.
    r.quickSize = await page.evaluate(() => { const b = document.querySelector('.hud3-quick').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; });
    if (tap && (r.quickSize[0] < 44 || r.quickSize[1] < 44)) fail(`${tag}: quick button below 44px ${r.quickSize}`);
    await context.close();
  }
  // Tutorial hint: fresh city, quest "Chặt 3 cây" -> dot on Đất đai.
  const { context, page } = await open('city', options);
  const dot = await page.locator('.hud3-cat[data-cat=land] .hud3-dot').count(), desc = await page.locator('.hud3-mission-desc').allInnerTexts();
  run.hint = { dot, desc };
  if (!dot) fail(`${name}: no hint dot on Đất đai`);
  await checkOverlap(page, `${name} hint`);
  await shot(page, `hint-land-${name}`);
  await context.close();
}

// Phá click-test on a built-up city (desktop): pick Phá, click a building, confirm flow unchanged.
{
  const { context, page } = await open('city', { viewport: { width: 1440, height: 900 } }, `${FULL}/city-snapshot.json`);
  const b = await page.evaluate(() => { const s = window.__debug.snapshot(); const x = s.buildings.find(q => q.status === 'READY' || q.status === 'ACTIVE') ?? s.buildings[0]; return { id: x.id, defId: x.defId, anchor: x.anchor, status: x.status, n: s.buildings.length }; });
  await page.locator('.hud3-quick').click();
  await page.evaluate(([cx, cz]) => window.__debug.camera(cx * 2 + 1, cz * 2 + 1, 34, 35, 42), b.anchor);
  await page.waitForTimeout(900);
  const p = await page.evaluate(([cx, cz]) => window.__debug.project(cx * 2 + 1, cz * 2 + 1), b.anchor);
  await page.mouse.click(p.x, p.y); await page.waitForTimeout(600);
  const confirm = page.locator('.tool-options button.primary');
  const state = { enabled: await confirm.isEnabled(), preview: await page.locator('.tool-options .preview-cost').innerText().catch(() => null), building: b };
  await shot(page, 'demolish-click-city-1440x900');
  if (!state.enabled) fail('phá click-test: confirm disabled on a building');
  await confirm.click(); await page.waitForTimeout(800);
  state.after = await page.evaluate(id => window.__debug.snapshot().buildings.find(q => q.id === id)?.status ?? 'gone', b.id);
  report.clickTest = state;
  if (state.after === b.status) fail(`phá click-test: building still ${state.after} after confirm`);
  await context.close();
}
await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 1));
await browser.close();
console.log(JSON.stringify(report.runs).slice(0, 1800)); console.log(report.clickTest);
console.log(report.failures.length ? `FAILURES:\n${report.failures.join('\n')}` : 'dock-qa OK');
process.exit(report.failures.length ? 1 : 0);
