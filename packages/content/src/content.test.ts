import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CatalogSchema, catalog, contentVersion, economy, quests, vi } from './index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const document = readFileSync(new URL('../../../docs/16_ECONOMY_AND_BALANCE.md', import.meta.url), 'utf8');
function docRows(sectionStart: string, sectionEnd: string): string[][] {
  const start = document.indexOf(sectionStart);
  const end = document.indexOf(sectionEnd, start + sectionStart.length);
  if (start < 0 || end < 0) throw new Error(`Missing source section ${sectionStart}`);
  return document.slice(start, end).split('\n')
    .filter(line => line.startsWith('|') && !line.includes('---'))
    .map(line => line.split('|').slice(1, -1).map(cell => cell.trim().replaceAll('`', '').replaceAll('**', '')));
}
const num = (value: string) => Number(value.replaceAll(' ', ''));
const cityRows = docRows('### 6.1', '### 6.2').filter(row => catalog.buildings[row[0] ?? '']);
const cropRows = docRows('### 7.1', '### 7.2').filter(row => catalog.crops[row[0] ?? '']);
const producerRows = docRows('### 7.2', '### 7.3').filter(row => catalog.recipes[row[0] ?? '']);

describe('docs/16 generated economy content', () => {
  it('regenerates deterministically and passes check mode', () => {
    expect(execFileSync(process.execPath, ['scripts/generate-content.mjs', '--check'], { cwd: root, encoding: 'utf8' }))
      .toContain('Verified 4 content files');
  });
  it('rejects malformed generated content before consumers receive it', () => {
    const invalid = structuredClone(catalog);
    const house = invalid.buildings.house_small;
    if (!house) throw new Error('Missing documented house');
    house.cost.cash = -1;
    expect(CatalogSchema.safeParse(invalid).success).toBe(false);
    house.cost.cash = catalog.buildings.house_small?.cost.cash ?? 0;
    house.id = 'wrong_id';
    expect(CatalogSchema.safeParse(invalid).success).toBe(false);
  });
  it('contains all catalog balance tables in the economy artifact', () => {
    expect(economy.catalog).toEqual(catalog);
    expect(contentVersion).toBe(3); // D025, D028
    expect(catalog.contentVersion).toBe(contentVersion);
  });
  it.each(cityRows)('matches city table %s', (id, _name, size, cash, wood, stone, _value, level, population, jobs, rate) => {
    const def = catalog.buildings[id ?? ''];
    expect(def).toBeDefined();
    expect(def?.size).toEqual(size?.split('×').map(Number));
    expect(def?.cost).toEqual({ cash: num(cash ?? ''), wood: num(wood ?? ''), stone: num(stone ?? '') });
    expect(def?.unlockLevel).toBe(num(level ?? ''));
    if (population !== '—') expect(def?.population).toBe(num(population ?? ''));
    if (jobs !== '—') expect(def?.jobs).toBe(num(jobs ?? ''));
    if (rate !== '—' && !rate?.includes('bán kính')) expect(def?.baseRatePerHour).toBe(num(rate ?? ''));
  });
  it('configures deco_streetlight on both maps without decor bonus', () => {
    const def = catalog.buildings.deco_streetlight;
    expect(def).toBeDefined();
    expect(def?.mapKinds).toEqual(['city', 'farm']);
    expect(def?.unlockLevel).toBe(2);
    expect(def?.cost).toEqual({ cash: 150, wood: 0, stone: 2 });
    expect(def?.limit).toEqual([6, 3, 80]);
    expect(def?.decor).toBeUndefined();
    expect(def?.size).toEqual([1, 1]);
    expect(def?.buildSeconds).toBe(15);
  });
  it('configures D037 iconic landmarks with correct costs, limits, decor effects and maps', () => {
    const culture = catalog.buildings.landmark_culture;
    expect(culture).toBeDefined();
    expect(culture?.mapKinds).toEqual(['city']);
    expect(culture?.cost).toEqual({ cash: 30000, wood: 40, stone: 80 });
    expect(culture?.unlockLevel).toBe(10);
    expect(culture?.size).toEqual([7, 6]);
    expect(culture?.buildSeconds).toBe(7200);
    expect(culture?.limit).toEqual([1, 0, 1]);
    expect(culture?.decor).toEqual({ bonus: 0.10, radius: 10 });
    expect(vi[culture!.nameKey]).toBe('Nhà văn hóa');

    const palace = catalog.buildings.landmark_palace;
    expect(palace).toBeDefined();
    expect(palace?.mapKinds).toEqual(['city']);
    expect(palace?.cost).toEqual({ cash: 60000, wood: 60, stone: 120 });
    expect(palace?.unlockLevel).toBe(14);
    expect(palace?.size).toEqual([5, 5]);
    expect(palace?.buildSeconds).toBe(10800);
    expect(palace?.limit).toEqual([1, 0, 1]);
    expect(palace?.decor).toEqual({ bonus: 0.15, radius: 12 });
    expect(vi[palace!.nameKey]).toBe('Cung điện');

    const castle = catalog.buildings.landmark_castle;
    expect(castle).toBeDefined();
    expect(castle?.mapKinds).toEqual(['city']);
    expect(castle?.cost).toEqual({ cash: 90000, wood: 80, stone: 150 });
    expect(castle?.unlockLevel).toBe(16);
    expect(castle?.size).toEqual([8, 4]);
    expect(castle?.buildSeconds).toBe(14400);
    expect(castle?.limit).toEqual([1, 0, 1]);
    expect(castle?.decor).toEqual({ bonus: 0.15, radius: 12 });
    expect(vi[castle!.nameKey]).toBe('Lâu đài');

    // D038: the Citadel (farm) was removed: its voxel model did not survive simplification.
    expect(catalog.buildings.landmark_citadel).toBeUndefined();
  });
  it.each(cropRows)('matches crop table %s', (id, _name, level, seed, _time, yieldCount, price, _profit, _perHour, xp) => {
    const def = catalog.crops[id ?? ''];
    expect(def?.unlockLevel).toBe(num(level ?? ''));
    expect(def?.seedCost).toBe(num(seed ?? ''));
    expect(def?.yield).toBe(num(yieldCount ?? ''));
    expect(def?.xp).toBe(num(xp ?? ''));
    expect(catalog.items[id ?? '']?.sellPrice).toBe(num(price ?? ''));
  });
  it.each(producerRows)('matches producer table %s', (id, _name, level, size, cash, wood, stone, _value, slots, _time, _input, _output, price, _profit, _payback, _build, xp) => {
    const def = catalog.buildings[id ?? ''];
    const recipe = catalog.recipes[id ?? ''];
    expect(def?.cost).toEqual({ cash: num(cash ?? ''), wood: num(wood ?? ''), stone: num(stone ?? '') });
    expect(def?.size).toEqual(size?.split('×').map(Number));
    expect(def?.unlockLevel).toBe(num(level ?? ''));
    expect(def?.production?.slots).toBe(num(slots ?? ''));
    expect(def?.production?.queueLimit).toBe(economy.farm.productionQueueLimit);
    expect(recipe?.xp).toBe(num(xp ?? ''));
    expect(catalog.items[recipe?.output ?? '']?.sellPrice).toBe(num(price ?? ''));
  });
  it('uses docs/16 construction 50% speedup and exact fractional bank limit', () => {
    expect(economy.construction.speedupPct).toBe(0.5);
    expect(catalog.buildings.bank?.limit).toEqual([1, 1 / 3, 4]);
  });
  it('keeps the distinct city and farm XP tables through level 20', () => {
    expect(economy.xp.cumulative.city).toHaveLength(economy.xp.maxLevel + 1);
    expect(economy.xp.cumulative.farm).toHaveLength(economy.xp.maxLevel + 1);
    expect(economy.xp.cumulative.city[20]).toBe(430000);
    expect(economy.xp.cumulative.farm[20]).toBe(107100); // D025
    for (const table of Object.values(economy.xp.cumulative)) {
      for (let level = 2; level <= economy.xp.maxLevel; level++) {
        expect(table[level]).toBeGreaterThan(table[level - 1] ?? 0);
      }
    }
  });
  it('ships every named starter quest and the approved repeat-quest constants (docs/16 §10.3, D024)', () => {
    expect(quests.city).toHaveLength(12);
    expect(quests.farm).toHaveLength(12);
    expect(economy.repeatQuests).toMatchObject({ defined: true, slots: 3, rerollHours: 4, rewardShare: 0.25, rewardRound: 10, rewardMin: 100, farmIncomeFactor: 0.5, xpMultiplier: 2 });
    expect(quests.city[9]?.reward).toEqual({ cash: 300, wood: 0, stone: 10 });
    expect(quests.city[0]?.xp).toBe(20);
    expect(quests.farm[2]?.xp).toBe(10);
    const all = [...quests.city, ...quests.farm];
    expect(new Set(all.map(quest => quest.id)).size).toBe(all.length);
  });
  it('resolves all catalog names and all production references', () => {
    for (const definition of [...Object.values(catalog.buildings), ...Object.values(catalog.crops), ...Object.values(catalog.items), ...quests.city, ...quests.farm]) {
      expect(vi[definition.nameKey]).toBeTruthy();
    }
    for (const def of Object.values(catalog.buildings)) {
      for (const id of def.production?.recipes ?? []) expect(catalog.recipes[id]).toBeDefined();
    }
    for (const recipe of Object.values(catalog.recipes)) {
      expect(catalog.items[recipe.output]).toBeDefined();
      for (const id of Object.keys(recipe.inputs)) expect(catalog.items[id]).toBeDefined();
    }
  });
  it('limits farmhouse cost scaling to the ten documented purchases', () => {
    const def = catalog.buildings.farmhouse;
    expect(def?.costScaling).toHaveLength(def?.maxCount ?? 0);
    expect(def?.unlockLevels).toHaveLength(def?.maxCount ?? 0);
    expect(def?.fieldQuota).toBe(24);
    expect(def?.costScaling?.at(-1)).toBe(130000);
    expect(def?.unlockLevels?.at(-1)).toBe(19);
  });
  it('has only the documented maps and concrete bridge is city-only', () => {
    for (const def of [...Object.values(catalog.buildings), ...Object.values(catalog.bridges)]) {
      expect(def.mapKinds.every(kind => kind === 'city' || kind === 'farm')).toBe(true);
    }
    expect(catalog.bridges.bridge_concrete?.mapKinds).toEqual(['city']);
  });
});
