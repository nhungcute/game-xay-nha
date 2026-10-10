import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const readLog = name => readFileSync(`docs/evidence/mvp-final/${name}.log`, 'utf8');
const economy = readJson('docs/reports/G3-economy-current.json');
const comparison = readJson('docs/reports/G3-economy-comparison.json');
const browser = readJson('docs/evidence/g3/e2e/g3-e2e.json');
const smoke = readJson('docs/evidence/g4/smoke/smoke.json');
const payback = readJson('docs/reports/G3-payback-fixture.json');

// Verify retained assertions and source identity without rerunning expensive suites.
assert.match(readLog('check'), /Tests\s+682 passed \(682\)/);
assert.match(readLog('api'), /Tests\s+22 passed \(22\)/);
assert.match(readLog('smoke'), /G4 smoke: PASS/);
assert.equal(browser.checks.length, 26);
assert(browser.checks.every(check => check.ok));
assert.equal(browser.errors.length, 0);
assert.equal(smoke.health, 'ok');
const smokeCases = Object.entries(smoke.runs).flatMap(([browserName, run]) => {
  assert.equal(run.errors.length, 0);
  return Object.entries(run.maps).map(([map, result]) => {
    assert.equal(Object.keys(result.checks).length, 6);
    assert(Object.values(result.checks).every(Boolean));
    return { browser: browserName, map, checks: 6, metrics: result.metrics };
  });
});
assert.equal(smokeCases.length, 4);
const fingerprints = Object.entries(economy.source.files);
assert.equal(fingerprints.length, 55);
for (const [path, digest] of fingerprints) {
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), digest, path);
}
assert.equal(comparison.sourceUnchanged, true);
assert.equal(comparison.scenarios.length, 6);
assert(comparison.scenarios.every(({ invariants }) =>
  invariants.snapshotValid && invariants.walletSafe && invariants.occupancyValid && !invariants.errors.length));
assert.equal(comparison.pacingGate, 'FAIL');
assert.equal(payback.snapshotValid, true);
assert.equal(payback.commands, 9);
assert.equal(payback.level, 8);
assert.equal(payback.actualRatePerHour, 638.4);
assert.equal(payback.belowOneHour, true);

// Inspect service status/ports only; never dump Compose environment or secrets.
const services = execFileSync('docker', [
  'compose', '--env-file', 'infra/.env', '-f', 'infra/compose.yml', 'ps', '--format', 'json',
], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean).map(line => {
  const item = JSON.parse(line);
  return { service: item.Service, state: item.State, health: item.Health, publishers: item.Publishers ?? [] };
});
assert.deepEqual(services.map(item => item.service).sort(), ['api', 'backup', 'postgres', 'web']);
for (const service of services) {
  assert.equal(service.state, 'running');
  if (service.service !== 'backup') assert.equal(service.health, 'healthy');
  if (service.service !== 'web') assert(service.publishers.every(port => !port.PublishedPort));
}
const web = services.find(item => item.service === 'web');
assert(web.publishers.some(port => port.URL === '127.0.0.1' && port.PublishedPort === 8090));

const report = {
  verifiedAt: new Date().toISOString(),
  testedHead: '2303cb5', implementationRevision: comparison.revision, contentVersion: comparison.contentVersion,
  commands: [
    { command: 'pnpm check', exitCode: 0, cases: 682, log: 'check.log' },
    { command: 'pnpm test:api', exitCode: 0, cases: 22, log: 'api.log' },
    { command: 'pnpm deploy:up', exitCode: 0, log: 'deploy.log' },
    { command: 'BASE_URL=http://127.0.0.1:8090 node scripts/g4-smoke.mjs', exitCode: 0, log: 'smoke.log' },
  ],
  exitCodeProvenance: 'Observed tool process results; log/assertion contents rechecked by verify-evidence.mjs.',
  unitAndApiCases: 704, g3BrowserAssertions: 26, productionCases: smokeCases,
  productionAssertions: 24, productionErrors: 0, services,
  economy: { scenarios: 6, invariants: 'PASS', pacing: 'FAIL', unchangedSourceFiles: 55,
    broadPayback: 'FAIL', newlyUnlockedPayback: 'PASS', groceryPaybackHours: payback.paybackHours },
  notRun: ['first-time human tutorial', 'human normal-play soak', 'three reference devices',
    'full-world stress', 'all adversarial quest combinations', 'public tunnel'],
  openQuestions: ['Q009', 'Q010'], tunnelStarted: false, publicDeployment: false,
};
writeFileSync('docs/evidence/mvp-final/final-validation.json', JSON.stringify(report, null, 2) + '\n');
console.log('Evidence PASS: 682 unit + 22 API cases, 26 G3 assertions, 24 production assertions, 55 source hashes; local stack healthy. Economy FAIL retained.');
