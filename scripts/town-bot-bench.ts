// Town (city + countryside) balance bench: economy bot for N days on random town seeds next to the authored city and farm maps.
// Usage: npx tsx scripts/town-bot-bench.ts [--days 7] [--seeds 4] [--styles thuong,cham,nhan] [--out docs/evidence/g4/town/bot-bench.json]
import { readFile, writeFile } from 'node:fs/promises';
import { WorldTemplateSchema } from '@xay-nha/contracts';
import { generateWorldTemplate } from '@xay-nha/worldgen';
import { createBot } from '../packages/tooling/src/economy-bot-policies';
import type { PlayStyle } from '../packages/tooling/src/economy-bot-schedule';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!, process.argv[i + 1] ?? '');
const DAYS = Number(args.get('--days') ?? 7), SEEDS = Number(args.get('--seeds') ?? 4), STYLES = (args.get('--styles') ?? 'thuong,cham,nhan').split(',') as PlayStyle[];
const rows: Record<string, unknown>[] = [];
const push = (kind: string, map: string, style: string, r: ReturnType<ReturnType<typeof createBot>['run']>) => {
  const row = { kind, map, style, netWorth: r.final.netWorth, level: r.final.level, tutorialDoneDays: r.tutorialDoneDays ?? null, chainDoneDays: r.chainDoneDays ?? null,
    questsClaimed: r.final.questIndex, buildings: r.final.buildings, fields: r.final.fields, rate: Math.round(r.final.rate), repeatClaims: r.final.repeatClaims,
    valid: r.invariants.snapshotValid, rejected: r.rejected };
  rows.push(row); console.error(JSON.stringify(row));
};
for (const [kind, id] of [['city', 'city-coast-01'], ['farm', 'farm-valley-01']] as const) {
  const template = WorldTemplateSchema.parse(JSON.parse(await readFile(`apps/web/public/worlds/${id}/template.v2.json`, 'utf8')));
  for (const style of STYLES) push(kind, id, style, createBot(template, style, DAYS).run());
}
for (const kind of ['city', 'farm', 'town'] as const) for (let i = 0; i < SEEDS; i++) {
  const seed = 20260000 + i, { template } = generateWorldTemplate(kind, seed);
  for (const style of STYLES) push(kind, `rnd-${kind}-${seed}`, style, createBot(template, style, DAYS).run());
}
const out = args.get('--out');
if (out) await writeFile(out, JSON.stringify({ days: DAYS, rows }, null, 2) + '\n');
