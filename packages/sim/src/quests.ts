import { GRID, type BuildingDef, type Cost, type MapKind, type RepeatQuest, type WorldSnapshot } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { addXp, claimedQuestIds, guard, refund, zeroCost } from './common';
import { buildingLimit } from './construction';
import { populationAndJobs } from './economy';
import { fieldQuota } from './farm';
import type { SimState } from './state';

/**
 * docs/16 §10.3 repeat quests (D017 constants, D024 target sizing). Deterministic: a world-seeded PRNG
 * advanced by `repeat.seq`, so client and server generate identical quests.
 */
const R = economy.repeatQuests;
type Template = RepeatQuest['template'];
const CITY: Template[] = ['collect_cash', 'build_type', 'road_cells', 'embank_cells', 'population'];
const FARM: Template[] = ['harvest_crop', 'sell_item', 'produce_item', 'till_cells'];

function prng(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  return () => { h = (h + 0x6d2b79f5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const between = (rnd: () => number, [a, b]: readonly number[]): number => a! + Math.floor(rnd() * (b! - a! + 1));
const roundTo = (v: number, step: number) => Math.round(v / step) * step;

/** Reference income for one hour (docs/16 §10.3). */
export function referenceIncome(s: SimState): number {
  if (s.template.mapKind === 'city') return Object.values(s.rates).reduce((sum, r) => sum + r, 0);
  return fieldQuota(s) * bestCropRate(s.snapshot.progress.level) * R.farmIncomeFactor;
}
export function rewardFor(ref: number): { reward: Cost; xp: number } {
  const cash = Math.max(R.rewardMin, roundTo(ref * R.rewardShare, R.rewardRound));
  return { reward: { cash, wood: 0, stone: 0 }, xp: Math.round(R.xpMultiplier * Math.sqrt(cash)) };
}
function reward(s: SimState): { reward: Cost; xp: number; ref: number } {
  const ref = Math.round(referenceIncome(s));
  return { ...rewardFor(ref), ref };
}
const bestCropRate = (level: number) => Math.max(0, ...Object.values(catalog.crops).filter(c => c.unlockLevel <= level)
  .map(c => ((catalog.items[c.itemId]?.sellPrice ?? 0) * c.yield - c.seedCost) / (c.growSeconds / 3600)));
const countAt = (def: BuildingDef, level: number): number => {
  if (def.unlockLevel > level) return 0;
  if (!def.limit) return def.maxCount ?? Math.floor(GRID * GRID / (def.size[0] * def.size[1]));
  const [base, step, cap] = def.limit;
  return Math.min(cap, Math.floor(base + step * Math.max(0, level - def.unlockLevel)));
};
/** Upper bound on the reference income reachable at `level`; rejects forged repeat rewards. */
export function maxReferenceIncome(mapKind: MapKind, level: number): number {
  const tier = Math.max(...Object.values(economy.roadTiers).map(t => t.multiplier));
  if (mapKind === 'farm') return Object.values(catalog.buildings).reduce((n, d) => n + (d.fieldQuota ?? 0) * countAt(d, level), 0)
    * bestCropRate(level) * R.farmIncomeFactor;
  return Object.values(catalog.buildings).filter(d => d.mapKinds.includes('city') && d.baseRatePerHour)
    .reduce((n, d) => n + d.baseRatePerHour! * countAt(d, level) * tier
      * (1 + economy.income.decorCap + (d.waterBonusOverride ?? economy.income.waterBonus)), 0);
}

/** Builds one quest for `template`, or null when it has no unlocked target right now. */
function build(s: SimState, template: Template, rnd: () => number): Omit<RepeatQuest, 'id' | 'progress' | 'reward' | 'xp'> | null {
  const level = s.snapshot.progress.level, z = R.sizing;
  switch (template) {
    case 'collect_cash': {
      // X = one hour of current base income in whole dollars (docs/16 §10.3); $10 rounding is for rewards only.
      const hour = Math.round(referenceIncome(s));
      return hour >= 100 ? { template, target: hour } : null;
    }
    case 'build_type': {
      const options = Object.values(catalog.buildings).filter(d => d.mapKinds.includes(s.template.mapKind) && d.unlockLevel <= level
        && s.snapshot.buildings.filter(b => b.defId === d.id).length < buildingLimit(s, d));
      if (!options.length) return null;
      const def = options[Math.floor(rnd() * options.length)]!;
      const room = buildingLimit(s, def) - s.snapshot.buildings.filter(b => b.defId === def.id).length;
      return { template, subject: def.id, target: Math.max(1, Math.min(room, between(rnd, z.buildCount))) };
    }
    case 'road_cells': return { template, target: between(rnd, z.roadCells) };
    case 'embank_cells': return level >= (economy.embank.unlockLevel) ? { template, target: between(rnd, z.embankCells) } : null;
    case 'population': {
      if (!Object.values(catalog.buildings).some(d => d.mapKinds.includes('city') && d.population && d.unlockLevel <= level)) return null;
      return { template, target: roundTo(populationAndJobs(s).population + between(rnd, z.populationStep), 5) };
    }
    case 'harvest_crop': {
      const quota = fieldQuota(s);
      const crops = Object.values(catalog.crops).filter(c => c.unlockLevel <= level && c.growSeconds <= z.harvestMaxGrowMinutes * 60);
      if (!crops.length || quota < 1) return null;
      const crop = crops[Math.floor(rnd() * crops.length)]!;
      const share = z.harvestQuotaShare[0]! + rnd() * (z.harvestQuotaShare[1]! - z.harvestQuotaShare[0]!);
      return { template, subject: crop.id, target: Math.max(4, Math.round(quota * share)) };
    }
    case 'sell_item': {
      const crops = Object.values(catalog.crops).filter(c => c.unlockLevel <= level);
      if (!crops.length) return null;
      const crop = crops[Math.floor(rnd() * crops.length)]!;
      return { template, subject: crop.itemId, target: between(rnd, z.sellUnits) };
    }
    case 'produce_item': {
      const owned = [...new Set(s.snapshot.buildings.filter(b => b.status === 'ACTIVE' && catalog.buildings[b.defId]?.production).map(b => b.defId))];
      if (!owned.length) return null;
      return { template, subject: owned[Math.floor(rnd() * owned.length)]!, target: between(rnd, z.produceUnits) };
    }
    case 'till_cells': {
      const room = fieldQuota(s) - s.surface.reduce((n, v) => n + Number(v === 4 /* Surface.TILLED */), 0);
      return room >= z.tillCells[0]! ? { template, target: Math.min(room, between(rnd, z.tillCells)) } : null;
    }
  }
}

function next(s: SimState): RepeatQuest | null {
  const r = s.snapshot.progress.repeat!;
  const rnd = prng(`${s.snapshot.worldId}:repeat:${r.seq}`);
  const all = s.template.mapKind === 'city' ? CITY : FARM;
  const same = (q: { template: Template; subject?: string }) => r.active.some(a => a.template === q.template && a.subject === q.subject);
  // Never the template just claimed/rerolled (docs/16 §10.3); active quests may share a template with different
  // targets. Only when nothing else is eligible is the previous template reused (D024, Q009).
  for (const pool of [all.filter(t => t !== r.last), all]) {
    const order = pool.map(t => ({ t, k: rnd() })).sort((a, b) => a.k - b.k).map(x => x.t);
    for (const template of order) for (let attempt = 0; attempt < 3; attempt++) {
      const quest = build(s, template, rnd);
      if (!quest || same(quest)) continue;
      const id = `r${r.seq}`; r.seq++;
      return { id, ...quest, progress: 0, ...reward(s) };
    }
  }
  return null;
}

/** Fills the active list up to the configured slot count once the authored quests are done. */
export function ensureRepeatQuests(s: SimState): void {
  const p = s.snapshot.progress;
  if (claimedQuestIds(s).length < catalog.quests[s.template.mapKind].length) return;
  p.repeat ??= { seq: 0, rerollAt: 0, active: [] };
  while (p.repeat.active.length < R.slots) { const q = next(s); if (!q) break; p.repeat.active.push(q); }
}

export function repeatQuestProgress(s: SimState, q: RepeatQuest): number {
  return q.template === 'population' ? Math.min(q.target, populationAndJobs(s).population) : q.progress;
}

export function claimRepeat(s: SimState, questId: string): Cost | undefined {
  const r = s.snapshot.progress.repeat, index = r?.active.findIndex(q => q.id === questId) ?? -1;
  if (!r || index < 0) return undefined;
  const q = r.active[index]!;
  guard(repeatQuestProgress(s, q) >= q.target, 'QUEST_NOT_READY');
  refund(s, q.reward); addXp(s, q.xp); r.active.splice(index, 1); r.last = q.template;
  ensureRepeatQuests(s);
  return zeroCost();
}

export function rerollRepeat(s: SimState, questId: string, now: number): Cost {
  const r = s.snapshot.progress.repeat, index = r?.active.findIndex(q => q.id === questId) ?? -1;
  guard(r && index >= 0, 'NOT_FOUND');
  guard(now >= r.rerollAt, 'QUEST_NOT_READY');
  r.last = r.active[index]!.template; r.active.splice(index, 1); r.rerollAt = now + R.rerollHours * 3_600_000;
  ensureRepeatQuests(s);
  return zeroCost();
}

/** Semantic checks for persisted repeat quests, used by validateSnapshot (G3 repeat audit, finding 1). */
export function validateRepeat(snapshot: WorldSnapshot): string[] {
  const r = snapshot.progress.repeat, errors: string[] = [];
  if (!r) return errors;
  const kind = snapshot.mapKind, level = snapshot.progress.level, templates = kind === 'city' ? CITY : FARM;
  if ((snapshot.progress.claimedQuests?.length ?? snapshot.progress.questIndex) < catalog.quests[kind].length) errors.push('REPEAT:BEFORE_AUTHORED_DONE');
  if (r.active.length > R.slots) errors.push('REPEAT:TOO_MANY');
  if (r.rerollAt > snapshot.serverTime + R.rerollHours * 3_600_000 + 300_000) errors.push('REPEAT:REROLL_TIME');
  if (r.last !== undefined && !templates.includes(r.last as Template)) errors.push('REPEAT:LAST');
  const maxRef = maxReferenceIncome(kind, level), seen = new Set<string>();
  const unlocked = (u: number | undefined) => u !== undefined && u <= level;
  for (const q of r.active) {
    const label = `REPEAT:${q.id}`, n = /^r(\d+)$/.exec(q.id);
    if (!n || Number(n[1]) >= r.seq) errors.push(`${label}:ID`);
    if (seen.has(q.id)) errors.push(`${label}:DUPLICATE`);
    seen.add(q.id);
    if (!templates.includes(q.template)) errors.push(`${label}:TEMPLATE`);
    if (q.progress > q.target) errors.push(`${label}:PROGRESS`);
    if (q.ref !== undefined && q.ref > Math.ceil(maxRef)) errors.push(`${label}:REF`);
    const expected = rewardFor(q.ref ?? maxRef).reward.cash;
    if (q.reward.wood || q.reward.stone || (q.ref !== undefined ? q.reward.cash !== expected : q.reward.cash > expected)
      || q.reward.cash < R.rewardMin) errors.push(`${label}:REWARD`);
    if (q.xp !== Math.round(R.xpMultiplier * Math.sqrt(q.reward.cash))) errors.push(`${label}:XP`);
    let subjectOk = q.subject === undefined;
    if (q.template === 'build_type' || q.template === 'produce_item') {
      const d = q.subject ? catalog.buildings[q.subject] : undefined;
      subjectOk = !!d && d.mapKinds.includes(kind) && unlocked(d.unlockLevel) && (q.template === 'build_type' || !!d.production);
    } else if (q.template === 'harvest_crop') subjectOk = unlocked(q.subject ? catalog.crops[q.subject]?.unlockLevel : undefined);
    else if (q.template === 'sell_item') subjectOk = Object.values(catalog.crops).some(c => c.itemId === q.subject && unlocked(c.unlockLevel));
    if (!subjectOk) errors.push(`${label}:SUBJECT`);
  }
  return errors;
}
