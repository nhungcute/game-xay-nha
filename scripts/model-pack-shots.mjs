// D029 visual QA: every imported model framed up close in the game scene — front/side/back at high and low
// graphics, four rotations of one building (the door must track the entrance), construction + upgrade scaffolds,
// and map overviews. Records draw calls / triangles from window.__debug.metrics().
// Usage: (vite offline dev on 5190) node scripts/model-pack-shots.mjs
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dismissLevelUp, openSettings } from './lib/hud.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5190', SRC = 'docs/evidence/g4/full-world', OUT = 'docs/evidence/g4/model-pack';
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = { base: BASE, at: new Date().toISOString(), shots: [], errors: [] };
const CITY_IDS = ['house_small', 'shop_grocery', 'house_town', 'shop_cafe', 'shop_restaurant', 'bank', 'house_apartment', 'office_tower', 'hotel', 'shop_supermarket', 'deco_garden', 'deco_park'];
const FARM_IDS = ['farmhouse', 'market', 'well', 'chicken_coop', 'rice_mill', 'cow_barn', 'bakery', 'deco_flowerbed'];

async function setQuality(page, quality) {
  await showHud(page); // the settings button lives in the hidden HUD
  await openSettings(page);
  await page.locator('.settings button', { hasText: quality === 'low' ? 'Thấp' : 'Cao' }).click();
  await page.locator('.side.panel .close').click();
  await page.waitForTimeout(700);
  await hideHud(page);
}
/** Hide/show the whole HUD for unobstructed model shots (the canvas is the shell's only other child). */
const hideHud = page => page.evaluate(() => {
  let style = document.getElementById('d029-hud-hide');
  if (!style) { style = document.createElement('style'); style.id = 'd029-hud-hide'; style.textContent = '.hud3-shell > :not(canvas) { display: none !important; }'; document.head.append(style); }
});
const showHud = page => page.evaluate(() => document.getElementById('d029-hud-hide')?.remove());
/** Frames one building (world centre x/z, footprint cells) from three yaw angles and screenshots it.
 *  D029 review fix: the camera targets the building's own footprint centre, `window.__debug.project` must
 *  confirm the centre (and a point above the roof) land inside the viewport, and taller neighbours along the
 *  view line push the distance out so nothing occludes the target. `targetId` lands in report.json. */
async function shoot(page, kind, id, x, z, footprint, quality, label = null, distOverride = null) {
  const [sw, sd] = footprint;
  const angles = label ? [[label, 0]] : [['front', 0], ['side', 135], ['back', 180]];
  const height = await page.evaluate(async defId => {
    const manifest = await (await fetch('/assets/manifest.json')).json();
    return manifest.assets.find(asset => asset.id === defId)?.sizeAfterM?.[1] ?? 3;
  }, id);
  for (const [name, yaw] of angles) {
    let dist = distOverride ?? Math.max(10, Math.max(sw, sd) * 2.6);
    if (distOverride) dist = Math.min(dist, distOverride);
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.evaluate(([cx, cz, distance, y, p]) => window.__debug.camera(cx, cz, distance, y, p), [x, z, dist, yaw, 32]);
      await page.waitForTimeout(1100);
      const framed = await page.evaluate(([cx, cz, topY]) => {
        const project = window.__debug.project;
        const centre = project(cx, cz), top = project(cx, cz);
        const w = innerWidth, h = innerHeight;
        const inside = point => point.x >= 60 && point.x <= w - 60 && point.y >= 40 && point.y <= h - 40;
        return { centre: { ...centre, ok: inside(centre) }, topOk: inside({ x: top.x, y: top.y - topY }) };
      }, [x, z, height + 2]);
      const blocked = await page.evaluate(([cx, cz, distance, y]) => {
        // Anything taller than the sight line between the camera and the target centre occludes it.
        const yaw = y * Math.PI / 180;
        const camX = cx + Math.sin(yaw) * distance, camZ = cz + Math.cos(yaw) * distance;
        const s = window.__debug.snapshot();
        return s.buildings.some(b => {
          if (!b.anchor) return false;
          const bx = (b.anchor[0] + 1.5) * 2, bz = (b.anchor[1] + 1.5) * 2;
          const along = ((bx - camX) * (cx - camX) + (bz - camZ) * (cz - camZ)) / ((cx - camX) ** 2 + (cz - camZ) ** 2 || 1);
          if (along <= 0.02 || along >= 0.98) return false;
          const px = camX + along * (cx - camX), pz = camZ + along * (cz - camZ);
          return Math.hypot(bx - px, bz - pz) < 3.2 && (b.defId === 'office_tower' || b.defId === 'house_apartment' || b.defId === 'hotel');
        });
      }, [x, z, dist, yaw]);
      if ((framed.centre.ok && framed.topOk && !blocked) || attempt === 3) {
        const file = `${OUT}/${kind}-${id}-${name}-${quality}.jpg`;
        await page.screenshot({ path: file, type: 'jpeg', quality: 80 });
        const m = await page.evaluate(() => window.__debug.metrics());
        report.shots.push({ kind, id, targetId: id, label: name, quality, file, drawCalls: m.drawCalls, triangles: m.triangles, framed: { centreInFrame: framed.centre.ok, topInFrame: framed.topOk, blocked }, cameraDistance: dist });
        break;
      }
      dist *= 1.35; // occluded or out of frame — back off and try again
    }
  }
}

  // deco_flowerbed is absent from the G4 farm snapshot: scan unlocked zones for a free, flat 1×1 cell.
  async function placeInFreeCell(page, defId) {
    return page.evaluate(defId => {
      const s = window.__debug.snapshot();
      for (const zone of s.unlockedZones) {
        const zx = (zone % 8) * 16, zz = Math.floor(zone / 8) * 16;
        for (let x = zx + 2; x < zx + 14; x++) for (let z = zz + 2; z < zz + 14; z++) {
          const r = window.__debug.command('PLACE_BUILDING', { defId, anchor: [x, z], rotation: 0 });
          if (r.accepted) return { anchor: [x, z] };
        }
      }
      return null;
    }, defId);
  }
  for (const [kind, mapId, ids] of [['city', 'city-coast-01', CITY_IDS], ['farm', 'farm-valley-01', FARM_IDS]]) {
  const template = await readFile(`apps/web/public/worlds/${mapId}/template.v2.json`, 'utf8');
  const snapshot = JSON.parse(await readFile(`${SRC}/${kind}-snapshot.json`, 'utf8'));
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await context.newPage();
  page.on('pageerror', e => report.errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  await page.route('**/worlds/farm-g1/template.v1.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: template }));
  await page.goto(`${BASE}/?debug=1&test=1`);
  await page.waitForFunction(() => !!window.__debug?.loadSnapshot, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const loaded = await page.evaluate(s => { const cur = window.__debug.snapshot(); s.worldId = cur.worldId; s.accountId = cur.accountId; return window.__debug.loadSnapshot(s); }, snapshot);
  if (!loaded.ok) { report.errors.push(`${kind}: ${JSON.stringify(loaded.errors).slice(0, 300)}`); await context.close(); continue; }
  await page.waitForTimeout(2500);
  for (let i = 0; i < 4; i++) await dismissLevelUp(page);
  await page.locator('.debug').evaluate(el => { el.style.display = 'none'; }).catch(() => {});
  await hideHud(page);
  const manifest = await (await fetch(new URL('/assets/manifest.json', BASE))).json();
  const footprintOf = id => manifest.assets.find(asset => asset.id === id)?.footprint ?? [2, 2];

  // D029 review fixes get an extra ≤ 10 m close-up per quality (well, park, windmill, townhouse, restaurant).
  const CLOSE_UP = new Set(['well', 'deco_park', 'rice_mill', 'house_town', 'shop_restaurant']);
  for (const id of ids) {
    let building = snapshot.buildings.find(b => b.defId === id);
    if (!building && id === 'deco_flowerbed') building = await placeInFreeCell(page, 'deco_flowerbed');
    if (!building) { report.errors.push(`${kind}/${id}: no instance in snapshot`); continue; }
    const [sw, sd] = footprintOf(id);
    const x = (building.anchor[0] + sw / 2) * 2, z = (building.anchor[1] + sd / 2) * 2;
    await shoot(page, kind, id, x, z, [sw, sd], 'high');
    await setQuality(page, 'low');
    await shoot(page, kind, id, x, z, [sw, sd], 'low');
    await setQuality(page, 'high');
    if (CLOSE_UP.has(id)) {
      await shoot(page, kind, id, x, z, [sw, sd], 'high', 'close', 10);
      await setQuality(page, 'low');
      await shoot(page, kind, id, x, z, [sw, sd], 'low', 'close', 10);
      await setQuality(page, 'high');
    }
  }

  // Four rotations of house_small in a cleared row: the door must track the building rotation (entranceSide S).
  // house_small renders on both maps, so the emptier farm zones work too. Clear env, demolish, flatten, place.
  {
    const cluster = await page.evaluate(() => {
      const s = window.__debug.snapshot();
      const envByCell = new Map(window.__debug.env().filter(e => e.blocking).map(e => [e.cell.join(','), e.id]));
      const buildingsByCell = new Map();
      for (const b of s.buildings) for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) buildingsByCell.set((b.anchor[0] + dx) + ',' + (b.anchor[1] + dz), b);
      for (const zone of s.unlockedZones) {
        const zx = (zone % 8) * 16, zz = Math.floor(zone / 8) * 16;
        for (let x = zx + 2; x <= zx + 12; x += 2) for (let z = zz + 2; z <= zz + 6; z += 2) {
          const anchors = [0, 4, 8, 12].map(dz => [x, z + dz]);
          const cells = anchors.flatMap(([ax, az]) => [[ax, az], [ax + 1, az], [ax, az + 1], [ax + 1, az + 1]]);
          for (const [cx, cz] of cells) {
            const envId = envByCell.get(cx + ',' + cz);
            if (envId) window.__debug.command('CLEAR_ENV', { envIds: [envId] });
            const building = buildingsByCell.get(cx + ',' + cz);
            if (building && !building.upgrade) window.__debug.command('DEMOLISH', { buildingId: building.id });
          }
          const flat = window.__debug.command('TERRAFORM', { rect: [anchors[0][0], anchors[0][1], anchors[3][0] + 1, anchors[3][1] + 1], mode: 'FLATTEN' });
          if (!flat.accepted) continue; // road or water in the strip — try the next one
          const placed = anchors.map(([ax, az], rotation) => {
            const r = window.__debug.command('PLACE_BUILDING', { defId: 'house_small', anchor: [ax, az], rotation });
            return r.accepted ? true : r.code;
          });
          if (placed.every(Boolean)) return { anchors };
        }
      }
      return null;
    });
    if (!cluster) report.errors.push('rotation row: no clearable 4×16 strip in an unlocked zone');
    // The four re-placed houses are CONSTRUCTING for their 30 s build — finish them so the doors are visible.
    await page.evaluate(() => window.__debug.advance?.(31_000));
    await page.waitForTimeout(900);
    for (const quality of ['high', 'low']) {
      if (quality === 'low') await setQuality(page, 'low');
      if (cluster) {
        const xs = cluster.anchors.map(a => a[0]), zs = cluster.anchors.map(a => a[1]);
        await page.evaluate(([cx, cz, distance, y, p]) => window.__debug.camera(cx, cz, distance, y, p),
          [(Math.min(...xs) + Math.max(...xs) + 2) / 2 * 2, (Math.min(...zs) + Math.max(...zs) + 2) / 2 * 2, 30, 0, 34]);
      }
      await page.waitForTimeout(1100);
      const file = `${OUT}/${kind}-rotations-0-90-180-270-${quality}.jpg`;
      await page.screenshot({ path: file, type: 'jpeg', quality: 80 });
      report.shots.push({ kind, id: 'house_small-rotations', quality, file });
      if (quality === 'low') await setQuality(page, 'high');
    }
    // Free the builder pool for the construction/upgrade states below.
    await page.evaluate(() => {
      const s = window.__debug.snapshot();
      for (const b of s.buildings.filter(b => b.status === 'CONSTRUCTING' && b.defId === 'house_small')) window.__debug.command('CANCEL_CONSTRUCTION', { buildingId: b.id });
    });
    await page.waitForTimeout(400);
  }

  // Construction scaffold (house_small mid-build): rebuild at an existing house's cell (guaranteed valid ground).
  {
    const rebuilt = await page.evaluate(() => {
      // Rebuild candidates in popularity order until one demolishes cleanly (production queues block some).
      const s = window.__debug.snapshot();
      const counts = new Map();
      for (const b of s.buildings) counts.set(b.defId, (counts.get(b.defId) ?? 0) + 1);
      const popular = [...counts.entries()]
        // farmhouse (field quota) and silo (storage) refuse demolition while in use — D020 guards.
        .filter(([id]) => !['farmhouse', 'silo'].includes(id))
        .sort((a, b) => b[1] - a[1]);
      for (const [defId] of popular) {
        const twin = s.buildings.filter(b => b.defId === defId && !b.upgrade).at(-1);
        if (!twin) continue;
        const gone = window.__debug.command('DEMOLISH', { buildingId: twin.id });
        if (!gone.accepted) continue;
        const r = window.__debug.command('PLACE_BUILDING', { defId: twin.defId, anchor: twin.anchor, rotation: twin.rotation });
        if (r.accepted) return { anchor: twin.anchor, defId }; // a fresh placement is CONSTRUCTING for its build time
      }
      return 'no demolishable candidate';
    });
    if (!rebuilt || typeof rebuilt === 'string') report.errors.push(`construction: ${rebuilt}`);
    if (rebuilt && typeof rebuilt === 'object') {
      const [tx, tz] = rebuilt.anchor;
      await page.waitForTimeout(700);
      for (const quality of ['high', 'low']) {
        if (quality === 'low') await setQuality(page, 'low');
        await page.evaluate(([cx, cz, distance, y, p]) => window.__debug.camera(cx, cz, distance, y, p), [(tx + 1) * 2, (tz + 1) * 2, 20, 35, 32]);
        await page.waitForTimeout(1100);
        const file = `${OUT}/${kind}-construction-scaffold-${quality}.jpg`;
        await page.screenshot({ path: file, type: 'jpeg', quality: 80 });
        report.shots.push({ kind, id: 'construction', quality, file });
        if (quality === 'low') await setQuality(page, 'high');
      }
    }
    // Upgrade ring: collect everything first (empty list collects every working building), then try the
    // cheapest building first — D028 upgrade cost is 2.5× base, tier 2 needs world level 10 (this world is max level).
    const upgradeCandidates = await page.evaluate(() => {
      window.__debug.command('COLLECT', { buildingIds: [] });
      window.__debug.command('BUY_MATERIAL', { wood: 120, stone: 120 }); // upgrade prices repeat the base material cost
      const s = window.__debug.snapshot();
      const cost = { deco_garden: 60, deco_flowerbed: 60, deco_park: 400, well: 120, house_small: 300, shop_grocery: 500, house_town: 1200, shop_cafe: 1500, chicken_coop: 800, shop_restaurant: 4000, rice_mill: 2500, bakery: 3000, cow_barn: 6000, bank: 8000, house_apartment: 15000, shop_supermarket: 22000, hotel: 50000, office_tower: 100000 };
      return s.buildings
        .filter(b => b.status === 'ACTIVE' && !b.upgrade)
        .map(b => ({ id: b.id, defId: b.defId, anchor: b.anchor, cost: cost[b.defId] ?? 999999 }))
        .sort((a, b) => a.cost - b.cost);
    });
    let upgrade = null;
    for (const candidate of upgradeCandidates) {
      const attempt = await page.evaluate(b => window.__debug.command('UPGRADE_BUILDING', { buildingId: b.id }), candidate);
      if (attempt.accepted) { upgrade = { ...candidate }; break; }
    }
    report.upgrade = upgrade ? { accepted: true, defId: upgrade.defId } : { accepted: false };
    if (upgrade) {
      await page.waitForTimeout(900);
      for (const quality of ['high', 'low']) {
        if (quality === 'low') await setQuality(page, 'low');
        await page.evaluate(([cx, cz, distance, y, p]) => window.__debug.camera(cx, cz, distance, y, p), [(upgrade.anchor[0] + 2) * 2, (upgrade.anchor[1] + 2.5) * 2, 24, 35, 30]);
        await page.waitForTimeout(1100);
        const file = `${OUT}/${kind}-upgrade-ring-${quality}.jpg`;
        await page.screenshot({ path: file, type: 'jpeg', quality: 80 });
        report.shots.push({ kind, id: 'upgrade', quality, file });
        if (quality === 'low') await setQuality(page, 'high');
      }
    } else report.errors.push(`${kind}: no affordable upgrade target`);
  }

  for (const quality of ['high', 'low']) {
    if (quality === 'low') await setQuality(page, 'low');
    await page.evaluate(() => window.__debug.camera(128, 128, 150, 30, 50));
    await page.waitForTimeout(2000);
    const file = `${OUT}/${kind}-overview-${quality}.jpg`;
    await page.screenshot({ path: file, type: 'jpeg', quality: 78 });
    const m = await page.evaluate(() => window.__debug.metrics());
    report.shots.push({ kind, id: 'overview', quality, file, drawCalls: m.drawCalls, triangles: m.triangles });
  }
  await context.close();
}
await browser.close();
await writeFile(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(`shots: ${report.shots.length}, errors: ${report.errors.length}`, report.errors.slice(0, 4));
