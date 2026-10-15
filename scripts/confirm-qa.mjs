// Confirm-bar QA (offline dev server, BASE_URL default :5198): mouse tools commit on release with no Xác nhận/Hủy; touch needs the named
// primary button; Phá keeps a red confirm. Evidence in docs/evidence/g4/confirm. Usage: BASE_URL=http://127.0.0.1:5198 node scripts/confirm-qa.mjs
import { chromium, devices } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dismissLevelUp, pickTool } from './lib/hud.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5198', OUT = 'docs/evidence/g4/confirm';
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const template = await readFile('apps/web/public/worlds/city-coast-01/template.v2.json', 'utf8'), entry = JSON.parse(template).entryCells[0] ?? [60, 60];
const report = { base: BASE, at: new Date().toISOString(), checks: {}, failures: [] };
const check = (name, ok, extra) => { report.checks[name] = { ok, extra }; if (!ok) report.failures.push(name); console.log(ok ? 'ok  ' : 'FAIL', name, extra ?? ''); };
async function open(options) {
  const context = await browser.newContext(options), page = await context.newPage();
  await page.route('**/worlds/farm-g1/template.v1.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: template }));
  await page.goto(`${BASE}/?debug=1&test=1`);
  await page.waitForFunction(() => !!window.__debug?.command, null, { timeout: 60000 });
  await page.addStyleTag({ content: '.debug{display:none!important}' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__debug.timeOfDay(13));
  await dismissLevelUp(page);
  await aim(page, entry);
  return { context, page };
}
const aim = async (page, [x, z]) => { const d = page.viewportSize().width < 600 ? 70 : 34; await page.evaluate(([x, z, d]) => window.__debug.camera(x * 2 + 1, z * 2 + 1, d, 35, 42), [x, z, d]); await page.waitForTimeout(800); };
const count = (page, key) => page.evaluate(k => window.__debug.snapshot()[k].length, key);
const proj = (page, [x, z]) => page.evaluate(([x, z]) => window.__debug.project(x * 2 + 1, z * 2 + 1), [x, z]);
const bar = page => page.evaluate(() => ({ text: document.querySelector('.tool-options')?.innerText ?? null, primary: document.querySelector('.tool-options button.primary')?.innerText ?? null, disabled: document.querySelector('.tool-options button.primary')?.disabled ?? null, cost: document.querySelector('.preview-cost')?.className ?? null, hasOld: /Xác nhận|Hủy/.test(document.querySelector('.tool-options')?.innerText ?? '') }));
const shot = (page, f) => page.screenshot({ path: `${OUT}/${f}.jpg`, type: 'jpeg', quality: 82 });
const cands = []; for (let dz = -10; dz <= 10; dz += 1) for (let dx = -10; dx <= 10; dx += 1) cands.push([entry[0] + dx, entry[1] + dz]);
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, id) => ({ x: p.x, y: p.y, id })) });
async function tap(cdp, x, y) { await touch(cdp, 'touchStart', [{ x, y }]); await touch(cdp, 'touchEnd', []); }
async function dragTouch(cdp, a, b) { await touch(cdp, 'touchStart', [a]); for (let i = 1; i <= 6; i++) await touch(cdp, 'touchMove', [{ x: a.x + (b.x - a.x) * i / 6, y: a.y + (b.y - a.y) * i / 6 }]); await touch(cdp, 'touchEnd', []); }
/** Hover (mouse) or tap-preview (touch) candidates until the cost line is `want` ('valid'|'error'). */
async function seek(page, want, cdp, far = false) {
  const h = page.viewportSize().height;
  for (const c of far ? cands.filter(([x, z]) => Math.abs(x - entry[0]) > 6 || Math.abs(z - entry[1]) > 6) : cands) {
    const p = await proj(page, c); if (!p || p.x < 0 || p.y < 60 || p.y > h * 0.55 || !(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', [p.x, p.y]))) continue;
    if (cdp) await tap(cdp, p.x, p.y); else await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(90);
    if ((await bar(page)).cost?.includes(want)) return { cell: c, p };
  }
  return null;
}
async function pickFirstBuilding(page, tapIt) {
  const cat = page.locator('.hud3-cat[data-cat=buildings]'); await (tapIt ? cat.tap() : cat.click());
  const card = page.locator('.hud3-tray .hud3-card:not([disabled])').first(); const name = await card.getAttribute('data-def');
  await (tapIt ? card.tap() : card.click()); await page.waitForTimeout(150); return name;
}
const cash = page => page.evaluate(() => window.__debug.getStateHash());

// ---------- desktop ----------
{
  const { context, page } = await open({ viewport: { width: 1440, height: 900 } });
  const def = await pickFirstBuilding(page, false);
  const valid = await seek(page, 'valid');
  check('desktop: valid hover found', !!valid, { def, cell: valid?.cell });
  let b = await bar(page); await shot(page, 'desktop-build-valid');
  check('desktop: no Xác nhận/Hủy, no primary button', !b.hasOld && b.primary === null, b);
  check('desktop: hint Esc present', /Esc để thoát/.test(b.text ?? ''));
  await seek(page, 'error', null, true);
  b = await bar(page); await shot(page, 'desktop-build-invalid');
  check('desktop: invalid hover shows error text', !!b.cost?.includes('error'), b.text);
  await aim(page, entry);
  const v2 = await seek(page, 'valid'), n0 = await count(page, 'buildings');
  await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(500);
  check('desktop: building placed on release, no button', (await count(page, 'buildings')) === n0 + 1, { n0, cell: v2?.cell });
  await dismissLevelUp(page);
  await pickTool(page, 'Đường');
  const r0 = await cash(page);
  for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    const a = await proj(page, entry), c = await proj(page, [entry[0] + dx * 5, entry[1] + dz * 5]);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); for (let i = 1; i <= 10; i++) await page.mouse.move(a.x + (c.x - a.x) * i / 10, a.y + (c.y - a.y) * i / 10); await page.waitForTimeout(150);
    if ((await bar(page)).cost?.includes('valid')) { await shot(page, 'desktop-road-drag'); await page.mouse.up(); await page.waitForTimeout(500); break; }
    await page.mouse.up(); await page.waitForTimeout(150);
  }
  const r1 = await cash(page);
  check('desktop: road drag placed on release', r1 !== r0, { r0, r1 }); b = await bar(page); check('desktop: road bar has no old buttons', !b.hasOld);
  await dismissLevelUp(page); await page.locator('.tool-options .exit-x').click(); await page.waitForTimeout(150);
  check('desktop: exit icon leaves the tool', (await page.locator('.tool-options').count()) === 0);
  const built = await page.evaluate(() => window.__debug.snapshot().buildings.at(-1).anchor);
  await dismissLevelUp(page); await pickTool(page, 'Phá'); const pb = await proj(page, built); await page.mouse.click(pb.x, pb.y); await page.waitForTimeout(500);
  b = await bar(page); await shot(page, 'desktop-demolish');
  check('desktop: demolish shows red "Phá · hoàn $"', /^Phá · hoàn \$/.test(b.primary ?? '') && (await page.locator('.commit.danger').count()) === 1, b.primary);
  check('desktop: demolish not executed before confirm', (await count(page, 'buildings')) === n0 + 1);
  await page.locator('.commit.danger').click(); await page.waitForTimeout(600);
  check('desktop: demolish confirmed removes building', (await count(page, 'buildings')) === n0, { n: await count(page, 'buildings') });
  await context.close();
}

// ---------- touch ----------
{
  const { context, page } = await open(devices['Pixel 7']), cdp = await context.newCDPSession(page);
  const def = await pickFirstBuilding(page, true);
  const n0 = await count(page, 'buildings');
  const valid = await seek(page, 'valid', cdp);
  check('touch: valid tap preview found', !!valid, { def, cell: valid?.cell });
  let b = await bar(page); await shot(page, 'pixel7-build-preview');
  check('touch: tap alone buys nothing', (await count(page, 'buildings')) === n0);
  check('touch: button names action + price', /^Đặt .* · \$\d/.test(b.primary ?? '') && b.disabled === false, b.primary);
  const box = await page.locator('.tool-options .commit').boundingBox();
  check('touch: buttons >= 44px', box.height >= 44 && (await page.locator('.tool-options .exit-x').boundingBox()).width >= 44, box);
  await seek(page, 'error', cdp, true);
  b = await bar(page); await shot(page, 'pixel7-build-invalid');
  check('touch: invalid -> disabled button with reason', b.disabled === true && !!b.primary && !/^Đặt/.test(b.primary), b.primary);
  await aim(page, entry);
  await seek(page, 'valid', cdp);
  await page.locator('.tool-options .commit').tap(); await page.waitForTimeout(500);
  check('touch: building bought only after the button', (await count(page, 'buildings')) === n0 + 1);
  await dismissLevelUp(page);
  await dismissLevelUp(page); await pickTool(page, 'San nền', { tap: true });
  const v3 = await seek(page, 'valid', cdp), a = await proj(page, v3.cell), c = await proj(page, [v3.cell[0] + 2, v3.cell[1] + 2]);
  await dragTouch(cdp, a, c); await page.waitForTimeout(250);
  b = await bar(page); await shot(page, 'pixel7-rect-terraform');
  check('touch: rect tool names cells + price (or reason)', /^Cuốc \d+ ô/.test(b.primary ?? '') || b.disabled === true, b.primary);
  const built = await page.evaluate(() => window.__debug.snapshot().buildings.at(-1).anchor);
  await pickTool(page, 'Phá', { tap: true }); const pb = await proj(page, built); await tap(cdp, pb.x, pb.y); await page.waitForTimeout(400);
  b = await bar(page); await shot(page, 'pixel7-demolish');
  check('touch: demolish red button with refund', /^Phá · hoàn \$/.test(b.primary ?? ''), b.primary);
  await context.close();
}
await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 1));
await browser.close();
console.log(report.failures.length ? `FAILURES:\n${report.failures.join('\n')}` : 'confirm-qa OK');
process.exit(report.failures.length ? 1 : 0);
