// Q010 option 1 experiment runner: baseline EconomyBot vs FarmBotV2/V3 (scripts/q010-farm-bots.ts).
// Usage: npx tsx scripts/q010-farm-bot.ts [days=60] [style=thuong]
import { readFile, writeFile } from 'node:fs/promises';
import { WorldTemplateSchema } from '@xay-nha/contracts';
import { EconomyBot } from '../packages/tooling/src/economy-bot-core';
import type { PlayStyle } from '../packages/tooling/src/economy-bot-schedule';
import { pacingComparison } from '../packages/tooling/sim-economy';
import { FarmBotV2, FarmBotV3 } from '../packages/tooling/src/economy-bot-policies';

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
