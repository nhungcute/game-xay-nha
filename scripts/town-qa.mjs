// Town map QA. Two modes (the Vite dev server must run in the matching mode):
//   MODE=offline (default; vite default mode, VITE_OFFLINE=1): the offline random town (`?map=town`) at 1440x900 and Pixel 7:
//     fresh overview, Dock with every tab incl. Nông trại, a house and a field side by side, the mission panel with the town chain, night.
//   MODE=online (vite --mode online): the map choice screen with mocked /api (a farm + city account) showing the Thị trấn card.
// Usage: BASE_URL=http://127.0.0.1:5202 node scripts/town-qa.mjs   |   MODE=online BASE_URL=... node scripts/town-qa.mjs
import { chromium, devices } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dismissLevelUp } from './lib/hud.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5202', OUT = 'docs/evidence/g4/town', MODE = process.env.MODE ?? 'offline';
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = { base: BASE, mode: MODE, at: new Date().toISOString(), runs: {}, failures: [] };
const fail = m => { report.failures.push(m); console.log('FAIL', m); };
const VIEWS = [['1440x900', { viewport: { width: 1440, height: 900 } }], ['pixel7', devices['Pixel 7']]];

if (MODE === 'online') {
  const character = (kind, name, level, netWorth) => ({ id: `00000000-0000-4000-8000-00000000000${kind === 'city' ? 1 : 2}`, mapKind: kind, mapId: kind === 'city' ? 'city-coast-01' : 'farm-valley-01',
    templateVersion: 2, displayName: name, tag: '4821', level, xp: 900, cash: 5400, netWorth, updatedAt: new Date().toISOString() });
  for (const [name, options] of VIEWS) {
    const context = await browser.newContext(options), page = await context.newPage();
    await page.addInitScript(() => { localStorage.setItem('xay-nha.token', 'mock-token'); localStorage.removeItem('xay-nha.lastWorld'); });
    await page.route('**/api/maps', r => r.fulfill({ json: { serverTime: Date.now(), maps: [
      { mapKind: 'city', mapId: 'city-coast-01', templateVersion: 2, url: '/worlds/city-coast-01/template.v2.json' }, { mapKind: 'farm', mapId: 'farm-valley-01', templateVersion: 2, url: '/worlds/farm-valley-01/template.v2.json' }] } }));
    await page.route('**/api/me', r => r.fulfill({ json: { accountId: 'a', username: 'Bác Tư', serverTime: Date.now(), characters: [character('city', 'Bác Tư', 7, 182000), character('farm', 'Bác Tư', 5, 41000)] } }));
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.map-card.town', { timeout: 30000 });
    await page.waitForTimeout(800);
    const cards = await page.evaluate(() => [...document.querySelectorAll('.map-card:not(.eco)')].map(c => ({ cls: c.className, title: c.querySelector('h3')?.textContent, button: c.querySelector('.map-play')?.textContent, disabled: c.querySelector('.map-play')?.disabled })));
    report.runs[`maps-${name}`] = cards;
    const town = cards.find(c => c.cls.includes('town'));
    if (!town || town.title !== 'Thị trấn' || town.disabled || !/Tạo nhân vật/.test(town.button ?? '')) fail(`${name}: town card missing or not creatable ${JSON.stringify(town)}`);
    if (cards.length !== 3) fail(`${name}: expected 3 map cards, got ${cards.length}`);
    await page.screenshot({ path: `${OUT}/map-choice-${name}.jpg`, type: 'jpeg', quality: 82, fullPage: name === 'pixel7' });
    await context.close();
  }
} else {
  const open = async options => {
    const context = await browser.newContext(options), page = await context.newPage();
    await page.goto(`${BASE}/?map=town&debug=1&test=1`);
    await page.waitForFunction(() => !!window.__debug?.command, null, { timeout: 90000 });
    await page.addStyleTag({ content: '.debug{display:none!important}' });
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__debug.timeOfDay(13));
    await dismissLevelUp(page);
    return { context, page };
  };
  const shot = (page, file) => page.screenshot({ path: `${OUT}/${file}.jpg`, type: 'jpeg', quality: 82 });
  /** Runs inside the page: tries a command over a growing window around the start-zone centre until the sim accepts it. */
  const tryAround = (page, spec) => page.evaluate(({ type, make, cx, cz }) => {
    const mk = new Function('x', 'z', `return (${make})(x, z)`);
    for (let r = 0; r < 16; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const res = window.__debug.command(type, mk(cx + dx, cz + dz));
      if (res.accepted) return [cx + dx, cz + dz];
    }
    return null;
  }, spec);
  for (const [name, options] of VIEWS) {
    const tap = name === 'pixel7', click = l => (tap ? l.tap() : l.click());
    const { context, page } = await open(options), run = report.runs[name] = {};
    const snap = await page.evaluate(() => window.__debug.snapshot());
    run.mapKind = snap.mapKind; run.mapId = snap.mapId;
    if (snap.mapKind !== 'town') fail(`${name}: expected a town world, got ${snap.mapKind}`);
    const zones = snap.unlockedZones, cx = Math.round(zones.reduce((s, z) => s + (z % 8) * 16 + 8, 0) / zones.length), cz = Math.round(zones.reduce((s, z) => s + Math.floor(z / 8) * 16 + 8, 0) / zones.length);
    await shot(page, `overview-${name}`);

    // Dock: every tab including Nông trại.
    run.tabs = await page.evaluate(() => [...document.querySelectorAll('.hud3-cat')].map(e => e.dataset.cat));
    for (const want of ['buildings', 'roads', 'farms', 'land', 'decorations', 'utilities']) if (!run.tabs.includes(want)) fail(`${name}: dock tab ${want} missing (${run.tabs})`);
    await shot(page, `dock-${name}`);
    await click(page.locator('.hud3-cat[data-cat=farms]')); await page.waitForTimeout(400);
    run.farmTools = await page.evaluate(() => [...document.querySelectorAll('.hud3-tray button')].map(e => e.textContent?.trim()).filter(Boolean));
    await shot(page, `dock-farms-tab-${name}`);
    await click(page.locator('.hud3-cat[data-cat=buildings]')); await page.waitForTimeout(400);
    run.buildingCards = await page.evaluate(() => [...document.querySelectorAll('.hud3-tray .hud3-card')].map(e => e.dataset.def));
    await shot(page, `dock-buildings-tab-${name}`);
    await page.keyboard.press('Escape');

    // A house and a field side by side (real commands).
    // Road cell first, then a farmhouse whose south entrance touches it (road access => its fields count).
    const placed = await page.evaluate(({ cx, cz }) => {
      for (let r = 0; r < 16; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx, z = cz + dz;
        if (!window.__debug.command('BUILD_ROAD', { tier: 1, cells: [[x, z], [x + 1, z], [x + 2, z], [x + 3, z], [x + 4, z], [x + 5, z]] }).accepted) continue;
        if (window.__debug.command('PLACE_BUILDING', { defId: 'farmhouse', anchor: [x, z - 3], rotation: 0 }).accepted) return { road: [x, z], farmhouse: [x, z - 3] };
      }
      return null;
    }, { cx: cx + 2, cz });
    const road = placed?.road ?? null, farmhouse = placed?.farmhouse ?? null;
    const house = await tryAround(page, { type: 'PLACE_BUILDING', make: '(x,z)=>({defId:"house_small",anchor:[x,z],rotation:0})', cx: cx - 6, cz: cz - 2 });
    const shop = await tryAround(page, { type: 'PLACE_BUILDING', make: '(x,z)=>({defId:"shop_grocery",anchor:[x,z],rotation:0})', cx: cx - 8, cz: cz + 1 });
    await page.evaluate(() => window.__debug.advance(120000));
    const field = await tryAround(page, { type: 'TILL', make: '(x,z)=>({rect:[x,z,x+5,z+1]})', cx: (farmhouse?.[0] ?? cx) + 4, cz: (farmhouse?.[1] ?? cz) - 3 });
    const planted = field && await page.evaluate(([x, z]) => window.__debug.command('PLANT', { rect: [x, z, x + 5, z + 1], cropId: 'veg_greens' }), field);
    run.placed = { road, farmhouse, house, shop, field, planted: planted?.accepted ?? null };
    if (!road || !farmhouse || !house || !field || !planted?.accepted) fail(`${name}: could not place road/farmhouse/house/field ${JSON.stringify(run.placed)}`);
    await page.evaluate(() => window.__debug.advance(400000));
    await page.waitForTimeout(1500);
    const collect = await page.evaluate(() => window.__debug.command('COLLECT', { buildingIds: [] }));
    run.collect = collect.accepted; if (!collect.accepted) fail(`${name}: COLLECT rejected on town ${JSON.stringify(collect)}`);
    await dismissLevelUp(page);
    await shot(page, `house-and-field-${name}`);

    // Mission panel with the town chain (unfold on phones).
    const head = page.locator('.hud3-missions-head');
    if ((await head.getAttribute('aria-expanded')) !== 'true') { await click(head); await page.waitForTimeout(400); }
    run.missions = await page.evaluate(() => ({ heading: document.querySelector('.hud3-missions-head small')?.textContent,
      quests: [...document.querySelectorAll('.hud3-missions .hud3-mission')].map(el => ({ title: el.querySelector('strong')?.textContent, done: el.classList.contains('is-done') })) }));
    if (run.missions.quests.length !== 5) fail(`${name}: expected 5 open quests, got ${run.missions.quests.length}`);
    await shot(page, `missions-${name}`);
    const claim = page.locator('.hud3-missions .hud3-mission.is-done .hud3-claim').first();
    if (await claim.count()) { await click(claim); await page.waitForTimeout(700); await dismissLevelUp(page); }
    run.afterClaim = await page.evaluate(() => ({ heading: document.querySelector('.hud3-missions-head small')?.textContent, claimed: window.__debug.snapshot().progress.claimedQuests }));
    await shot(page, `missions-after-claim-${name}`);

    // Night.
    await page.evaluate(() => window.__debug.timeOfDay(23)); await page.waitForTimeout(1800);
    await shot(page, `night-${name}`);
    await context.close();
    console.log(name, run.mapId, run.tabs.join(','), JSON.stringify(run.placed), run.missions.heading);
  }
}
await writeFile(`${OUT}/report-${MODE}.json`, `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
if (report.failures.length) { console.error(`Town QA FAILED:\n  ${report.failures.join('\n  ')}`); process.exitCode = 1; } else console.log('Town QA passed');
