import { describe, expect, it } from 'vitest';
import { MAP_KINDS, hasCityFeatures, hasFarmFeatures, kindAllows, type CommandType } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { createTestTemplate, generateWorldTemplate, generateEnvironment } from '@xay-nha/worldgen';
import { OPEN_QUESTS, openQuests, tutorialActive } from './common';
import { recompute, populationAndJobs } from './economy';
import { authoredQuestProgressFor, execute } from './engine';
import { ensureRepeatQuests, maxReferenceIncome, referenceIncome, validateRepeat } from './quests';
import { createState, type SimState } from './state';
import { validateSnapshot } from './snapshot';
import { reliefAvailable } from './upgrades';

const NOW = 1_000_000_000;
let sequence = 0;
function run(s: SimState, type: CommandType, payload: unknown, now = NOW) {
  return execute(s, { commandId: `00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, '0')}`, worldId: s.snapshot.worldId,
    expectedRevision: s.snapshot.revision, clientTime: now, type, payload }, now);
}
function ok(s: SimState, type: CommandType, payload: unknown, now = NOW): SimState {
  const e = run(s, type, payload, now);
  expect(e.result.accepted, `${type} ${JSON.stringify(e.result)}`).toBe(true);
  return e.state;
}
const town = (): SimState => { const s = createState(createTestTemplate('town'), NOW); recompute(s); return s; };
const road = (x0: number, x1: number, y = 70) => Array.from({ length: x1 - x0 + 1 }, (_, n) => [x0 + n, y]);
const rich = (s: SimState): void => { s.snapshot.wallet = { cash: 500_000, wood: 500, stone: 500 }; s.snapshot.progress.level = economy.xp.maxLevel; s.snapshot.progress.xp = economy.xp.cumulative.town[economy.xp.maxLevel]!; };

describe('town map kind: helpers', () => {
  it('town has city and farm features, city only the former, farm only the latter', () => {
    expect(MAP_KINDS).toEqual(['city', 'farm', 'town']);
    expect([hasCityFeatures('city'), hasCityFeatures('farm'), hasCityFeatures('town')]).toEqual([true, false, true]);
    expect([hasFarmFeatures('city'), hasFarmFeatures('farm'), hasFarmFeatures('town')]).toEqual([false, true, true]);
  });
  it('every catalog building, bridge and road tier is available on town without a per-id list', () => {
    for (const def of Object.values(catalog.buildings)) expect(kindAllows(def.mapKinds, 'town'), def.id).toBe(true);
    for (const def of Object.values(catalog.bridges)) expect(kindAllows(def.mapKinds, 'town'), def.id).toBe(true);
    for (const tier of Object.values(economy.roadTiers)) expect(kindAllows(tier.mapKinds, 'town')).toBe(true);
    // city/farm keep their own tags
    expect(kindAllows(catalog.buildings.house_small!.mapKinds, 'farm')).toBe(false);
    expect(kindAllows(catalog.buildings.farmhouse!.mapKinds, 'city')).toBe(false);
  });
  it('an unknown landmark tagged city-only (e.g. landmark_rome) is also placeable on town', () => {
    expect(kindAllows(['city'], 'town')).toBe(true);
    expect(kindAllows(['farm'], 'town')).toBe(true);
  });
});

describe('town map kind: sim', () => {
  it('accepts city and farm actions and never answers WRONG_MAP', () => {
    let s = town(); rich(s);
    s.snapshot.progress.tutorialDone = true;
    s.snapshot.progress.claimedQuests = catalog.quests.town.map(q => q.id); s.snapshot.progress.questIndex = catalog.quests.town.length;
    s = ok(s, 'BUILD_ROAD', { tier: 1, cells: road(49, 58) });
    s = ok(s, 'PLACE_BUILDING', { defId: 'house_small', anchor: [49, 68], rotation: 0 });
    s = ok(s, 'PLACE_BUILDING', { defId: 'shop_grocery', anchor: [51, 68], rotation: 0 });
    s = ok(s, 'PLACE_BUILDING', { defId: 'farmhouse', anchor: [53, 67], rotation: 0 });
    s = ok(s, 'PLACE_BUILDING', { defId: 'market', anchor: [56, 67], rotation: 0 });
    // Every kind-specific command: hours later the buildings are done and income has accrued.
    const later = NOW + 3 * 3_600_000;
    s = ok(s, 'COLLECT', { buildingIds: [] }, later);
    expect(s.snapshot.wallet.cash).toBeGreaterThan(0);
    s = ok(s, 'TILL', { rect: [49, 62, 54, 62] }, later);
    s = ok(s, 'PLANT', { rect: [49, 62, 54, 62], cropId: 'veg_greens' }, later);
    const ready = Math.max(...s.snapshot.crops.map(c => c.readyAt));
    s = ok(s, 'HARVEST', { cells: Array.from({ length: 6 }, (_, n) => [49 + n, 62]) }, ready);
    const sold = s.snapshot.inventory.veg_greens ?? 0;
    expect(sold).toBeGreaterThan(0);
    s = ok(s, 'SELL', { items: { veg_greens: sold } }, ready);
    // Mixed state still validates and roundtrips.
    const checked = validateSnapshot(createState(createTestTemplate('town'), NOW), JSON.parse(JSON.stringify(s.snapshot)), ready);
    expect(checked.ok, JSON.stringify(checked)).toBe(true);
  });
  it('city and farm still reject the other map\'s actions (WRONG_MAP)', () => {
    const farm = createState(createTestTemplate('farm'), NOW); recompute(farm); rich(farm);
    const e = run(farm, 'COLLECT', { buildingIds: [] });
    expect(e.result.accepted).toBe(false);
    if (!e.result.accepted) expect(e.result.code).toBe('WRONG_MAP');
    const city = createState(createTestTemplate('city'), NOW); recompute(city); rich(city);
    const t = run(city, 'TILL', { rect: [60, 60, 61, 60] });
    expect(t.result.accepted).toBe(false);
    if (!t.result.accepted) expect(t.result.code).toBe('WRONG_MAP');
  });
  it('uses the city XP table and the wider road/bridge sets', () => {
    expect(economy.xp.cumulative.town).toEqual(economy.xp.cumulative.city);
    const s = town(); rich(s);
    expect(ok(s, 'BUILD_ROAD', { tier: 3, cells: road(49, 52) }).roadTier[70 * 128 + 49]).toBe(3);
  });
  it('tutorial: instant farmhouse/house and 20 s greens while their quests are open', () => {
    let s = town();
    expect(tutorialActive(s)).toBe(true);
    expect(openQuests(s).map(q => q.id)).toContain('town-5');
    s = ok(s, 'BUILD_ROAD', { tier: 1, cells: road(49, 54) });
    s = ok(s, 'PLACE_BUILDING', { defId: 'farmhouse', anchor: [53, 67], rotation: 0 });
    expect(s.snapshot.buildings.every(b => b.status === 'ACTIVE')).toBe(true);
    s = ok(s, 'TILL', { rect: [49, 62, 54, 62] });
    s = ok(s, 'PLANT', { rect: [49, 62, 54, 62], cropId: 'veg_greens' });
    expect(s.snapshot.crops[0]!.readyAt - NOW).toBe(economy.tutorial.farmGrowSeconds * 1000);
  });
  it('relief is offered only when neither the city nor the farm side earns', () => {
    const s = town(); s.snapshot.wallet.cash = 0;
    expect(reliefAvailable(s, NOW)).toBe(true);
    s.snapshot.crops.push({ cell: [60, 60], cropId: 'veg_greens', plantedAt: NOW, readyAt: NOW + 1000 });
    expect(reliefAvailable(s, NOW)).toBe(false);
  });
});

describe('town quest chain', () => {
  const chain = catalog.quests.town;
  it('has 14 authored quests, the first 6 are tutorial, ids town-N', () => {
    expect(chain.length).toBeGreaterThanOrEqual(12); expect(chain.length).toBeLessThanOrEqual(14);
    expect(chain.map(q => q.tutorial)).toEqual(chain.map((_, i) => i < 6));
    expect(chain.map(q => q.id)).toEqual(chain.map((_, i) => `town-${i + 1}`));
    const actions = new Set(chain.map(q => q.action));
    for (const a of ['CLEAR', 'ROAD', 'BUILD', 'TILL', 'PLANT', 'HARVEST', 'COLLECT', 'SELL', 'POPULATION']) expect(actions.has(a), a).toBe(true);
    expect(chain.every(q => q.reward.cash > 0)).toBe(true);
  });
  it('keeps 5 quests open and claims them out of order', () => {
    let s = town();
    expect(openQuests(s).map(q => q.id)).toEqual(chain.slice(0, OPEN_QUESTS).map(q => q.id));
    s = ok(s, 'BUILD_ROAD', { tier: 1, cells: road(49, 54) });
    s = ok(s, 'PLACE_BUILDING', { defId: 'farmhouse', anchor: [53, 67], rotation: 0 });
    // town-3 (farmhouse) and town-2 (road) first, then town-6 (house, opened by the claims, so it builds instantly), before town-1.
    for (const id of ['town-3', 'town-2']) s = ok(s, 'CLAIM_QUEST', { questId: id });
    s = ok(s, 'PLACE_BUILDING', { defId: 'house_small', anchor: [49, 68], rotation: 0 });
    s = ok(s, 'CLAIM_QUEST', { questId: 'town-6' });
    expect(s.snapshot.progress.claimedQuests).toEqual(['town-3', 'town-2', 'town-6']);
    expect(openQuests(s).map(q => q.id)).toEqual(['town-1', 'town-4', 'town-5', 'town-7', 'town-8']);
    const early = run(s, 'CLAIM_QUEST', { questId: 'town-1' });
    expect(early.result.accepted).toBe(false);
    expect(authoredQuestProgressFor(s, 'town-1')).toBe(0);
  });
  it('repeat quests draw from the union of city and farm templates', () => {
    const s = town(); rich(s);
    s.snapshot.progress.claimedQuests = chain.map(q => q.id); s.snapshot.progress.questIndex = chain.length; s.snapshot.progress.tutorialDone = true;
    let t = ok(s, 'BUILD_ROAD', { tier: 1, cells: road(49, 54) });
    t = ok(t, 'PLACE_BUILDING', { defId: 'house_small', anchor: [49, 68], rotation: 0 });
    t = ok(t, 'PLACE_BUILDING', { defId: 'shop_grocery', anchor: [51, 68], rotation: 0 });
    t = ok(t, 'PLACE_BUILDING', { defId: 'farmhouse', anchor: [53, 67], rotation: 0 });
    t = ok(t, 'COLLECT', { buildingIds: [] }, NOW + 4 * 3_600_000);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      t.snapshot.progress.repeat = { seq: i * 10, rerollAt: 0, active: [] }; delete t.snapshot.progress.repeat.last;
      ensureRepeatQuests(t);
      for (const q of t.snapshot.progress.repeat.active) seen.add(q.template);
      t.snapshot.worldId = `w${i}`;
    }
    const city = ['collect_cash', 'build_type', 'road_cells', 'embank_cells', 'population'], farm = ['harvest_crop', 'sell_item', 'produce_item', 'till_cells'];
    expect([...seen].some(x => city.includes(x))).toBe(true);
    expect([...seen].some(x => farm.includes(x))).toBe(true);
    expect(validateRepeat(t.snapshot)).toEqual([]);
    expect(referenceIncome(t)).toBeLessThanOrEqual(maxReferenceIncome('town', t.snapshot.progress.level));
    expect(populationAndJobs(t).population).toBeGreaterThan(0);
  });
});

describe('town on a generated map', () => {
  it('createState + snapshot validation on a random town template', () => {
    const { template } = generateWorldTemplate('town', 424242);
    expect(template.mapKind).toBe('town'); expect(template.mapId).toBe('rnd-town-424242');
    const s = createState(template, NOW, generateEnvironment(template)); recompute(s);
    const checked = validateSnapshot(createState(template, NOW, generateEnvironment(template)), JSON.parse(JSON.stringify(s.snapshot)), NOW);
    expect(checked.ok, JSON.stringify(checked)).toBe(true);
  });
});
