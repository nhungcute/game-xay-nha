/**
 * G1 touch/mobile check (docs/09 §4, docs/10 §4 item 7) on Chromium mobile emulation.
 * Loads the level-4 plan snapshot, then: one-finger tap selects tools, tap on the map shows a
 * preview WITHOUT auto-confirming (touch rule), the ✓ button confirms; two-finger pinch zooms;
 * two-finger twist rotates. Writes docs/evidence/g1/mobile-*.jpg and mobile-evidence.json.
 */
import { chromium, devices } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5190';
const OUT = 'docs/evidence/g1';
const plan = JSON.parse(await readFile('test-results/g1/plan.json', 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const context = await browser.newContext({ ...devices['Pixel 7'] });
const page = await context.newPage();
const errors = [], checks = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); };
const debug = (fn, arg) => page.evaluate(([f, a]) => window.__debug[f](...(a ?? [])), [fn, arg]);
await page.goto(`${BASE}/?debug=1&test=1`);
await page.waitForFunction(() => !!window.__debug?.loadSnapshot, null, { timeout: 30000 });
check('snapshot loads on mobile', (await debug('loadSnapshot', [plan.snapshot])).ok);
await page.waitForTimeout(800);
const vp = page.viewportSize();
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
check('no horizontal page overflow at phone width', !overflow, { viewport: vp });
await page.screenshot({ path: `${OUT}/mobile-01-hud.jpg`, type: 'jpeg', quality: 80 });

// Tap a tool, then tap a shore cell: preview must not auto-confirm on touch.
await debug('camera', [129, 150, 60, 0, 62]); await page.waitForTimeout(300);
await page.locator('nav.tools button', { hasText: 'Kè' }).tap();
const cell = [64, 74];
const p = await debug('project', [cell[0] * 2 + 1, cell[1] * 2 + 1]);
const rev0 = (await debug('snapshot')).revision;
await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(300);
const rev1 = (await debug('snapshot')).revision;
check('touch tap previews but does not auto-confirm', rev1 === rev0, { rev0, rev1 });
const confirm = page.locator('.tool-options button.primary');
check('confirm button is visible and ≥ 44px tall', (await confirm.boundingBox())?.height >= 44, await confirm.boundingBox());
await page.screenshot({ path: `${OUT}/mobile-02-preview.jpg`, type: 'jpeg', quality: 80 });
await confirm.tap(); await page.waitForTimeout(300);
const rev2 = (await debug('snapshot')).revision;
check('✓ button confirms the touch preview', rev2 === rev0 + 1, { rev0, rev2 });

// Two-finger pinch and twist through CDP touch events.
await page.locator('nav.tools button', { hasText: 'Khám phá' }).tap();
const cdp = await context.newCDPSession(page);
const touch = async (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
const cx = vp.width / 2, cy = vp.height / 2;
const before = await debug('cameraState');
await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
for (let i = 1; i <= 10; i++) await touch('touchMove', [[cx - 40 - i * 8, cy], [cx + 40 + i * 8, cy]]);
await touch('touchEnd', []);
const pinched = await debug('cameraState');
check('pinch-out zooms in (distance decreases)', pinched.distance < before.distance, { before: before.distance, after: pinched.distance });
await touch('touchStart', [[cx - 60, cy], [cx + 60, cy]]);
for (let i = 1; i <= 10; i++) { const a = i * 0.06; await touch('touchMove', [[cx - 60 * Math.cos(a), cy - 60 * Math.sin(a)], [cx + 60 * Math.cos(a), cy + 60 * Math.sin(a)]]); }
await touch('touchEnd', []);
const twisted = await debug('cameraState');
check('two-finger twist rotates the camera', Math.abs(twisted.yaw - pinched.yaw) > 5, { before: pinched.yaw, after: twisted.yaw });
await page.screenshot({ path: `${OUT}/mobile-03-after-gestures.jpg`, type: 'jpeg', quality: 80 });
const metrics = await debug('metrics');
check('no page/console errors on mobile', errors.length === 0, errors);
await writeFile(`${OUT}/mobile-evidence.json`, JSON.stringify({ device: 'Pixel 7 (Chromium emulation)', viewport: vp, metrics, checks, errors }, null, 2));
await browser.close();
const failed = checks.filter(c => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} mobile checks passed`);
if (failed.length) process.exitCode = 1;
