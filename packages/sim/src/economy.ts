import { CellFlag, GRID, Surface, cellIndex, type Cell, type Cost } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { footprintCells } from './footprint';
import { roadConnectivity, access } from './roads';
import { completeConstruction } from './construction';
import { addXp, guard } from './common';
import type { SimState } from './state';

export const costValue = (c: Cost): number => c.cash + c.wood * economy.materialPrices.wood + c.stone * economy.materialPrices.stone;
export const distance = (a: Cell[], b: Cell[]): number => Math.min(...a.flatMap(c => b.map(n => Math.max(Math.abs(c[0]-n[0]),Math.abs(c[1]-n[1])))));
export function populationAndJobs(s: SimState): {population: number; jobs: number} {
  let population = 0, jobs = 0;
  for (const b of s.snapshot.buildings) if (b.status === 'ACTIVE' && access(s,b)) {
    population += catalog.buildings[b.defId]?.population ?? 0; jobs += catalog.buildings[b.defId]?.jobs ?? 0;
  }
  return { population, jobs };
}
export function capHours(s: SimState): number {
  const banks = s.snapshot.buildings.filter(b => b.status === 'ACTIVE' && catalog.buildings[b.defId]?.bankCapHours && access(s,b)).length;
  return economy.income.capBaseH + economy.income.bankCapH * Math.min(economy.income.bankCapMax,banks);
}
export function recompute(s: SimState): void {
  s.connected = roadConnectivity(s); s.rates = {};
  const active = s.snapshot.buildings.filter(b => b.status === 'ACTIVE' && access(s,b));
  const {population,jobs} = populationAndJobs(s), work = jobs ? Math.min(1,population/jobs) : 1;
  const footprints = new Map(active.map(b => [b.id,footprintCells(catalog.buildings[b.defId]!,b.anchor,b.rotation)]));
  for (const b of s.snapshot.buildings) {
    const def = catalog.buildings[b.defId]; s.rates[b.id] = 0;
    if (!def?.baseRatePerHour || b.status !== 'ACTIVE' || !access(s,b)) continue;
    const cells = footprints.get(b.id)!;
    let decor = 0, water = false;
    for (const source of active) {
      const d = catalog.buildings[source.defId]!.decor;
      if (d && distance(cells,footprints.get(source.id)!) <= d.radius) decor += d.bonus;
    }
    for (const [x,z] of cells) {
      const r = economy.income.waterRadius;
      for (let nz = Math.max(0,z-r); nz <= Math.min(GRID-1,z+r); nz++) for (let nx = Math.max(0,x-r); nx <= Math.min(GRID-1,x+r); nx++) {
        if (s.flags[cellIndex(nx,nz)]! & CellFlag.EMBANKED) water = true;
      }
    }
    s.rates[b.id] = def.baseRatePerHour * (def.jobs ? work : 1)
      * (1 + Math.min(economy.income.decorCap,decor) + (water ? def.waterBonusOverride ?? economy.income.waterBonus : 0))
      * economy.roadTiers[access(s,b) as 1|2|3].multiplier;
  }
  s.snapshot.character.netWorth = netWorth(s);
}
export function settle(s: SimState, now: number): void {
  const cap = capHours(s), q = catalog.quests.city[s.snapshot.progress.questIndex];
  const tutorial = s.template.mapKind === 'city' && !s.snapshot.progress.tutorialDone && q?.tutorial && q.action === 'COLLECT';
  for (const b of s.snapshot.buildings) if (b.status === 'ACTIVE' && catalog.buildings[b.defId]?.baseRatePerHour) {
    const start = Math.max(b.settledAt ?? b.buildEndsAt,b.buildEndsAt);
    guard(now >= start,'INVALID_TIME');
    const rate = s.rates[b.id] ?? 0, hours = (now-start)/3_600_000;
    b.accrued = Math.min(rate * cap,(b.accrued ?? 0) + rate * hours * (tutorial ? economy.tutorial.cityIncomeMultiplier : 1));
    b.settledAt = now;
  }
}
export function advanceTime(s: SimState, now: number): void {
  guard(Number.isSafeInteger(now) && now >= s.snapshot.serverTime,'INVALID_TIME');
  recompute(s);
  const pending = [...s.snapshot.buildings,...s.snapshot.bridges]
    .filter(o => o.status === 'CONSTRUCTING' && o.buildEndsAt <= now)
    .sort((a,b) => a.buildEndsAt-b.buildEndsAt || a.id.localeCompare(b.id));
  for (const o of pending) {
    settle(s,o.buildEndsAt); completeConstruction(s,o); recompute(s);
  }
  settle(s,now);
  for (const b of s.snapshot.buildings) for (const queue of b.slots ?? []) for (const job of queue) {
    if (job.readyAt > s.snapshot.serverTime && job.readyAt <= now) addXp(s,catalog.recipes[job.recipeId]!.xp);
  }
  s.snapshot.serverTime = now; recompute(s);
}
export function netWorth(s: SimState): number {
  let total = costValue(s.snapshot.wallet) + s.snapshot.landValue;
  for (const b of s.snapshot.buildings) total += b.investedValue + Math.floor(b.accrued ?? 0);
  for (const b of s.snapshot.bridges) total += b.investedValue;
  // Starting natural roads are not purchased assets.
  for (let i = 0; i < s.surface.length; i++) {
    const tier = s.roadTier[i] as 0|1|2|3;
    if (tier && s.surface[i] === Surface.ROAD) {
      const original = s.baseRoadTier[i] as 0|1|2|3;
      total += costValue(economy.roadTiers[tier].cost) - (original ? costValue(economy.roadTiers[original].cost) : 0);
    }
    if (s.flags[i]! & CellFlag.EMBANKED) total += costValue(economy.embank.cost);
  }
  for (const [id,count] of Object.entries(s.snapshot.inventory)) total += count * (catalog.items[id]?.sellPrice ?? 0);
  return total;
}
