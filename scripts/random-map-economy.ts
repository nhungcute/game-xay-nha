// D039 step 4: economy-bot balance gate for random maps.
// Runs the tuned economy bot for 7 simulated days on the hand-authored map and on N random seeds per map kind and compares
// tutorial/quest-chain completion time and net worth after 7 days. Gate: random median within +-20% of the authored result.
// Usage: npx tsx scripts/random-map-economy.ts [--seeds 30] [--days 7] [--style thuong] [--out docs/evidence/g4/random-maps/economy.json]
import { readFile, writeFile } from 'node:fs/promises';
import { WorldTemplateSchema, type MapKind } from '@xay-nha/contracts';
import { generateWorldTemplate } from '@xay-nha/worldgen';
import { createBot } from '../packages/tooling/src/economy-bot-policies';
import type { BotResult } from '../packages/tooling/src/economy-bot-core';
import type { PlayStyle } from '../packages/tooling/src/economy-bot-schedule';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!, process.argv[i + 1] ?? '');
const SEEDS = Number(args.get('--seeds') ?? 30), DAYS = Number(args.get('--days') ?? 7), STYLE = (args.get('--style') ?? 'thuong') as PlayStyle;
const OUT = args.get('--out') ?? 'docs/evidence/g4/random-maps/economy.json';
const START_SEED = 20260000;

const pct = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
function stats(values: (number | undefined)[]) {
  const reached = values.filter((v): v is number => v !== undefined).sort((a, b) => a - b);
  if (!reached.length) return { n: 0, of: values.length, median: null, p10: null, p90: null, min: null, max: null };
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { n: reached.length, of: values.length, median: r(pct(reached, 0.5)), p10: r(pct(reached, 0.1)), p90: r(pct(reached, 0.9)), min: r(reached[0]!), max: r(reached.at(-1)!) };
}
const summarize = (rows: BotResult[]) => ({
  tutorialDoneDays: stats(rows.map(r => r.tutorialDoneDays)),
  chainDoneDays: stats(rows.map(r => r.chainDoneDays)),
  netWorthDay7: stats(rows.map(r => r.final.netWorth)),
  level: stats(rows.map(r => r.final.level)),
  buildings: stats(rows.map(r => r.final.buildings)),
  invalid: rows.filter(r => !r.invariants.snapshotValid || !r.invariants.walletSafe || !r.invariants.occupancyValid).length,
});
const median = (values: number[]): number => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; };
/** Per-day level / income rate / net-worth-proxy (cash + buildings) medians: shows where random and authored diverge. */
const dailyMedians = (rows: BotResult[]) => Array.from({ length: DAYS }, (_, d) => ({
  day: d + 1,
  level: median(rows.map(r => r.daily[d]?.level ?? 0)),
  incomeRatePerHour: Math.round(median(rows.map(r => r.daily[d]?.rate ?? 0))),
  buildings: median(rows.map(r => r.daily[d]?.buildings ?? 0)),
}));
/** Median elapsed days at which each quest index was reached (quest i claimed => index i+1). */
const questMedians = (rows: BotResult[]) => Array.from({ length: 13 }, (_, q) => {
  const reached = rows.map(r => r.questReachedDays?.[q]).filter((v): v is number => v !== undefined);
  return reached.length ? Math.round(median(reached) * 100) / 100 : null;
});
const ratio = (random: number | null, authored: number | null): number | null => random === null || authored === null || authored === 0 ? null : Math.round((random / authored - 1) * 1000) / 10;

const report: Record<string, unknown> = { at: new Date().toISOString(), days: DAYS, style: STYLE, seeds: SEEDS, gate: 'random median within +-20% of authored for tutorial time and net worth', kinds: {} };
let allPass = true;
for (const kind of ['city', 'farm'] as MapKind[]) {
  const id = kind === 'city' ? 'city-coast-01' : 'farm-valley-01';
  const authoredTemplate = WorldTemplateSchema.parse(JSON.parse(await readFile(`apps/web/public/worlds/${id}/template.v2.json`, 'utf8')));
  const authored = createBot(authoredTemplate, STYLE, DAYS).run();
  const randoms: BotResult[] = [], perSeed: unknown[] = [];
  for (let i = 0; i < SEEDS; i++) {
    const seed = START_SEED + i, { template } = generateWorldTemplate(kind, seed);
    const result = createBot(template, STYLE, DAYS).run();
    randoms.push(result);
    perSeed.push({ seed, level: result.final.level, questIndex: result.final.questIndex, tutorialDoneDays: result.tutorialDoneDays ?? null, chainDoneDays: result.chainDoneDays ?? null,
      netWorth: result.final.netWorth, buildings: result.final.buildings, rejected: result.rejected });
    console.error(`${kind} seed ${seed}: L${result.final.level} quest ${result.final.questIndex} tutorial ${result.tutorialDoneDays?.toFixed(2) ?? '-'}d net ${result.final.netWorth}`);
  }
  const a = summarize([authored]), r = summarize(randoms);
  const tutorialDelta = ratio(r.tutorialDoneDays.median, a.tutorialDoneDays.median), netDelta = ratio(r.netWorthDay7.median, a.netWorthDay7.median);
  const chainDelta = ratio(r.chainDoneDays.median, a.chainDoneDays.median);
  const pass = r.invalid === 0 && tutorialDelta !== null && Math.abs(tutorialDelta) <= 20 && netDelta !== null && Math.abs(netDelta) <= 20;
  allPass &&= pass;
  (report.kinds as Record<string, unknown>)[kind] = { authoredMap: id, authored: { tutorialDoneDays: authored.tutorialDoneDays ?? null, chainDoneDays: authored.chainDoneDays ?? null,
    netWorthDay7: authored.final.netWorth, level: authored.final.level, buildings: authored.final.buildings, questIndex: authored.final.questIndex },
    random: r, authoredDaily: dailyMedians([authored]), randomDailyMedian: dailyMedians(randoms),
    authoredQuestReachedDays: questMedians([authored]), randomQuestReachedDaysMedian: questMedians(randoms), medianDeltaPct: { tutorialDoneDays: tutorialDelta, chainDoneDays: chainDelta, netWorthDay7: netDelta }, pass, perSeed };
  console.error(`${kind}: authored tutorial ${authored.tutorialDoneDays?.toFixed(2)}d net ${authored.final.netWorth}; random median tutorial ${r.tutorialDoneDays.median}d (${tutorialDelta}%), net ${r.netWorthDay7.median} (${netDelta}%) -> ${pass ? 'PASS' : 'FAIL'}`);
}
report.pass = allPass;
await writeFile(OUT, JSON.stringify(report, null, 2) + '\n');
console.error(`economy gate ${allPass ? 'PASSED' : 'FAILED'} -> ${OUT}`);
process.exitCode = allPass ? 0 : 1;
