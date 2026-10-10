// Deterministic browser review of entrance layouts and error states; API fixtures only.
// Real API/game creation is checked separately with g4-smoke.mjs.
import assert from 'node:assert/strict';
import { chromium, webkit, devices } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5191';
const out = process.env.OUT ?? 'docs/evidence/entry-design';
const cases = [
  { name: 'desktop', engine: chromium, options: { viewport: { width: 1440, height: 900 } }, shots: true },
  { name: 'tablet', engine: chromium, options: { viewport: { width: 820, height: 1180 } } },
  { name: 'mobile', engine: chromium, options: { ...devices['iPhone SE'] }, shots: true },
  { name: 'narrow', engine: chromium, options: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
  { name: 'webkit', engine: webkit, options: { ...devices['iPhone 13'] }, shots: true },
];
const maps = ['city', 'farm'].map(mapKind => ({ mapKind, mapId: mapKind === 'city' ? 'city-coast-01' : 'farm-valley-01',
  templateVersion: 2, url: `/worlds/${mapKind === 'city' ? 'city-coast-01' : 'farm-valley-01'}/template.v2.json` }));
const character = (kind, displayName) => ({ id: kind === 'city' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222',
  mapKind: kind, mapId: kind === 'city' ? 'city-coast-01' : 'farm-valley-01', templateVersion: 2, displayName,
  tag: '1234', level: 8, xp: 1000, cash: 2000, netWorth: 12500, updatedAt: '2026-10-10T00:00:00Z' });
const report = { base, startedAt: new Date().toISOString(), scope: 'API-fixture browser layout/error review; not real API evidence', runs: [] };
await mkdir(out, { recursive: true });

for (const config of cases) {
  const browser = await config.engine.launch({ headless: true, ...(config.engine === chromium
    ? { executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
  try {
    const context = await browser.newContext(config.options);
    // Exercise denied clipboard permissions without exposing real account credentials.
    await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('Clipboard blocked for this fixture')) }, configurable: true,
    }));
    const page = await context.newPage(), errors = [], checks = [];
    let createRequests = 0, recoverRequests = 0, existing = [], cityOnly = false;
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && !/400 \(Bad Request\)/.test(message.text())) errors.push(message.text());
    });
    await context.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let status = 200, body;
      if (path === '/api/maps') body = { maps: cityOnly ? maps.slice(0, 1) : maps, serverTime: Date.now() };
      else if (path === '/api/me') body = { accountId: 'fixture', characters: existing, serverTime: Date.now() };
      else if (path === '/api/characters') {
        createRequests++;
        if (createRequests === 1) { status = 400; body = { error: 'NAME_CHARACTERS' }; }
        else {
          const request = route.request().postDataJSON();
          existing = [character(request.mapKind, request.displayName)];
          body = { accountId: 'fixture', character: existing[0], token: 'entry-design-fixture', recoveryCode: 'TEST-CODE-0001', serverTime: Date.now() };
        }
      } else if (path === '/api/auth/recover') {
        recoverRequests++;
        if (recoverRequests === 1) { status = 400; body = { error: 'INVALID_RECOVERY_CODE' }; }
        else body = { accountId: 'fixture', token: 'entry-design-fixture', characters: [character('city', 'An Nhiên'), character('farm', 'Bình Yên')] };
      } else { throw new Error(`Unexpected fixture API call: ${path}`); }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const check = (name, result) => { assert(result, `${config.name}: ${name}`); checks.push(name); };
    const layout = async stage => {
      const bounds = await page.locator('.start').evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
      check(`${stage}: no horizontal overflow`, bounds.scrollWidth <= bounds.width);
      const targets = await page.locator('.start button:not(:disabled)').evaluateAll(elements =>
        elements.every(element => element.getBoundingClientRect().height >= 44));
      check(`${stage}: controls at least 44px tall`, targets);
    };
    const shot = async (name, maskCode = false) => {
      if (!config.shots) return;
      await page.waitForTimeout(450);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator('.start').evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: `${out}/${name}-${config.name}.jpg`, type: 'jpeg', quality: 85,
        ...(maskCode ? { mask: [page.locator('.code')] } : {}) });
    };
    await page.goto(base);
    await page.locator('.map-card.city button').waitFor();
    await page.evaluate(async () => {
      const art = new Image(); art.src = '/assets/entry/welcome-v1.webp'; await art.decode();
    });
    await page.waitForTimeout(450);
    await layout('maps'); await shot('maps');
    if (config.name === 'desktop') {
      const bottom = await page.locator('.map-card.city button').evaluate(element => element.getBoundingClientRect().bottom);
      check('desktop map action visible without scrolling', bottom <= config.options.viewport.height);
    }
    await page.locator('.map-card.city button').click();
    const name = page.getByLabel('Tên nhân vật', { exact: true });
    check('name field focused on creation', await name.evaluate(element => element === document.activeElement));
    await name.fill('An'); check('short name cannot submit', await page.getByRole('button', { name: 'Vào chơi', exact: true }).isDisabled());
    await name.fill('An Nhiên');
    check('live preview shows Vietnamese name', await page.locator('.character-preview h2').innerText() === 'An Nhiên');
    await layout('create'); await shot('create');
    await name.press('Tab');
    check('submit accessible from keyboard', await page.getByRole('button', { name: 'Vào chơi', exact: true }).evaluate(element => element === document.activeElement));
    await page.getByRole('button', { name: 'Vào chơi', exact: true }).click();
    await page.locator('#character-error').waitFor();
    check('server name rejection displayed accessibly', await name.getAttribute('aria-invalid') === 'true');
    check('create retry enabled after error', await page.getByRole('button', { name: 'Vào chơi', exact: true }).isEnabled());
    await page.getByRole('button', { name: 'Vào chơi', exact: true }).click();
    await page.locator('.code').waitFor(); await layout('recovery-code'); await shot('code', true);
    check('code screen prevents navigation that loses one-time code', await page.locator('.entry-header-action').count() === 0);
    await page.getByRole('button', { name: 'Sao chép', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Không sao chép tự động được' }).waitFor();
    check('denied clipboard offers manual copy', true);

    await page.evaluate(() => localStorage.clear()); existing = [];
    await page.goto(base); await page.locator('.map-card.city button').waitFor();
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    const code = page.getByLabel('Mã khôi phục', { exact: true });
    check('recovery field focused', await code.evaluate(element => element === document.activeElement));
    await layout('login'); await shot('login');
    await code.fill('ABCD'); check('short recovery code cannot submit', await page.getByRole('button', { name: 'Khôi phục', exact: true }).isDisabled());
    await code.fill('TEST-CODE-0001'); await page.getByRole('button', { name: 'Khôi phục', exact: true }).click();
    await page.locator('#recovery-error').waitFor();
    check('recovery rejection displayed accessibly', await code.getAttribute('aria-invalid') === 'true');
    await page.getByRole('button', { name: 'Khôi phục', exact: true }).click();
    await page.locator('.map-card.city .who').waitFor();
    check('recovery lists both characters', /An Nhiên/.test(await page.locator('.city .who').innerText()) && /Bình Yên/.test(await page.locator('.farm .who').innerText()));
    check('both characters can resume', await page.getByRole('button', { name: 'Chơi tiếp', exact: true }).count() === 2);
    await layout('returning-maps'); await shot('returning');
    await page.evaluate(() => localStorage.clear()); existing = []; cityOnly = true;
    await page.goto(base); await page.locator('.map-card.city button').waitFor();
    check('unavailable map cannot create', await page.locator('.map-card.farm button').isDisabled());
    await page.emulateMedia({ reducedMotion: 'reduce' });
    check('reduced motion respected', await page.locator('.entry-content').evaluate(element => window.getComputedStyle(element).animationName === 'none'));
    check('no unexpected browser errors', errors.length === 0);
    report.runs.push({ name: config.name, viewport: config.options.viewport, checks, errors, expectedRejections: 2 });
    console.log(`${config.name}: ${checks.length} checks PASS, ${errors.length} unexpected errors`);
    await context.close();
  } finally { await browser.close(); }
}
report.finishedAt = new Date().toISOString();
report.checkCount = report.runs.reduce((total, run) => total + run.checks.length, 0);
await writeFile(`${out}/review.json`, JSON.stringify(report, null, 2) + '\n');
console.log(`Entrance review PASS: ${report.checkCount} checks across ${report.runs.length} layouts.`);
