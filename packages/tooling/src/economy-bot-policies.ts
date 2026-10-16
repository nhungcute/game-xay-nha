// Tuned bot policies (Q010, D025), now the default of sim-economy.ts. They subclass the base EconomyBot and only
// change the bot's choices, all through legal commands; no rule or number differs.
//  Farm (FarmBotV3): sell before harvesting; build every affordable producer up to its limit; silos only after a
//    storage rejection; the next farmhouse (24 more fields) before silo/producers/zones; zones with a 3x cash cushion.
//  City (CityBotV2): keep placing buildings within a tick while one was placed (the base bot places at most one per
//    5-minute tick, so short sessions under-build and hoard cash).
import { catalog, economy } from '@xay-nha/content';
import { buildingLimit } from '@xay-nha/sim';
import type { WorldTemplate } from '@xay-nha/contracts';
import { EconomyBot } from './economy-bot-core';
import type { PlayStyle } from './economy-bot-schedule';

type Session = Parameters<EconomyBot['farm']>[0];
export class FarmBotV2 extends EconomyBot {
  private storageRejections = 0;
  override farm(session: Session, minute: number): void {
    this.sellAll();
    super.farm(session, minute);
    const level = this.s.snapshot.progress.level, count = (id: string) => this.s.snapshot.buildings.filter(b => b.defId === id).length;
    const producers = Object.values(catalog.buildings).filter(def => def.mapKinds.includes('farm') && def.production && def.unlockLevel <= level);
    for (let guard = 0; guard < 6; guard++) {
      const next = producers.find(def => count(def.id) < buildingLimit(this.s, def) && this.s.snapshot.wallet.cash > def.cost.cash * 2);
      if (!next || !this.build(next.id)) break;
    }
    const rejected = this.rejected.STORAGE_FULL ?? 0, silo = catalog.buildings.silo!;
    if (rejected > this.storageRejections && level >= silo.unlockLevel && count('silo') < buildingLimit(this.s, silo)) this.build('silo');
    this.storageRejections = rejected;
  }
}

/** V3 = V2 + field-first priorities: the next farmhouse (24 more fields) before silo/producers/zones,
 * silos only after storage actually rejected something, zones only with a cash cushion or when a farmhouse has no site. */
export class FarmBotV3 extends FarmBotV2 {
  private farmhouseBlocked = false;
  private farmhouseDue(): { due: boolean; cost: number } {
    const fh = catalog.buildings.farmhouse!, owned = this.s.snapshot.buildings.filter(b => b.defId === 'farmhouse').length;
    const allowed = fh.unlockLevels!.filter(l => l <= this.s.snapshot.progress.level).length;
    return { due: owned < allowed, cost: fh.costScaling?.[owned] ?? fh.cost.cash };
  }
  override build(defId: string, far = false): boolean {
    const { due, cost } = this.farmhouseDue(), def = catalog.buildings[defId]!;
    if (defId === 'farmhouse') { const ok = super.build(defId, far); this.farmhouseBlocked = !ok && this.s.snapshot.wallet.cash >= cost; return ok; }
    if (defId === 'silo' && !(this.rejected.STORAGE_FULL ?? 0)) return false;
    if (due && !this.farmhouseBlocked && defId !== 'market' && this.s.snapshot.wallet.cash < cost + def.cost.cash) return false;
    return super.build(defId, far);
  }
  override expand(): boolean {
    const zoneCost = economy.zones.costBase * this.s.snapshot.unlockedZones.length;
    if (!this.farmhouseBlocked && this.s.snapshot.wallet.cash < 3 * zoneCost) return false;
    return super.expand();
  }
  override farm(session: Session, minute: number): void {
    const { due, cost } = this.farmhouseDue();
    if (due && this.s.snapshot.buildings.some(b => b.defId === 'market') && this.s.snapshot.wallet.cash >= cost) this.build('farmhouse');
    super.farm(session, minute);
  }
}


/** City counterpart (Q010): the base bot builds at most one building per 5-minute tick, so an ordinary player's
 * 8–10-minute sessions place ~2 buildings while cash piles up. V2 keeps building within the same tick while it can. */
export class CityBotV2 extends EconomyBot {
  override city(): void {
    for (let i = 0; i < 12; i++) {
      const before = this.s.snapshot.buildings.length;
      super.city();
      if (this.s.snapshot.buildings.length === before) break;
    }
  }
}

/** Town (city + countryside): field-first farm policy (V3) plus the city bot's within-tick building loop. */
export class TownBot extends FarmBotV3 {
  override city(): void {
    for (let i = 0; i < 12; i++) {
      const before = this.s.snapshot.buildings.length;
      super.city();
      if (this.s.snapshot.buildings.length === before) break;
    }
  }
}

/** The bot sim-economy.ts uses: tuned policies by default, the original base bot with `base`. */
export function createBot(template: WorldTemplate, style: PlayStyle, days: number, onDay?: (day: number) => void, policy: 'tuned' | 'base' = 'tuned'): EconomyBot {
  if (policy === 'base') return new EconomyBot(template, style, days, onDay);
  if (template.mapKind === 'town') return new TownBot(template, style, days, onDay);
  return template.mapKind === 'farm' ? new FarmBotV3(template, style, days, onDay) : new CityBotV2(template, style, days, onDay);
}
