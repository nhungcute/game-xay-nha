/**
 * G3 E2E (docs/10 §4) on the authored maps, online mode, real UI input:
 *  1. new player → City tutorial (quests 1–6) through tools on the canvas → level ≥ 2
 *  2. reload returns to the same world with identical state
 *  4. Farm loop: market → farmhouse → till → plant greens → (tutorial 20 s) harvest → sell
 *  5. map switching City ↔ Farm 10× without JS-heap growth beyond 30 %
 *  7. mobile emulation on Chromium (Pixel 7) and WebKit (iPhone 13): create character, touch tools
 *  8. username + PIN login on a fresh context (D027)
 * Writes docs/evidence/g3/e2e/*.jpg and g3-e2e.json. Exit code 1 on any failed check.
 */
import { chromium, webkit, devices } from '@playwright/test';
import { claimButton, createOtherMapUI, dismissLevelUp, inventoryButton, loginUI, openSwitchMap, pickBuilding, pickTool, registerUI, uniqueName, waitSynced as hudSynced } from './lib/hud.mjs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5191';
const OUT = process.env.OUT ?? 'docs/evidence/g3/e2e';
await mkdir(OUT, { recursive: true });
for (const f of await readdir(OUT)) if (f.endsWith('.jpg')) await rm(`${OUT}/${f}`);
const chrome = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const checks = [], errors = [], timings = {};
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); };
let shotNo = 0;
const shot = (page, name) => page.screenshot({ path: `${OUT}/${String(++shotNo).padStart(2, '0')}-${name}.jpg`, type: 'jpeg', quality: 78 });
function watch(page, label) {
  page.on('pageerror', e => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`); });
  return page;
}
const debug = (page, fn, arg) => page.evaluate(([f, a]) => window.__debug[f](...(a ?? [])), [fn, arg]);
const snap = page => debug(page, 'snapshot');
const waitSynced = (page, timeout = 20000) => hudSynced(page, timeout);
const tool = (page, label) => pickTool(page, label);
async function frame(page, cells, distance = 70) {
  await dismissLevelUp(page);
  const xs = cells.map(c => c[0] * 2 + 1), zs = cells.map(c => c[1] * 2 + 1);
  await debug(page, 'camera', [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2 + 6, distance, 0, 62]); await page.waitForTimeout(200);
}
async function at(page, cell) {
  const p = await debug(page, 'project', [cell[0] * 2 + 1, cell[1] * 2 + 1]);
  const tag = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [p.x, p.y]);
  if (tag !== 'CANVAS') throw new Error(`cell ${cell} covered by ${tag}`);
  return p;
}
async function drag(page, a, b) { await frame(page, [a, b]); const p = await at(page, a), q = await at(page, b); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(250); }
async function click(page, cell) { await frame(page, [cell]); const p = await at(page, cell); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(250); }
async function claim(page, label) {
  const button = claimButton(page);
  await button.waitFor({ timeout: 20000 });
  const before = (await snap(page)).progress.questIndex;
  await dismissLevelUp(page); await button.click(); await page.waitForTimeout(400); await dismissLevelUp(page);
  const after = (await snap(page)).progress.questIndex;
  check(`quest claimed: ${label}`, after === before + 1, { before, after });
}
const NAME = uniqueName('Thị Trưởng'), PIN = '864213';
const free = (envs, cell) => !envs.some(e => e.blocking && cell[0] >= e.cell[0] && cell[0] < e.cell[0] + e.footprint && cell[1] >= e.cell[1] && cell[1] < e.cell[1] + e.footprint);

// ---------- 1. City tutorial ----------
const ctx = await chrome.newContext({ viewport: { width: 1440, height: 900 } });
const page = watch(await ctx.newPage(), 'city');
const t0 = Date.now();
await page.goto(`${BASE}/?debug=1`);
await page.getByText('Chọn vùng đất').waitFor({ timeout: 20000 });
await registerUI(page, 'city', NAME, PIN); await waitSynced(page);
check('city character created with username + PIN', (await snap(page)).character.displayName === NAME, NAME);
check('tutorial hint from "Bác Tư" is visible with the Clear tool highlighted', await page.locator('.hud3-mission-desc').isVisible() && await page.locator('.hud3-cat[data-cat=nature] .hud3-dot').isVisible());
await shot(page, 'city-tutorial-start');
const env = await debug(page, 'env');
const trees = env.filter(e => e.blocking && e.assetId.startsWith('tree') && e.cell[1] >= 50 && e.cell[1] <= 78 && e.cell[0] >= 50 && e.cell[0] <= 78);
// quest 1: clear 3 trees — drag over the smallest rect containing three nearby trees
trees.sort((a, b) => a.cell[0] + a.cell[1] - b.cell[0] - b.cell[1]);
const pick = trees.slice(0, 3), rect = [Math.min(...pick.map(t => t.cell[0])), Math.min(...pick.map(t => t.cell[1])), Math.max(...pick.map(t => t.cell[0])), Math.max(...pick.map(t => t.cell[1]))];
await tool(page, 'Dọn'); await drag(page, [rect[0], rect[1]], [rect[2], rect[3]]);
await claim(page, 'Chặt 3 cây');
// quest 2: road from ENTRY eastwards (≥ 6 new cells); clear blockers on the way first
const [ex, ez] = [48, 66];
const road = Array.from({ length: 7 }, (_, n) => [ex + 1 + n, ez]);
const env2 = await debug(page, 'env');
if (road.some(c => !free(env2, c))) { await tool(page, 'Dọn'); await drag(page, road[0], road.at(-1)); }
await tool(page, 'Đường'); await drag(page, [ex, ez], road.at(-1));
await claim(page, 'Làm đường ≥ 6 ô');
// quest 3: flatten a 2×2 pad just north of the road, after clearing it
const pad = [[51, 64], [52, 65]];
await tool(page, 'Dọn'); await drag(page, [51, 62], [56, 65]);
await tool(page, 'San nền'); await page.locator('.tool-options button', { hasText: 'Phẳng' }).click(); await drag(page, pad[0], pad[1]);
await claim(page, 'San phẳng 2×2');
// quests 4–5: small house + grocery next to the road (instant during the tutorial)
for (const [label, building, anchor] of [['Nhà nhỏ', 'Nhà nhỏ', [51, 64]], ['Tạp hóa', 'Tạp hóa', [54, 64]]]) {
  await pickBuilding(page, building);
  const auto = page.locator('.tool-options label', { hasText: 'San tự động' }).locator('input');
  if (!(await auto.isChecked())) await auto.check();
  await click(page, anchor);
  await claim(page, `Xây ${label}`);
}
await tool(page, 'Khám phá');
// quest 6: first collection (income accrues 60× faster during the tutorial)
await page.waitForTimeout(4000);
await click(page, [54, 64]);
const collect = page.locator('aside.side.panel button', { hasText: 'Thu tiền' });
await page.waitForFunction(() => { const b = [...document.querySelectorAll('aside.side.panel button')].find(x => x.textContent?.includes('Thu tiền')); return b && !b.hasAttribute('disabled'); }, null, { timeout: 20000 });
await collect.click(); await page.waitForTimeout(400);
await page.locator('aside.side.panel .close').click();
await claim(page, 'Thu tiền lần đầu');
await waitSynced(page);
const cityAfter = await snap(page);
timings.cityTutorialSeconds = Math.round((Date.now() - t0) / 1000);
check('City tutorial complete (6 quests, tutorialDone) and level ≥ 2', cityAfter.progress.questIndex === 6 && cityAfter.progress.tutorialDone && cityAfter.progress.level >= 2, { questIndex: cityAfter.progress.questIndex, level: cityAfter.progress.level, seconds: timings.cityTutorialSeconds });
await frame(page, [[50, 62], [57, 67]], 55);
await shot(page, 'city-tutorial-done');

// ---------- 2. reload ----------
await page.reload();
await page.waitForFunction(() => !!window.__debug?.snapshot, null, { timeout: 30000 }); await waitSynced(page);
const reloaded = await snap(page);
check('reload returns to the same City world with identical progress and buildings', reloaded.worldId === cityAfter.worldId && reloaded.revision === cityAfter.revision && reloaded.buildings.length === cityAfter.buildings.length);

// ---------- 4. Farm loop (second character on the same account) ----------
await openSwitchMap(page);
await page.getByText('Chọn vùng đất').waitFor({ timeout: 15000 });
await shot(page, 'map-select-with-city');
await createOtherMapUI(page, 'farm'); await waitSynced(page);
const farmStart = await snap(page);
check('farm character is independent (level 1, $2,000)', farmStart.mapKind === 'farm' && farmStart.progress.level === 1 && farmStart.wallet.cash === 2000);
const fEntry = [72, 79];
const fenv = await debug(page, 'env');
// market next to ENTRY road (north side), farmhouse next to it
await tool(page, 'Dọn'); await drag(page, [70, 70], [77, 79]);
await tool(page, 'Đường'); await drag(page, [72, 79], [72, 71]);
for (const [label, anchor, quest] of [['Chợ', [73, 76], 'Xây Chợ và nối đường'], ['Nhà nông', [73, 72], 'Xây Nhà nông']]) {
  await pickBuilding(page, label);
  const auto = page.locator('.tool-options label', { hasText: 'San tự động' }).locator('input'); if (!(await auto.isChecked())) await auto.check();
  await click(page, anchor);
  await tool(page, 'Khám phá');
  await claim(page, quest);
}
void fEntry; void fenv;
// till 6 cells west of the road, plant greens, harvest after the tutorial grow time, sell
await tool(page, 'Dọn'); await drag(page, [64, 72], [70, 74]);
await tool(page, 'Cuốc'); await drag(page, [65, 73], [70, 73]);
await claim(page, 'Cuốc 6 ô');
await tool(page, 'Gieo'); await page.locator('.tool-options select').selectOption({ index: 0 }); await drag(page, [65, 73], [70, 73]);
await claim(page, 'Gieo Rau cải');
await page.waitForTimeout(23000);
await tool(page, 'Thu hoạch'); await drag(page, [65, 73], [70, 73]);
await claim(page, 'Thu hoạch');
const inv = (await snap(page)).inventory;
await inventoryButton(page).click();
for (let i = 0; i < 10 && await page.locator('aside.side.panel .item button', { hasText: 'Bán hết' }).count(); i++) { await page.locator('aside.side.panel .item button', { hasText: 'Bán hết' }).first().click(); await page.waitForTimeout(150); }
await page.locator('aside.side.panel .close').click();
await page.waitForTimeout(400); await waitSynced(page);
const farmAfter = await snap(page);
check('farm loop: harvested crops were sold for cash', Object.values(inv).some(n => n > 0) && Object.values(farmAfter.inventory).every(n => n === 0) && farmAfter.wallet.cash > 0, { inventoryBefore: inv, cash: farmAfter.wallet.cash });
await shot(page, 'farm-loop-done');

// ---------- 5. map switching ----------
const cdp = await ctx.newCDPSession(page);
const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Runtime.getHeapUsage')).usedSize; };
const switchTo = async kind => {
  await openSwitchMap(page);
  await page.getByText('Chọn vùng đất').waitFor({ timeout: 15000 });
  await page.locator(`.map-card.${kind} button`, { hasText: 'Chơi tiếp' }).click();
  await page.waitForFunction(k => window.__debug?.snapshot?.().mapKind === k, kind, { timeout: 30000 });
  await waitSynced(page);
};
await switchTo('city'); await switchTo('farm');
const heapBefore = await heap();
for (let i = 0; i < 5; i++) { await switchTo('city'); await switchTo('farm'); }
const heapAfter = await heap();
check('10 map switches: JS heap grows < 30 %', heapAfter < heapBefore * 1.3, { beforeMB: +(heapBefore / 1e6).toFixed(1), afterMB: +(heapAfter / 1e6).toFixed(1) });

// ---------- 8. username + PIN on a fresh context (another device) ----------
const ctxB = await chrome.newContext({ viewport: { width: 1280, height: 800 } });
const pageB = watch(await ctxB.newPage(), 'login');
await pageB.goto(`${BASE}/?debug=1`);
await pageB.getByText('Chọn vùng đất').waitFor({ timeout: 20000 });
await loginUI(pageB, NAME.toUpperCase(), PIN);
await pageB.locator('.map-card.city .who').waitFor({ timeout: 15000 });
check('username + PIN on another device lists both characters', (await pageB.locator('.map-card.city .who').innerText()).includes(NAME) && (await pageB.locator('.map-card.farm .who').innerText()).includes(NAME));
await shot(pageB, 'login-both');
await ctxB.close();
await ctx.close();

// ---------- 7. mobile emulation: Chromium Pixel 7 and WebKit iPhone 13 ----------
const wk = await webkit.launch({ headless: true });
for (const [label, browser, device] of [['chromium-pixel7', chrome, devices['Pixel 7']], ['webkit-iphone13', wk, devices['iPhone 13']]]) {
  const mctx = await browser.newContext({ ...device });
  const mp = watch(await mctx.newPage(), label);
  await mp.goto(`${BASE}/?debug=1`);
  await mp.getByText('Chọn vùng đất').waitFor({ timeout: 30000 });
  const loaded = await registerUI(mp, 'farm', uniqueName(`Di Động ${label.slice(0, 4)}`), '1357', { tap: true }).then(() => true).catch(() => false);
  check(`${label}: game loads after creating a character`, loaded);
  if (!loaded) { await mctx.close(); continue; }
  await mp.waitForTimeout(1500);
  await pickTool(mp, 'Dọn', { tap: true });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  check(`${label}: no horizontal overflow, tool selected by tap`, !overflow && await mp.locator('.hud3-tray .hud3-tool[aria-pressed=true]', { hasText: 'Dọn' }).isVisible());
  const metrics = await debug(mp, 'metrics');
  check(`${label}: WebGL renders (draw calls > 0)`, metrics.drawCalls > 0, { fps: +metrics.fps.toFixed(1), drawCalls: metrics.drawCalls });
  await mp.screenshot({ path: `${OUT}/${String(++shotNo).padStart(2, '0')}-${label}.jpg`, type: 'jpeg', quality: 75 });
  await mctx.close();
}
await wk.close();

check('no page/console errors', errors.length === 0, errors);
await writeFile(`${OUT}/g3-e2e.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), timings, checks, errors }, null, 2));
await chrome.close();
const failed = checks.filter(c => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exitCode = 1;
