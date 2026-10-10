// Q010 PROPOSAL ONLY: calibrate a Farm cumulative-XP table against the real sim + the improved Farm bot (V3).
// Nothing in packages/content is changed: the candidate table is patched into the in-memory `economy` object.
// Targets = elapsed time per level of the docs/16 reference model (simFarm, ordinary player).
// Each round: run V3, record XP over elapsed time, set threshold(L) = bot XP at target(L) (damped, monotonic, /10).
// Then verify the final candidate for all three play styles and report docs/10 §7 pacing + relative speed.
// Usage: npx tsx scripts/q010-farm-xp-calibrate.ts [rounds=3] [farm|city]   (city uses the unchanged EconomyBot)
import { readFile, writeFile } from 'node:fs/promises';
import { WorldTemplateSchema } from '@xay-nha/contracts';
import { economy } from '@xay-nha/content';
import { pacingComparison } from '../packages/tooling/sim-economy';
import { FarmBotV3 } from './q010-farm-bots';
import { EconomyBot } from '../packages/tooling/src/economy-bot-core';
// @ts-expect-error untyped reference model (docs/tools/economy)
import { simFarm, simCity, PLAYERS, sessions } from '../docs/tools/economy/model.mjs';

const MINUTE = 60_000, rounds = Number(process.argv[2] ?? 3), kind = (process.argv[3] ?? 'farm') as 'farm' | 'city';
const mapId = kind === 'farm' ? 'farm-valley-01' : 'city-coast-01', Bot = kind === 'farm' ? FarmBotV3 : EconomyBot;
const template = WorldTemplateSchema.parse(JSON.parse(await readFile(`apps/web/public/worlds/${mapId}/template.v2.json`, 'utf8')));
const original = [...economy.xp.cumulative[kind]];
const model = (kind === 'farm' ? simFarm : simCity)(PLAYERS.thuong, 60), first = sessions(PLAYERS.thuong, 1)[0][0];
const target: Record<number, number> = {};
for (let L = 2; L <= 20; L++) if (model.levelAt[L] != null) target[L] = model.levelAt[L] - first; // elapsed minutes

function run(style: 'cham' | 'thuong' | 'nhan', table: number[]) {
  economy.xp.cumulative[kind].splice(0, table.length, ...table);
  const series: [number, number][] = [];
  const bot = new Bot(template, style, 60);
  const capture = bot.captureLevels.bind(bot);
  bot.captureLevels = () => { capture(); const m = bot.now / MINUTE - bot.schedule[0]!.start; if (!series.length || m - series.at(-1)![0] >= 30) series.push([m, bot.s.snapshot.progress.xp]); };
  const result = bot.run();
  return { result, series };
}
const xpAt = (series: [number, number][], minute: number) => {
  const i = series.findIndex(([m]) => m >= minute);
  if (i < 0) return undefined; if (i === 0) return series[0]![1];
  const [m0, x0] = series[i - 1]!, [m1, x1] = series[i]!; return x0 + (x1 - x0) * (minute - m0) / Math.max(1, m1 - m0);
};

let table = [...original];
const history = [];
for (let round = 0; round < rounds; round++) {
  const { result, series } = run('thuong', table);
  history.push({ round, levelAtDays: result.levelAtDays, pacing: pacingComparison(result).map(p => [p.level, p.actualDays && +p.actualDays.toFixed(2), p.status]) });
  console.log(`round ${round}:`, JSON.stringify(history.at(-1)!.pacing));
  const next = [...table];
  for (let L = 2; L <= 20; L++) {
    if (L <= 4) continue; // reached in the first session through tutorial quests: keep the current thresholds
    const want = target[L] !== undefined ? xpAt(series, target[L]!) : undefined;
    // Beyond the run horizon keep the table's growth ratio.
    next[L] = want !== undefined ? Math.round((table[L]! * 0.4 + want * 0.6) / 10) * 10 : Math.round(next[L - 1]! * (table[L]! / table[L - 1]!) / 10) * 10;
    if (next[L]! <= next[L - 1]!) next[L] = next[L - 1]! + 10;
  }
  table = next;
}
const verify = Object.fromEntries((['cham', 'thuong', 'nhan'] as const).map(style => {
  const { result } = run(style, table);
  return [style, { final: result.final.level, levelAtDays: Object.fromEntries(Object.entries(result.levelAtDays).map(([k, v]) => [k, +v.toFixed(2)])), pacing: pacingComparison(result), snapshotValid: result.invariants.snapshotValid }];
}));
economy.xp.cumulative[kind].splice(0, original.length, ...original);
const speed = Object.fromEntries([8, 12, 15].map(L => [L, verify.cham.levelAtDays[L] && verify.thuong.levelAtDays[L] ? +(verify.thuong.levelAtDays[L] / verify.cham.levelAtDays[L]).toFixed(2) : null]));
const report = { note: 'PROPOSAL ONLY — content not changed. Apply via docs/16 §11 after approval.', currentTable: original, proposedTable: table, modelTargetsMinutes: target, history, verify, relativeSpeedThuongOverCham: speed };
await writeFile(`docs/reports/Q010-${kind}-xp-proposal.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log('proposed', JSON.stringify(table));
for (const [style, v] of Object.entries(verify)) console.log(style, 'L' + v.final, JSON.stringify(v.pacing.map(p => [p.level, p.expectedDays, p.actualDays && +p.actualDays.toFixed(1), p.deviation === null ? null : Math.round(p.deviation * 100) + '%', p.status])));
console.log('relative speed (thuong/cham days):', JSON.stringify(speed));
