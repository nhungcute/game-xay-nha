// Q010 option 1 experiment: does a better Farm strategy close the pacing gap without changing any rule or number?
// FarmBotV2 extends Codex's EconomyBot (file unchanged) and only changes the bot's choices, all through legal commands:
//  - sell before harvesting (storage room first), then the base routine;
//  - keep building every affordable producer, not one per tick;
//  - add silos up to the level limit whenever storage rejected a harvest/collect.
// Usage: npx tsx scripts/q010-farm-bot.ts [days=60] [style=thuong]
import { readFile, writeFile } from 'node:fs/promises';
import { WorldTemplateSchema } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { buildingLimit } from '@xay-nha/sim';
import { EconomyBot } from '../packages/tooling/src/economy-bot-core';
import type { PlayStyle } from '../packages/tooling/src/economy-bot-schedule';
import { pacingComparison } from '../packages/tooling/sim-economy';

type Session = Parameters<EconomyBot['farm']>[0];
class FarmBotV2 extends EconomyBot {
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
class FarmBotV3 extends FarmBotV2 {
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

const days = Number(process.argv[2] ?? 60), style = (process.argv[3] ?? 'thuong') as PlayStyle;
const template = WorldTemplateSchema.parse(JSON.parse(await readFile('apps/web/public/worlds/farm-valley-01/template.v2.json', 'utf8')));
const rows = [];
for (const [name, Bot] of [['baseline', EconomyBot], ['v2', FarmBotV2], ['v3', FarmBotV3]] as const) {
  const started = Date.now(), result = new Bot(template, style, days).run();
  const row = { bot: name, style, days, level: result.final.level, cash: result.final.cash, buildings: result.final.buildings, producers: result.final.producers,
    fields: result.final.fields, storageFull: result.rejected.STORAGE_FULL ?? 0, snapshotValid: result.invariants.snapshotValid,
    pacing: pacingComparison(result).map(p => ({ level: p.level, expected: p.expectedDays, actual: p.actualDays === null ? null : +p.actualDays.toFixed(2),
      deviation: p.deviation === null ? null : Math.round(p.deviation * 100), status: p.status })), seconds: Math.round((Date.now() - started) / 1000) };
  rows.push(row); console.log(JSON.stringify(row));
}
await writeFile(`docs/reports/Q010-farm-bot-${style}.json`, `${JSON.stringify(rows, null, 2)}\n`);
