// Toast QA (D043; offline dev server, BASE_URL default :5199): invalid placement -> toast -> gone, three stacked errors,
// merged repeat (x3), no toast spam while hovering invalid cells for 2 s, geometry vs the top bar. 1440x900 + Pixel 7.
// Usage: BASE_URL=http://127.0.0.1:5199 node scripts/toasts-qa.mjs
import { chromium, devices } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dismissLevelUp } from './lib/hud.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5199', OUT = 'docs/evidence/g4/toasts';
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = { base: BASE, at: new Date().toISOString(), runs: {}, failures: [] };
const fail = m => { report.failures.push(m); console.log('FAIL', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(options) {
  const context = await browser.newContext(options), page = await context.newPage();
  const template = await readFile('apps/web/public/worlds/city-coast-01/template.v2.json', 'utf8');
  await page.route('**/worlds/farm-g1/template.v1.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: template }));
  await page.goto(`${BASE}/?debug=1&test=1`);
  await page.waitForFunction(() => !!window.__debug?.command, null, { timeout: 60000 });
  await page.addStyleTag({ content: '.debug{display:none!important}' });
  await page.waitForTimeout(3500);
  await page.evaluate(() => window.__debug.timeOfDay(13));
  await dismissLevelUp(page);
  return { context, page };
}
const toasts = page => page.locator('.hud3-toast');
const texts = page => toasts(page).allInnerTexts();
const shot = (page, file) => page.screenshot({ path: `${OUT}/${file}.jpg`, type: 'jpeg', quality: 82 });
const geometry = page => page.evaluate(() => {
  const r = e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom }; };
  const list = [...document.querySelectorAll('.hud3-toast')].map(r), top = document.querySelector('.hud3-top');
  const kids = top ? [...top.children].map(r) : [];
  return { list, topBottom: kids.length ? Math.max(...kids.map(k => k.bottom)) : 0, w: innerWidth, overlap: list.some(t => kids.some(k => t.x < k.right && t.right > k.x && t.y < k.bottom && t.bottom > k.y)) };
});

for (const [name, options] of [['1440x900', { viewport: { width: 1440, height: 900 } }], ['pixel7', devices['Pixel 7']]]) {
  const mobile = name === 'pixel7', run = report.runs[name] = {};
  const { context, page } = await open(options);
  const env = await page.evaluate(() => window.__debug.env().filter(e => e.blocking && e.footprint === 1).map(e => e.cell));
  // Focus a tree-dense spot in the unlocked zone.
  const near = c => env.filter(o => Math.abs(o[0] - c[0]) <= 4 && Math.abs(o[1] - c[1]) <= 4).length, tree = env.reduce((a, b) => near(b) > near(a) ? b : a);
  await page.evaluate(([cx, cz]) => window.__debug.camera(cx * 2 + 1, cz * 2 + 1, 30, 35, 42), tree);
  await page.waitForTimeout(900);
  await page.locator('.hud3-cat[data-cat=buildings]').click(); await page.waitForTimeout(300);
  await page.locator('.hud3-tray .hud3-card').first().click(); await page.waitForTimeout(300);
  const p = await page.evaluate(([cx, cz]) => window.__debug.project(cx * 2 + 1, cz * 2 + 1), tree);

  // 4) hover over invalid cells for 2 s: the inline preview shows the error, no toast ever appears.
  await page.evaluate(() => { window.__maxToasts = 0; new window.MutationObserver(() => { window.__maxToasts = Math.max(window.__maxToasts, document.querySelectorAll('.hud3-toast').length); }).observe(document.body, { childList: true, subtree: true }); });
  if (!mobile) {
    for (let i = 0; i < 40; i++) { await page.mouse.move(p.x + ((i % 8) - 4) * 28, p.y + (Math.floor(i / 8) - 2) * 22); await sleep(50); }
    run.hoverMaxToasts = await page.evaluate(() => window.__maxToasts); run.hoverInline = await page.locator('.tool-options .preview-cost').innerText().catch(() => null);
    if (run.hoverMaxToasts) fail(`${name}: hover produced ${run.hoverMaxToasts} toasts`);
    await shot(page, `hover-no-toast-${name}`);
  }

  // 1) invalid placement attempt -> toast -> gone after the timeout.
  if (mobile) { await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(500); run.touchPreviewToasts = await toasts(page).count(); run.touchConfirmDisabled = await page.locator('.tool-options button.primary').isDisabled(); run.touchInline = await page.locator('.tool-options .preview-cost').innerText().catch(() => null); }
  else { await page.mouse.move(p.x, p.y); await sleep(200); await page.mouse.down(); await page.mouse.up(); }
  await page.waitForTimeout(350);
  if (!mobile) {
    run.placement = await texts(page);
    if (run.placement.length !== 1 || !/vật cản|không phù hợp|Nền|dốc/.test(run.placement[0])) fail(`${name}: placement toast ${JSON.stringify(run.placement)}`);
    run.placementGeo = await geometry(page); await shot(page, `placement-toast-${name}`);
    await page.waitForTimeout(2800); run.placementAfter = await toasts(page).count();
    if (run.placementAfter) fail(`${name}: placement toast did not disappear`);
    await shot(page, `placement-gone-${name}`);
  }
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // 2) three different errors stacked, 3) the same error repeated and merged.
  const cmd = (type, payload) => page.evaluate(([t, pl]) => window.__debug.command(t, pl).code, [type, payload]);
  run.codes = [await cmd('DEMOLISH', { buildingId: 'nope' }), await cmd('CLAIM_QUEST', { questId: 'nope' }), await cmd('SELL', { items: { wheat: 5 } })];
  await page.waitForTimeout(300);
  run.stacked = await texts(page); run.stackedGeo = await geometry(page); await shot(page, `three-stacked-${name}`);
  if (run.stacked.length !== 3 || new Set(run.stacked).size !== 3) fail(`${name}: expected 3 distinct toasts, got ${JSON.stringify(run.stacked)}`);
  await cmd('CLAIM_RELIEF', {}); await page.waitForTimeout(200);
  run.capped = await toasts(page).count(); if (run.capped > 3) fail(`${name}: more than 3 toasts`);
  await page.waitForTimeout(3000); if (await toasts(page).count()) fail(`${name}: stacked toasts did not expire`);
  for (let i = 0; i < 3; i++) { await cmd('DEMOLISH', { buildingId: 'nope' }); await sleep(120); }
  await page.waitForTimeout(250);
  run.merged = await texts(page); await shot(page, `merged-x3-${name}`);
  if (run.merged.length !== 1 || !/×3/.test(run.merged[0])) fail(`${name}: merge ${JSON.stringify(run.merged)}`);
  // tap/click dismisses one
  await toasts(page).first().click(); await page.waitForTimeout(150);
  if (await toasts(page).count()) fail(`${name}: click did not dismiss`);
  // a11y
  await cmd('DEMOLISH', { buildingId: 'nope' }); await page.waitForTimeout(200);
  run.aria = await page.evaluate(() => { const e = document.querySelector('.hud3-toast'); return { role: e?.getAttribute('role'), live: e?.getAttribute('aria-live') }; });
  if (run.aria.live !== 'assertive') fail(`${name}: aria-live ${run.aria.live}`);
  if (mobile) {
    const g = run.stackedGeo; run.mobileGutter = g.list.map(t => [Math.round(t.x), Math.round(g.w - t.right)]);
    if (g.list.some(t => t.x < 15.5 || g.w - t.right < 15.5)) fail(`${name}: gutters < 16 ${JSON.stringify(run.mobileGutter)}`);
  }
  if (run.stackedGeo.overlap || run.stackedGeo.list.some(t => t.y < run.stackedGeo.topBottom - 1)) fail(`${name}: toast overlaps the top bar`);
  await context.close();
}
await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 1));
await browser.close();
console.log(JSON.stringify(report.runs, null, 1));
console.log(report.failures.length ? `FAILURES:\n${report.failures.join('\n')}` : 'toasts-qa OK');
process.exit(report.failures.length ? 1 : 0);
