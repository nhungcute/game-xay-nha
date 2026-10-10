// Q010 closing evidence: both maps × three play styles, 60 days, with the improved bots (FarmBotV3, CityBotV2;
// both subclass Codex's EconomyBot and use only legal commands) on the committed content (contentVersion 2).
// Compares level times with the fixed docs/16 §12.1 targets (not the live model: its Farm run now uses the D025
// table and its simplifications level faster). Usage: npx tsx scripts/q010-verify.ts
import { readFile, writeFile } from 'node:fs/promises';
import { WorldTemplateSchema } from '@xay-nha/contracts';
import { contentVersion } from '@xay-nha/content';
import { pacingComparison } from '../packages/tooling/sim-economy';
import { CityBotV2, FarmBotV3 } from '../packages/tooling/src/economy-bot-policies';
// docs/16 §12.1 elapsed days for L5/8/10/12/15/18/20 (4 h = 0.17 d, 17 h = 0.71 d; null = not reached in 60 days).
const TARGET = {"city": {"cham": [0.17, 2.5, 5, 10, 19, 33, 48], "thuong": [0.71, 3.5, 6, 11, 21, 35, 49], "nhan": [2, 9, 16, 28, 48, null, null]}, "farm": {"cham": [0.17, 2, 4, 8, 15, 24, 35], "thuong": [1, 4, 7, 12, 22, 37, 52], "nhan": [3, 12, 21, 35, 59, null, null]}} as Record<'city' | 'farm', Record<'cham' | 'thuong' | 'nhan', (number | null)[]>>;

const LEVELS = [5, 8, 10, 12, 15, 18, 20], rows = [];
for (const [kind, mapId, Bot] of [['city', 'city-coast-01', CityBotV2], ['farm', 'farm-valley-01', FarmBotV3]] as const) {
  const template = WorldTemplateSchema.parse(JSON.parse(await readFile(`apps/web/public/worlds/${mapId}/template.v2.json`, 'utf8')));
  for (const style of ['cham', 'thuong', 'nhan'] as const) {
    const started = Date.now(), result = new Bot(template, style, 60).run();
    const levels = Object.fromEntries(LEVELS.map(L => [L, {
      bot: result.levelAtDays[L] === undefined ? null : +result.levelAtDays[L]!.toFixed(2),
      target: TARGET[kind][style][LEVELS.indexOf(L)] }]));
    const row = { map: kind, style, finalLevel: result.final.level, snapshotValid: result.invariants.snapshotValid, levels,
      gate: style === 'thuong' ? pacingComparison(result).map(p => ({ level: p.level, expected: p.expectedDays, actual: p.actualDays === null ? null : +p.actualDays.toFixed(2), deviation: p.deviation === null ? null : Math.round(p.deviation * 100), status: p.status })) : undefined,
      seconds: Math.round((Date.now() - started) / 1000) };
    rows.push(row);
    console.log(kind, style, 'L' + row.finalLevel, JSON.stringify(LEVELS.map(L => `${L}:${levels[L]!.bot}/${levels[L]!.target}`)), row.gate ? JSON.stringify(row.gate.map(g => `${g.level}:${g.deviation}%${g.status}`)) : '');
  }
}
await writeFile('docs/reports/Q010-verify.json', `${JSON.stringify({ contentVersion, note: 'levels = elapsed days, bot vs docs/16 §12.1 target', rows }, null, 2)}\n`);
