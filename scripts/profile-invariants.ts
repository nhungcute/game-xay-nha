import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Profile the unchanged seeded workload without Vitest worker scheduling or transforms.
const root = resolve(import.meta.dirname, '..');
const evidence = resolve(root, 'docs/evidence/g3/invariant-performance');
const sourcePath = resolve(root, 'packages/sim/src/invariants.test.ts');
const source = await readFile(sourcePath, 'utf8');
const callbackStart = "it('1000 seeded random commands preserve occupancy, integer wallet, unique IDs and all shared edges',()=>{";
if (!source.includes(callbackStart) || !source.trimEnd().endsWith('},60_000);')) {
  throw new Error('Invariant test shape changed; review profiler before running.');
}
let workload = source.replace("import { expect, it } from 'vitest';", '')
  .replace(callbackStart, 'function runInvariant() {')
  .replace(/},60_000\);\s*$/, '}\nrunInvariant();\n');
for (const name of ['execute', 'validateSnapshot', 'stateHash', 'cloneState', 'rebuildOccupancy']) {
  workload = workload.replace(new RegExp(`\\b${name}(?=[, }])`), `${name} as ${name}Original`);
}
const prelude = `
import { deepStrictEqual, ok, partialDeepStrictEqual } from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
function expect(actual, message) {
  return {
    toBe: expected => ok(Object.is(actual, expected), message),
    toEqual: expected => deepStrictEqual(actual, expected, message),
    toMatchObject: expected => partialDeepStrictEqual(actual, expected, message),
    toBeGreaterThan: expected => ok(actual > expected, message),
  };
}
const timings = {};
function measured(name, fn) {
  return (...args) => {
    const start = performance.now();
    try { return fn(...args); }
    finally {
      const elapsed = performance.now() - start;
      const row = timings[name] ??= { calls: 0, milliseconds: 0 };
      row.calls++; row.milliseconds += elapsed;
    }
  };
}
const execute = measured('execute', executeOriginal);
const validateSnapshot = measured('validateSnapshot', validateSnapshotOriginal);
const stateHash = measured('stateHash', stateHashOriginal);
const cloneState = measured('cloneState', cloneStateOriginal);
const rebuildOccupancy = measured('rebuildOccupancy', rebuildOccupancyOriginal);
const started = performance.now();
`;
const footer = `
const summary = {
  node: process.version,
  sourceSha256: ${JSON.stringify(createHash('sha256').update(source).digest('hex'))},
  elapsedMilliseconds: performance.now() - started,
  timings,
  note: 'Same seeded test source and assertions via node:assert; no Vitest scheduling. API timings include their nested calls.',
};
writeFileSync(${JSON.stringify(resolve(evidence, 'profile-summary.json'))}, JSON.stringify(summary, null, 2));
console.info(JSON.stringify(summary, null, 2));
`;
await mkdir(evidence, { recursive: true });
const bundle = resolve(evidence, 'profile-workload.mjs');
await build({
  stdin: { contents: prelude + workload + footer, loader: 'ts', resolveDir: dirname(sourcePath), sourcefile: sourcePath },
  bundle: true, platform: 'node', target: 'node22', format: 'esm', outfile: bundle,
  sourcemap: 'inline', tsconfig: resolve(root, 'tsconfig.json'),
});
try {
  const result = spawnSync(process.execPath, ['--cpu-prof', '--cpu-prof-dir', evidence, '--cpu-prof-name', 'invariants.cpuprofile', bundle], {
    cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  await writeFile(resolve(evidence, 'profile-run.log'), `${result.stdout ?? ''}${result.stderr ?? ''}`, 'utf8');
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Invariant profiler exited ${result.status ?? result.signal}`);
} finally {
  await rm(bundle, { force: true });
}

interface ProfileNode { id: number; callFrame: { functionName: string } }
interface CpuProfile { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] }
const profile = JSON.parse(await readFile(resolve(evidence, 'invariants.cpuprofile'), 'utf8')) as CpuProfile;
const nodes = new Map(profile.nodes.map(node => [node.id, node]));
const sampledTime = new Map<string, number>();
for (let index = 0; index < profile.samples.length; index++) {
  const node = nodes.get(profile.samples[index]!);
  const name = node?.callFrame.functionName || '(anonymous)';
  sampledTime.set(name, (sampledTime.get(name) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000);
}
const hotspots = {
  samples: profile.samples.length,
  totalMilliseconds: [...sampledTime.values()].reduce((sum, time) => sum + time, 0),
  topSelf: [...sampledTime].sort((left, right) => right[1] - left[1]).slice(0, 20)
    .map(([functionName, milliseconds]) => ({ functionName, milliseconds })),
};
await writeFile(resolve(evidence, 'cpu-hotspots.json'), JSON.stringify(hotspots, null, 2), 'utf8');
