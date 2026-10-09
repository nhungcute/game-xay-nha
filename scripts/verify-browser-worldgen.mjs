import { createHash } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDirectory = resolve(root, 'test-results', 'browser-worldgen');
const entryPoint = resolve(root, 'packages', 'tooling', 'src', 'browser-fixture.ts');
const hash = value => createHash('sha256').update(value).digest('hex');

async function browserExecutable() {
  if (process.env.BROWSER_EXECUTABLE) {
    await access(process.env.BROWSER_EXECUTABLE);
    return process.env.BROWSER_EXECUTABLE;
  }
  const candidates = [
    process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined,
    process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined,
    chromium.executablePath(),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* Try the next available browser. */ }
  }
  throw new Error('No Chromium executable found. Set BROWSER_EXECUTABLE or install the pinned Playwright browser.');
}

async function verify() {
  await mkdir(evidenceDirectory, { recursive: true });
  const nodeBundle = resolve(evidenceDirectory, 'node-worldgen.mjs');
  const browserBundle = resolve(evidenceDirectory, 'browser-worldgen.js');
  await build({ entryPoints: [entryPoint], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: nodeBundle });
  await build({ entryPoints: [entryPoint], bundle: true, platform: 'browser', format: 'iife', globalName: 'WorldgenFixture', target: 'es2022', outfile: browserBundle });
  const { runWorldgenFixture } = await import(pathToFileURL(nodeBundle).href);
  const nodeResult = runWorldgenFixture();
  const nodeJson = JSON.stringify(nodeResult);
  const executablePath = await browserExecutable();
  const browser = await chromium.launch({ executablePath, headless: true });
  const browserVersion = browser.version();
  const errors = [];
  let browserJson;
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('about:blank');
    await page.addScriptTag({ path: browserBundle });
    browserJson = await page.evaluate('JSON.stringify(WorldgenFixture.runWorldgenFixture())');
  } finally { await browser.close(); }
  const equal = browserJson === nodeJson;
  const report = {
    check: 'G0 pure worldgen Node/Chromium parity; no rendered game or G1 acceptance',
    passed: equal && errors.length === 0,
    recordedAtUtc: new Date().toISOString(),
    nodeVersion: process.version,
    browserVersion,
    browserExecutable: executablePath,
    fixtures: nodeResult.cases.map(({ mapKind, seed, generatorVersion, environment }) => ({ mapKind, seed, generatorVersion, count: environment.length, sha256: hash(JSON.stringify(environment)) })),
    zoneOrderCases: nodeResult.zoneOrderCases,
    nodeSha256: hash(nodeJson),
    browserSha256: hash(browserJson),
    errors,
  };
  await writeFile(resolve(evidenceDirectory, 'node-golden.json'), nodeJson + '\n');
  await writeFile(resolve(evidenceDirectory, 'browser-golden.json'), browserJson + '\n');
  await writeFile(resolve(evidenceDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  if (!report.passed) throw new Error(`Node/browser worldgen mismatch or browser errors; see ${resolve(evidenceDirectory, 'report.json')}`);
  console.log(`PASS ${nodeResult.cases.length} Node/browser worldgen fixtures; ${nodeResult.zoneOrderCases.length} reversed-zone cases; Chromium ${browserVersion}; Node ${process.version}`);
  console.log(`Evidence: ${resolve(evidenceDirectory, 'report.json')}`);
}

try { await verify(); }
catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
