// Real UI review with one account reused across viewports; tokens and recovery codes stay in memory.
import { chromium, devices, webkit } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5191';
const OUT = process.env.OUT ?? 'docs/evidence/reference-ui/review';
await mkdir(OUT, { recursive: true });
const report = { base: BASE, startedAt: new Date().toISOString(), checks: [], errors: [] };
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
const launch = { executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] };
const chrome = await chromium.launch({ headless: true, ...launch });
let iphone;
try {
const signup = await chrome.newContext({ viewport: { width: 1440, height: 900 } });
const initial = await signup.newPage();
await initial.goto(`${BASE}/?debug=1`);
const characters = {};
for (const kind of ['city', 'farm']) {
  if (kind === 'farm') await initial.getByRole('button', { name: 'Đổi bản đồ', exact: true }).click();
  await initial.locator(`.map-card.${kind} button`, { hasText: 'Tạo nhân vật' }).click();
  await initial.locator('.field input').fill(kind === 'city' ? 'Nguyễn Minh Anh' : 'Trần Thanh Bình');
  await initial.getByRole('button', { name: 'Vào chơi', exact: true }).click();
  if (kind === 'city') await initial.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await initial.waitForFunction(() => !!window.__debug?.snapshot, null, { timeout: 60000 });
  characters[kind] = await initial.evaluate(() => localStorage.getItem('xay-nha.lastWorld'));
}
const token = await initial.evaluate(() => localStorage.getItem('xay-nha.token'));
await signup.close();
iphone = await webkit.launch({ headless: true });
const cases = [
  { name: 'desktop', browser: chrome, context: { viewport: { width: 1440, height: 900 } }, mobile: false },
  { name: 'tablet', browser: chrome, context: { viewport: { width: 820, height: 1180 } }, mobile: false },
  { name: 'phone-small', browser: chrome, context: { ...devices['Pixel 7'], viewport: { width: 375, height: 667 } }, mobile: true },
  { name: 'phone-narrow', browser: chrome, context: { ...devices['Pixel 7'], viewport: { width: 320, height: 740 } }, mobile: true },
  { name: 'iphone', browser: iphone, context: { ...devices['iPhone 13'] }, mobile: true },
  { name: 'landscape', browser: chrome, context: { viewport: { width: 812, height: 375 } }, mobile: false },
];
async function bounds(page, label) {
  const result = await page.evaluate(() => {
    const hud = document.querySelector('.hud').getBoundingClientRect(), dock = document.querySelector('.game-dock').getBoundingClientRect();
    const side = document.querySelector('.side,.catalog')?.getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, hud: { top: hud.top, bottom: hud.bottom, right: hud.right }, dock: { top: dock.top, bottom: dock.bottom, right: dock.right },
      overflow: document.documentElement.scrollWidth > innerWidth,
      panelsFit: !side || side.top >= hud.bottom && side.bottom <= dock.top - 5,
      controlsFit: dock.top > hud.bottom && dock.bottom <= innerHeight + 1 && hud.right <= innerWidth && dock.right <= innerWidth };
  });
  check(`${label}: controls fit, no document overflow, panels clear dock`, !result.overflow && result.panelsFit && result.controlsFit, result);
}
for (const run of cases) {
  const context = await run.browser.newContext(run.context);
  await context.addInitScript(({ token, world }) => { localStorage.setItem('xay-nha.token', token); if (!localStorage.getItem('xay-nha.lastWorld')) localStorage.setItem('xay-nha.lastWorld', world); }, { token, world: characters.city });
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(`${run.name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(`${run.name}: ${m.text()}`); });
  for (const kind of ['city', 'farm']) {
    if (kind === 'farm') await page.evaluate(id => localStorage.setItem('xay-nha.lastWorld', id), characters.farm);
    await page.goto(`${BASE}/?debug=1`);
    await page.waitForFunction(() => !!window.__debug?.snapshot, null, { timeout: 60000 });
    await page.waitForTimeout(500);
    await page.addStyleTag({ content: '.debug{display:none!important}' });
    const label = `${run.name}-${kind}`;
    const identity = await page.evaluate(() => { const s = window.__debug.snapshot(); return { initials: document.querySelector('.player-avatar>span').textContent, name: document.querySelector('.player-name').textContent, level: s.progress.level, bar: document.querySelector('.player-xp').getAttribute('aria-valuenow'), tools: document.querySelectorAll('nav.tools button').length }; });
    check(`${label}: avatar, name, level, XP and map tools`, identity.initials === (kind === 'city' ? 'NM' : 'TT') && identity.name === (kind === 'city' ? 'Nguyễn Minh Anh' : 'Trần Thanh Bình') && identity.level >= 1 && Number(identity.bar) >= 0 && identity.tools === (kind === 'city' ? 9 : 12), identity);
    await bounds(page, label);
    const map = page.getByRole('button', { name: 'Di chuyển góc nhìn trên bản đồ thu nhỏ' });
    check(label + ': real minimap visible', await map.isVisible() && await page.locator('.mini-map canvas').evaluate(el => !!el.getContext('2d')));
    const beforeCamera = await page.evaluate(() => window.__debug.cameraState().target);
    await map.click({ position: { x: 25, y: 30 } });
    const afterCamera = await page.evaluate(() => window.__debug.cameraState().target);
    check(label + ': minimap moves the camera', JSON.stringify(beforeCamera) !== JSON.stringify(afterCamera));
    await page.getByRole('button', { name: 'Góc mặc định', exact: true }).click();
    await page.screenshot({ path: `${OUT}/${label}.jpg`, type: 'jpeg', quality: 85 });
    await page.locator('.brand').click();
    check(`${label}: profile opens from character card`, await page.locator('.profile').isVisible());
    await bounds(page, `${label}-profile`);
    await page.getByRole('button', { name: 'Đóng bảng' }).click();
    await page.getByRole('button', { name: 'Vật liệu', exact: true }).click();
    await bounds(page, `${label}-materials`);
    await page.getByRole('button', { name: 'Đóng bảng' }).click();
    if (run.mobile) {
      const toggle = page.getByRole('button', { name: 'Menu chức năng' });
      await toggle.click();
      check(`${label}: mobile menu opens`, await toggle.getAttribute('aria-expanded') === 'true' && await page.getByRole('button', { name: 'Cài đặt', exact: true }).isVisible());
      await page.keyboard.press('Escape');
      check(`${label}: Escape closes menu and restores focus`, await toggle.getAttribute('aria-expanded') === 'false' && await toggle.evaluate(el => document.activeElement === el));
      await toggle.click();
    }
    await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
    await page.getByRole('button', { name: 'Thấp (máy yếu)', exact: true }).click();
    check(`${label}: settings changes quality`, await page.evaluate(() => window.__debug.metrics().quality) === 'low');
    await page.getByRole('button', { name: 'Đóng bảng' }).click();
    await page.locator('nav.tools button', { hasText: 'Xây' }).first().click();
    await page.waitForTimeout(500);
    check(`${label}: building catalog opens`, await page.locator('.catalog').isVisible());
    await bounds(page, `${label}-catalog`);
    if (run.mobile) await page.screenshot({ path: `${OUT}/${label}-catalog.jpg`, type: 'jpeg', quality: 85 });
    if (run.mobile) {
      await page.getByRole('button', { name: 'Hạ tầng', exact: true }).click();
      await page.waitForTimeout(500);
      const selection = page.locator('nav.tools button[aria-pressed=true]');
      const position = await selection.evaluate(el => { const r = el.getBoundingClientRect(), p = el.closest('nav').getBoundingClientRect(); return { left: r.left, right: r.right, viewportLeft: p.left, viewportRight: p.right }; });
      const selectedText = (await selection.innerText()).trim();
      check(`${label}: category selects a tool and exposes selection`, selectedText === 'Đường' && position.left >= position.viewportLeft - 1 && position.right <= position.viewportRight + 1, { selectedText, ...position });
    }
    await page.locator('nav.tools button', { hasText: 'Khám phá' }).first().click();
    if (kind === 'farm') {
      await page.getByRole('button', { name: 'Kho hàng', exact: true }).click();
      check(`${label}: empty inventory has guidance`, await page.locator('.empty-inventory').isVisible());
      await page.getByRole('button', { name: 'Đóng bảng' }).click();
    }
    if (run.mobile) await page.getByRole('button', { name: 'Menu chức năng' }).click();
    await page.getByRole('button', { name: run.mobile ? 'Nhiệm vụ' : 'Ẩn hướng dẫn', exact: true }).click();
    check(`${label}: quest visibility can be toggled`, await page.locator('aside.quest').count() === 0);
  }
  await context.close();
}
// Validated offline snapshots cover partial progression, level boundaries, and the final level.
const economy = JSON.parse(await readFile('packages/content/economy.v1.json', 'utf8'));
const fixture = await chrome.newContext({ viewport: { width: 1440, height: 900 } });
const fp = await fixture.newPage();
await fp.goto('http://127.0.0.1:5190/?debug=1&test=1');
await fp.waitForFunction(() => typeof window.__debug?.loadSnapshot === 'function');
for (const [level, offset] of [[8, 1000], [9, 0], [20, 0]]) {
  const threshold = economy.xp.cumulative.farm[level], next = economy.xp.cumulative.farm[level + 1];
  const result = await fp.evaluate(({ level, xp }) => { const s = window.__debug.snapshot(); s.progress.level = level; s.progress.xp = xp; s.character.netWorth += 304600000 - s.wallet.cash; s.wallet.cash = 304600000; return window.__debug.loadSnapshot(s); }, { level, xp: threshold + offset });
  check(`XP fixture L${level}: validated snapshot`, result.ok, result);
  if (!result.ok) continue;
  const values = await fp.locator('.player-xp').evaluate(el => ({ now: Number(el.getAttribute('aria-valuenow')), max: Number(el.getAttribute('aria-valuemax')), text: el.getAttribute('aria-valuetext') }));
  check(`XP fixture L${level}: relative progress and max-level text`, values.now === (next === undefined ? 1 : offset) && values.max === (next === undefined ? 1 : next - threshold) && (next !== undefined || values.text === 'Cấp tối đa'), values);
  check(`XP fixture L${level}: large wallet is compact`, await fp.locator('.cash').innerText() === '$304.6M');
}
await fp.screenshot({ path: `${OUT}/max-level-wallet.jpg`, type: 'jpeg', quality: 85 });
await fixture.close();
} catch (cause) {
  report.errors.push(cause instanceof Error ? cause.message : String(cause));
} finally {
await iphone?.close(); await chrome.close();
report.finishedAt = new Date().toISOString();
report.passed = report.checks.filter(c => c.ok).length;
report.total = report.checks.length;
await writeFile(`${OUT}/review.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Reference UI review: ${report.passed}/${report.total}, ${report.errors.length} errors`);
process.exitCode = report.passed !== report.total || report.errors.length ? 1 : 0;
}
