// Parallel quests (D041): economy-bot pacing on the two hand-authored maps (net worth at day 7, tutorial and chain completion).
// Usage: npx tsx scripts/quests-bot-bench.ts [--days 7] [--styles thuong,cham,nhan] [--out file.json]
import { readFile, writeFile } from 'node:fs/promises';
import { WorldTemplateSchema } from '@xay-nha/contracts';
import { createBot } from '../packages/tooling/src/economy-bot-policies';
import type { PlayStyle } from '../packages/tooling/src/economy-bot-schedule';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!, process.argv[i + 1] ?? '');
const DAYS = Number(args.get('--days') ?? 7), STYLES = (args.get('--styles') ?? 'thuong,cham,nhan').split(',') as PlayStyle[];
const rows: unknown[] = [];
for (const [kind, id] of [['city', 'city-coast-01'], ['farm', 'farm-valley-01']] as const) {
  const template = WorldTemplateSchema.parse(JSON.parse(await readFile(`apps/web/public/worlds/${id}/template.v2.json`, 'utf8')));
  for (const style of STYLES) {
    const r = createBot(template, style, DAYS).run();
    const row = { kind, style, netWorthDay7: r.final.netWorth, level: r.final.level, tutorialDoneDays: r.tutorialDoneDays ?? null, chainDoneDays: r.chainDoneDays ?? null,
      questIndex: r.final.questIndex, buildings: r.final.buildings, repeatClaims: r.final.repeatClaims, rejected: r.rejected };
    rows.push(row); console.error(JSON.stringify(row));
  }
}
const out = args.get('--out');
if (out) await writeFile(out, JSON.stringify({ days: DAYS, rows }, null, 2) + '\n');
