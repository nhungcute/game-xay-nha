import type { BuildingDef, Command, Cost, PlacedBuilding } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { addXp, guard, lookup, pay, refund, requireLevel, zeroCost } from './common';
import type { SimState } from './state';

/** D028 / docs/16 §6.5: building tiers 2–3, the late-game money sink. */
type Tier = 2 | 3;
const costValue = (c: Cost): number => c.cash + c.wood * economy.materialPrices.wood + c.stone * economy.materialPrices.stone;

export function tierDef(tier: Tier) { return economy.upgrades.tiers.find(row => row.tier === tier)!; }
export const currentTier = (b: PlacedBuilding): 1 | Tier => b.tier ?? 1;

/** Businesses, housing, producers and storage can be upgraded; decorations, banks' cap bonus and fields do not scale. */
export function upgradeable(def: BuildingDef | undefined): boolean {
  return Boolean(def && (def.baseRatePerHour || def.population || def.production || def.storageBonus));
}
export function upgradeCost(def: BuildingDef, tier: Tier): Cost {
  const m = tierDef(tier).costMultiplier;
  return { cash: Math.round(def.cost.cash * m), wood: Math.round(def.cost.wood * m), stone: Math.round(def.cost.stone * m) };
}
export const upgradeSeconds = (def: BuildingDef, tier: Tier): number => Math.round(def.buildSeconds * tierDef(tier).secondsMultiplier);
/** Multiplier on income and population from completed tiers. */
export const tierMultiplier = (b: PlacedBuilding): number => 1 + (b.tier ? tierDef(b.tier).effect : 0);
/** Production lines: the catalog count plus one per completed tier. */
export const slotCount = (b: PlacedBuilding, def: BuildingDef): number => (def.production?.slots ?? 0) + currentTier(b) - 1;
/** Cash value of completed tiers plus an upgrade in progress (both count toward net worth and demolition refunds). */
export function upgradeValue(b: PlacedBuilding): Cost {
  const def = lookup(catalog.buildings, b.defId), total = zeroCost();
  if (!def) return total;
  for (let tier = 2; tier <= currentTier(b); tier++) {
    const cost = upgradeCost(def, tier as Tier);
    total.cash += cost.cash; total.wood += cost.wood; total.stone += cost.stone;
  }
  return total;
}
export const upgradeWorth = (b: PlacedBuilding): number => {
  const def = lookup(catalog.buildings, b.defId);
  return costValue(upgradeValue(b)) + (b.upgrade && def ? costValue(upgradeCost(def, b.upgrade.tier)) : 0);
};

/** The caller settles income at `upgrade.endsAt` before invoking this, so the new rate only counts afterwards. */
export function completeUpgrade(s: SimState, b: PlacedBuilding): void {
  const upgrade = b.upgrade, def = lookup(catalog.buildings, b.defId);
  if (!upgrade || !def) return;
  b.tier = upgrade.tier; delete b.upgrade;
  if (def.production) b.slots = [...(b.slots ?? []), ...Array.from({ length: slotCount(b, def) - (b.slots?.length ?? 0) }, () => [])];
  addXp(s, Math.round(economy.xp.buildMultiplier * Math.sqrt(costValue(upgradeCost(def, upgrade.tier)))));
}

export function upgrades(s: SimState, cmd: Command, now: number, requireBuilder: (s: SimState) => void): Cost | undefined {
  if (cmd.type !== 'UPGRADE_BUILDING') return undefined;
  const b = s.snapshot.buildings.find(building => building.id === cmd.payload.buildingId);
  guard(b, 'BUILDING_NOT_FOUND');
  const def = catalog.buildings[b.defId]!;
  guard(b.status === 'ACTIVE' && !b.upgrade, 'UNDER_CONSTRUCTION');
  guard(upgradeable(def) && currentTier(b) < economy.upgrades.maxTier, 'NOT_UPGRADEABLE');
  const tier = (currentTier(b) + 1) as Tier;
  requireLevel(s, tierDef(tier).unlockLevel);
  const cost = upgradeCost(def, tier);
  pay(s, cost);
  requireBuilder(s);
  b.upgrade = { tier, startedAt: now, endsAt: now + upgradeSeconds(def, tier) * 1000 };
  return cost;
}

/** CANCEL_CONSTRUCTION / SPEED_UP on an upgrading building (the building itself stays ACTIVE). */
export function cancelOrSpeedUpgrade(s: SimState, b: PlacedBuilding, speedUp: boolean, now: number): Cost {
  const upgrade = b.upgrade!, cost = upgradeCost(catalog.buildings[b.defId]!, upgrade.tier);
  if (!speedUp) { refund(s, cost, economy.construction.cancelRefund); delete b.upgrade; return zeroCost(); }
  const price = { ...zeroCost(), cash: Math.max(economy.construction.speedupMinimumCash,
    Math.ceil(economy.construction.speedupPct * cost.cash * (upgrade.endsAt - now) / (upgrade.endsAt - upgrade.startedAt))) };
  pay(s, price);
  completeUpgrade(s, b);
  return price;
}

/** docs/16 §9.1: a stuck player — little cash and nothing that will earn — may claim relief once per cooldown. */
export function reliefAvailable(s: SimState, now: number): boolean {
  const snap = s.snapshot, relief = economy.relief;
  if (snap.wallet.cash >= relief.cashBelow) return false;
  if (snap.progress.reliefAt !== undefined && now < snap.progress.reliefAt + relief.cooldownHours * 3_600_000) return false;
  if (snap.mapKind === 'city') {
    return !snap.buildings.some(b => (s.rates[b.id] ?? 0) > 0 || (b.accrued ?? 0) >= 1
      || (b.status === 'CONSTRUCTING' && lookup(catalog.buildings, b.defId)?.baseRatePerHour));
  }
  return snap.crops.length === 0 && Object.values(snap.inventory).every(count => !count)
    && !snap.buildings.some(b => b.slots?.some(slot => slot.length > 0));
}
export function claimRelief(s: SimState, cmd: Command, now: number): Cost | undefined {
  if (cmd.type !== 'CLAIM_RELIEF') return undefined;
  guard(reliefAvailable(s, now), 'RELIEF_UNAVAILABLE');
  s.snapshot.wallet.cash += economy.relief.amount;
  s.snapshot.progress.reliefAt = now;
  return zeroCost();
}
