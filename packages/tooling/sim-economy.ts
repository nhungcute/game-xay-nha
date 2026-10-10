import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WorldTemplateSchema, type MapKind } from '@xay-nha/contracts';
import { economy } from '@xay-nha/content';
import { EconomyBot, type BotResult } from './src/economy-bot-core';
import { PLAYER_SCHEDULES, type PlayStyle } from './src/economy-bot-schedule';

const EXPECTED_NORMAL_DAYS: Record<MapKind, Record<number, number>> = { city: { 8: 3.5, 12: 11, 15: 21, 20: 49 }, farm: { 8: 4, 12: 12, 15: 22, 20: 52 } };
async function sourceFingerprint() {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (/\.(ts|json)$/.test(entry.name)) files.push(path);
    }
  }
  for (const directory of ['packages/contracts/src', 'packages/content', 'packages/sim/src', 'packages/worldgen/src']) await visit(directory);
  files.push('packages/tooling/sim-economy.ts', 'packages/tooling/src/economy-bot-core.ts', 'packages/tooling/src/economy-bot-schedule.ts',
    'apps/web/public/worlds/city-coast-01/template.v2.json', 'apps/web/public/worlds/farm-valley-01/template.v2.json');
  const hashes = Object.fromEntries(await Promise.all(files.sort().map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
  return { digest: createHash('sha256').update(JSON.stringify(hashes)).digest('hex'), files: hashes };
}
export function pacingComparison(result: BotResult) {
  return Object.entries(EXPECTED_NORMAL_DAYS[result.mapKind]).map(([level, expectedDays]) => {
    const actualDays = result.levelAtDays[Number(level)];
    return { level: Number(level), expectedDays, actualDays: actualDays ?? null,
      deviation: actualDays === undefined ? null : (actualDays - expectedDays) / expectedDays,
      status: result.style !== 'thuong' ? 'NOT_APPLICABLE' : actualDays === undefined ? 'UNREACHED' : Math.abs(actualDays - expectedDays) / expectedDays <= 0.25 ? 'PASS' : 'FAIL' };
  });
}
export async function runEconomy(args: string[]): Promise<unknown> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    if (!args[index]?.startsWith('--') || !args[index + 1] || options.has(args[index]!)) throw new Error('Use --days N --map city|farm|all --style cham|thuong|nhan|all --out report.json');
    options.set(args[index]!, args[index + 1]!);
  }
  const allowed = new Set(['--days', '--map', '--style', '--out']);
  for (const key of options.keys()) if (!allowed.has(key)) throw new Error(`Unknown option ${key}`);
  const days = Number(options.get('--days') ?? 60), map = options.get('--map') ?? 'all', style = options.get('--style') ?? 'all';
  if (!Number.isInteger(days) || days < 1 || days > 60) throw new Error('--days must be 1..60');
  if (!['city', 'farm', 'all'].includes(map) || !['cham', 'thuong', 'nhan', 'all'].includes(style)) throw new Error('Invalid map/style');
  const maps = (map === 'all' ? ['city', 'farm'] : [map]) as MapKind[], styles = (style === 'all' ? ['cham', 'thuong', 'nhan'] : [style]) as PlayStyle[];
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirtyFiles = execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  const source = await sourceFingerprint();
  const results: { result: BotResult; pacing: ReturnType<typeof pacingComparison>; wallSeconds: number }[] = [];
  for (const kind of maps) {
    const id = kind === 'city' ? 'city-coast-01' : 'farm-valley-01';
    const template = WorldTemplateSchema.parse(JSON.parse(await readFile(`apps/web/public/worlds/${id}/template.v2.json`, 'utf8')));
    for (const mode of styles) {
      const start = performance.now(), result = new EconomyBot(template, mode, days, day => {
        if (days <= 10 || day % 10 === 0) console.error(`${kind}/${mode}: completed day ${day}`);
      }).run();
      const row = { result, pacing: pacingComparison(result), wallSeconds: (performance.now() - start) / 1000 };
      results.push(row); console.error(`${kind}/${mode}: ${days} days, L${result.final.level}, ${result.commands} commands, ${row.wallSeconds.toFixed(2)}s, snapshot ${result.invariants.snapshotValid ? 'valid' : 'INVALID'}`);
      // Preserve each completed scenario if a later long run is interrupted.
      if (options.has('--out')) await writeFile(options.get('--out')!, JSON.stringify({ revision, dirtyFiles, source, contentVersion: economy.contentVersion, schedules: PLAYER_SCHEDULES, results }, null, 2) + '\n');
    }
  }
  const sourceChangedDuringRun = source.digest !== (await sourceFingerprint()).digest;
  const report = { revision, dirtyFiles, source, sourceChangedDuringRun, contentVersion: economy.contentVersion, schedules: PLAYER_SCHEDULES, results };
  if (options.has('--out')) await writeFile(options.get('--out')!, JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const report = await runEconomy(process.argv.slice(2)); if (!process.argv.includes('--out')) console.log(JSON.stringify(report, null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
