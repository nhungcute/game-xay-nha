// Source-vs-output visual gate for the model importers (D029 buildings, D030 trees, D032 rocks, D035 streetlight,
// D037 landmarks). Renders each source GLB and the shipped output GLB from the same canonical views, compares
// silhouette and colour, writes contact sheets + report.json to docs/evidence/g4/visual-qa/ and exits 1 on failure.
//
//   node scripts/model-visual-qa.mjs                      all families
//   node scripts/model-visual-qa.mjs --family rocks       one family (buildings|trees|rocks|streetlight|landmarks)
//   node scripts/model-visual-qa.mjs --model well,bank    selected ids
//   node scripts/model-visual-qa.mjs --model landmark_citadel --output path/to/output.glb   check a candidate GLB
//   node scripts/model-visual-qa.mjs --known-bad          the D037 citadel (git 4e33db4); expected to FAIL
// Without the owner's `map/` sources (CI) it prints a notice and exits 0.
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { startRenderer, compareModel, THRESHOLDS, VIEWS } from './lib/visual-compare.mjs';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = name => args.includes(`--${name}`);

const repoRoot = process.cwd();
const sourceRoot = resolve(opt('source-root') ?? process.env.MODEL_SOURCE_ROOT ?? repoRoot);
const outDir = resolve(opt('out-dir') ?? 'docs/evidence/g4/visual-qa');
const wanted = opt('model')?.split(',');
const familyFilter = opt('family')?.split(',');
const outputOverride = opt('output');
const readJson = path => JSON.parse(readFileSync(join(repoRoot, path), 'utf8'));
const norm = path => path.replaceAll('\\', '/');

const MODELS_DIR = 'apps/web/public/assets/models/authored';

/** Builds the model list from every importer config. */
function collectModels() {
  const list = [];
  const pack = readJson('scripts/model-pack.config.json');
  for (const [id, m] of Object.entries(pack.models)) {
    list.push({ id, family: 'buildings', source: norm(m.source), output: `${MODELS_DIR}/${id}.glb`, rotationYDeg: m.rotationYDeg ?? 0, hideNodes: m.droppedGroups ?? [] });
  }
  const trees = readJson('scripts/trees.config.json');
  for (const [id, m] of Object.entries(trees.models)) {
    list.push({ id, family: 'trees', rebuilt: m.family !== 'conifer', source: `map/tree/${m.source}`, output: m.file, rotationYDeg: 0 });
  }
  const rocks = readJson('scripts/rocks.config.json');
  for (const [id, m] of Object.entries(rocks.models)) {
    list.push({ id, family: 'rocks', source: norm(rocks.source), output: m.file, rotationYDeg: 0, onlyNode: m.sourceMesh });
  }
  const light = readJson('scripts/streetlight.config.json');
  list.push({ id: light.id, family: 'streetlight', source: norm(light.source), output: `${MODELS_DIR}/${light.id}.glb`, rotationYDeg: 0 });
  const landmarks = readJson('scripts/landmarks.config.json');
  for (const [id, m] of Object.entries(landmarks.models)) {
    // import-landmarks.mjs rotates every landmark by PI so the entrance faces -Z.
    list.push({ id, family: 'landmarks', source: norm(m.credits.source), output: m.file, rotationYDeg: 180 });
  }
  return list;
}

/** The D037 citadel: removed in D038, its broken output lives only in git history. */
const KNOWN_BAD = {
  id: 'landmark_citadel', family: 'landmarks', source: 'map/nha2/citadel_of_kings.glb', rotationYDeg: 180, knownBad: true,
  gitOutput: '4e33db4:apps/web/public/assets/models/authored/landmark_citadel.glb',
};

function extractFromGit(ref, id) {
  const file = join(tmpdir(), `visual-qa-${id}-${ref.split(':')[0]}.glb`);
  const data = execFileSync('git', ['show', ref], { maxBuffer: 256 * 1024 * 1024 });
  return writeFile(file, data).then(() => file);
}

const fmt = s => `iou ${s.iou.toFixed(2)}  dE ${s.dE.toFixed(1)}  ratio ${s.ratio.toFixed(2)}  Lr ${s.lRatio.toFixed(2)}  L50 ${s.outMedL.toFixed(0)}  ctr ${s.outContrast.toFixed(0)}`;

async function main() {
  const started = Date.now();
  let models = collectModels();
  if (flag('known-bad')) models = [KNOWN_BAD];
  else if (wanted) {
    models = models.filter(m => wanted.includes(m.id));
    for (const id of wanted) if (!models.some(m => m.id === id) && id === KNOWN_BAD.id) models.push(KNOWN_BAD);
    if (!models.length) { console.error(`No model matches --model ${wanted.join(',')}`); process.exit(2); }
  }
  if (familyFilter) models = models.filter(m => familyFilter.includes(m.family));
  if (outputOverride && models.length !== 1) { console.error('--output needs exactly one --model'); process.exit(2); }

  const resolvedSource = m => resolve(sourceRoot, m.source);
  const present = models.filter(m => existsSync(resolvedSource(m)));
  if (!present.length) {
    console.log(`Model sources not found under ${sourceRoot} (the owner's map/ folder is git-ignored); skipping the source-vs-output visual gate.`);
    return 0;
  }
  for (const m of models) if (!present.includes(m)) console.log(`NOTICE: source missing, skipped: ${m.id} (${m.source})`);

  await mkdir(outDir, { recursive: true });
  const renderer = await startRenderer({ repoRoot, roots: [repoRoot, sourceRoot] });
  const results = [];
  try {
    for (const m of present) {
      const t0 = Date.now();
      let output = resolve(repoRoot, outputOverride ?? m.output ?? '');
      if (!outputOverride && m.gitOutput) output = await extractFromGit(m.gitOutput, m.id);
      if (!existsSync(output)) { console.log(`FAIL ${m.id}: output missing ${output}`); results.push({ ...m, pass: false, failures: ['output missing'] }); continue; }
      const common = { rotationYDeg: m.rotationYDeg };
      const src = await renderer.render({ ...common, file: resolvedSource(m), onlyNode: m.onlyNode, hideNodes: m.hideNodes });
      const out = await renderer.render({ file: output });
      const cmp = compareModel(src.views, out.views, { rebuilt: m.rebuilt });
      const ms = Date.now() - t0;
      results.push({
        id: m.id, family: m.family, source: m.source, output: outputOverride ?? m.gitOutput ?? m.output, knownBad: !!m.knownBad,
        pass: cmp.pass, failures: cmp.failures, margin: +cmp.margin.toFixed(3),
        scores: Object.fromEntries(Object.entries(cmp.scores).map(([k, v]) => [k, +v.toFixed(3)])),
        views: Object.fromEntries(VIEWS.map(v => [v, Object.fromEntries(Object.entries(cmp.per[v]).map(([k, x]) => [k, +x.toFixed(3)]))])),
        ms, _src: src.views, _out: out.views,
      });
      console.log(`${cmp.pass ? 'PASS' : 'FAIL'} ${m.id.padEnd(20)} ${fmt(cmp.scores)}  margin ${cmp.margin.toFixed(2)}  ${(ms / 1000).toFixed(1)}s${cmp.pass ? '' : '  <- ' + cmp.failures.join('; ')}`);
    }

    // Contact sheets, one per family (known-bad runs get their own file name).
    const families = [...new Set(results.map(r => r.family))];
    for (const family of families) {
      const rows = results.filter(r => r.family === family && r._src);
      const cells = rows.map(r => ({
        title: r.id, fail: !r.pass, summary: r.scores ? fmt(r.scores) : '',
        views: VIEWS.map(v => ({ src: r._src[v], out: r._out[v], caption: `${v}: source | output  iou ${r.views[v].iou.toFixed(2)}` })),
      }));
      const bad = rows.every(r => r.knownBad);
      const name = bad ? `${family}-known-bad.png` : `${family}.png`;
      const partial = wanted || familyFilter ? ' (partial run)' : '';
      const png = await renderer.sheet(cells, {
        title: `${family}: source | output per view${partial}  thresholds iou>=${THRESHOLDS.minIou} ratio<=${THRESHOLDS.maxRatio} dE<=${THRESHOLDS.maxDE}`,
        columns: cells.length === 1 ? 1 : 2,
      });
      if (!outputOverride || bad) { await writeFile(join(outDir, name), png); console.log(`sheet ${join(outDir, name)}`); }
    }
  } finally { await renderer.close(); }

  const clean = results.map(({ _src, _out, ...rest }) => { void _src; void _out; return rest; });
  const full = !wanted && !familyFilter && !flag('known-bad');
  const reportPath = join(outDir, flag('known-bad') || outputOverride ? 'report-known-bad.json' : full ? 'report.json' : 'report-partial.json');
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({
    thresholds: THRESHOLDS, views: VIEWS, totalSeconds: +((Date.now() - started) / 1000).toFixed(1),
    summary: { total: clean.length, pass: clean.filter(r => r.pass).length, fail: clean.filter(r => !r.pass).length },
    results: clean,
  }, null, 2) + '\n');
  const failed = clean.filter(r => !r.pass);
  console.log(`\n${clean.length - failed.length}/${clean.length} pass in ${((Date.now() - started) / 1000).toFixed(0)}s -> ${reportPath}`);
  if (failed.length) { console.log(`Visual gate FAILED: ${failed.map(r => r.id).join(', ')}`); return 1; }
  return 0;
}

process.exit(await main());
