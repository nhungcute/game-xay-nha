// Town random-map sweep: N seeds through generateWorldTemplate + checkPlayability (pass rate, water %, generation time).
// Usage: npx tsx scripts/town-sweep.ts [--seeds 50] [--out docs/evidence/g4/town/sweep.json]
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { checkPlayability, generateWorldTemplate, rasterizeWater, validateTemplate } from '@xay-nha/worldgen';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!, process.argv[i + 1] ?? '');
const SEEDS = Number(args.get('--seeds') ?? 50), START = 20260000;
let pass = 0;
const failed: { seed: number; errors: string[] }[] = [];
const water: number[] = [], ms: number[] = [], attempts: number[] = [];
for (let i = 0; i < SEEDS; i++) {
  const seed = START + i, t0 = performance.now();
  try {
    const { template, attempt } = generateWorldTemplate('town', seed);
    ms.push(performance.now() - t0); attempts.push(attempt);
    const errors = [...validateTemplate(template), ...checkPlayability(template)];
    water.push(rasterizeWater(template.water).reduce((s, w) => s + w, 0) / 163.84);
    if (errors.length) failed.push({ seed, errors }); else pass++;
  } catch (e) { failed.push({ seed, errors: [String(e instanceof Error ? e.message : e).slice(0, 200)] }); }
}
const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length), sorted = [...ms].sort((a, b) => a - b);
const report = { seeds: SEEDS, startSeed: START, pass, passRate: pass / SEEDS, failed, waterPct: { min: Math.min(...water), avg: avg(water), max: Math.max(...water) },
  genMs: { avg: Math.round(avg(ms)), median: Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0), max: Math.round(Math.max(...ms)) }, attempts: { avg: avg(attempts), max: Math.max(...attempts) } };
console.log(JSON.stringify(report, null, 2));
const out = args.get('--out'); if (out) await writeFile(out, JSON.stringify(report, null, 2) + '\n');
