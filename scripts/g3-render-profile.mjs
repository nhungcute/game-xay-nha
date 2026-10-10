import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5190';
const out = 'docs/evidence/g3/render-performance';
const files = [
  'apps/web/src/game/GameLoop.ts', 'apps/web/src/game/render/EnvRenderer.ts',
  'apps/web/src/game/render/TerrainRenderer.ts', 'apps/web/src/game/assets/InstanceBatches.ts',
  'apps/web/src/game/assets/AssetManager.ts', 'apps/web/public/assets/manifest.json',
];
const sha = value => createHash('sha256').update(value).digest('hex');
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await readFile(file))])));
const output = {
  startedAt: new Date().toISOString(), base,
  scope: 'Read-only production files; browser-only renderer/GL wrappers. Existing offline server, untouched authored v2 templates, fresh browser context per map. No API/DB/deploy writes.',
  hashesBefore: await hashes(), maps: {},
};
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
output.browserVersion = browser.version();
try {
  for (const [kind, mapId] of [['city', 'city-coast-01'], ['farm', 'farm-valley-01']]) {
    const path = `apps/web/public/worlds/${mapId}/template.v2.json`, body = await readFile(path, 'utf8');
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**/worlds/farm-g1/template.v1.json', route => route.fulfill({ status: 200, contentType: 'application/json', body }));
    await page.goto(`${base}/?debug=1`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__debug?.metrics);
    await page.waitForTimeout(1800);
    const baseline = [];
    for (let index = 0; index < 8; index++) {
      baseline.push(await page.evaluate(() => window.__debug.metrics()));
      await page.waitForTimeout(250);
    }
    const profile = await page.evaluate(async () => {
      // Resolve the live instance through an existing method call; do not alter repository code.
      const moduleUrl = window.performance.getEntriesByType('resource').map(entry => entry.name)
        .find(name => new URL(name).pathname === '/src/game/GameLoop.ts');
      if (!moduleUrl) throw new Error('Loaded GameLoop module URL not found');
      const { GameLoop } = await import(moduleUrl);
      const originalMetrics = GameLoop.prototype.metrics;
      let loop;
      const capture = value => { loop = value; };
      GameLoop.prototype.metrics = function () { capture(this); return originalMetrics.call(this); };
      try { window.__debug.metrics(); } finally { GameLoop.prototype.metrics = originalMetrics; }
      if (!loop) throw new Error('Live GameLoop could not be captured');
      const renderer = loop.renderer, gl = renderer.getContext(), frames = [], inventory = [];
      const classify = object => {
        const name = object?.name ?? '';
        if (name.startsWith('terrain-')) return 'terrain';
        if (name.startsWith('road-tier-')) return 'road';
        if (object?.parent?.name === 'water-bodies') return 'water-and-foam';
        if (name === 'locked-zone-outlines') return 'zone-overlay';
        if (/^[^:]+:\d+:[^:]+$/.test(name)) return 'environment';
        return name || object?.type || 'unattributed';
      };
      loop.scene.traverse(object => {
        if (!object.isMesh && !object.isLine) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        inventory.push({ name: object.name, category: classify(object), type: object.type,
          instanceCount: object.isInstancedMesh ? object.count : null,
          castShadow: object.castShadow, receiveShadow: object.receiveShadow, frustumCulled: object.frustumCulled,
          geometry: object.geometry.uuid, groups: object.geometry.groups.length,
          materials: materials.map(material => ({ uuid: material.uuid, name: material.name, type: material.type,
            side: material.side, transparent: material.transparent, vertexColors: material.vertexColors,
            color: material.color?.getHexString() })),
        });
      });
      const originals = new Map(), originalRender = renderer.render, originalDirect = renderer.renderBufferDirect;
      let frame = null, active = null;
      const record = method => {
        if (!frame) return;
        const object = active?.object, category = classify(object);
        const key = `${active?.pass ?? 'unknown'}|${category}|${object?.name ?? ''}|${object?.geometry?.uuid ?? ''}`;
        frame.calls++;
        frame.methods[method] = (frame.methods[method] ?? 0) + 1;
        frame.byPass[active?.pass ?? 'unknown'] = (frame.byPass[active?.pass ?? 'unknown'] ?? 0) + 1;
        frame.byCategory[category] = (frame.byCategory[category] ?? 0) + 1;
        const item = frame.objects[key] ??= { pass: active?.pass ?? 'unknown', category,
          name: object?.name ?? '', geometry: object?.geometry?.uuid ?? '', calls: 0 };
        item.calls++;
      };
      // Actual submitted GL calls are authoritative. renderBufferDirect alone can skip empty meshes
      // and can submit two draws for transparent DoubleSide material, so it is used only for labels.
      for (const method of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        const original = gl[method]; originals.set(method, original);
        gl[method] = function (...args) { const value = original.apply(this, args); record(method); return value; };
      }
      renderer.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
        active = { object, pass: camera === loop.rig.camera ? 'main' : 'shadow' };
        try { return originalDirect.call(this, camera, scene, geometry, material, object, group); }
        finally { active = null; }
      };
      renderer.render = function (...args) {
        frame = { calls: 0, byPass: {}, byCategory: {}, methods: {}, objects: {} };
        const started = window.performance.now();
        try { return originalRender.apply(this, args); }
        finally {
          frame.instrumentedRenderCpuMs = window.performance.now() - started;
          frame.rendererInfoCalls = renderer.info.render.calls;
          frame.rendererInfoTriangles = renderer.info.render.triangles;
          frames.push(frame); frame = null;
        }
      };
      try {
        while (frames.length < 72) await new Promise(resolve => setTimeout(resolve, 50));
      } finally {
        renderer.render = originalRender; renderer.renderBufferDirect = originalDirect;
        for (const [method, original] of originals) gl[method] = original;
      }
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      return { frames, inventory, camera: window.__debug.cameraState(), snapshot: {
        mapId: loop.world.state.snapshot.mapId, templateVersion: loop.world.state.snapshot.templateVersion,
        buildings: loop.world.state.snapshot.buildings.length, bridges: loop.world.state.snapshot.bridges.length,
        crops: loop.world.state.snapshot.crops.length, environment: loop.world.state.env.length,
      }, webgl: { renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null,
        vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : null },
        note: 'Profiling renderCpuMs includes wrapper overhead. FPS is taken only before installing wrappers. Original methods restored before returning.' };
    });
    if (profile.snapshot.mapId !== mapId || profile.snapshot.templateVersion !== 2) throw new Error(`Wrong map: ${profile.snapshot.mapId}`);
    const frame = profile.frames.at(-1);
    const byCategoryAndPass = {};
    for (const item of Object.values(frame.objects)) {
      const row = byCategoryAndPass[item.category] ??= { main: 0, shadow: 0 };
      row[item.pass] = (row[item.pass] ?? 0) + item.calls;
    }
    const assets = {};
    for (const mesh of profile.inventory.filter(mesh => mesh.category === 'environment')) {
      const [assetId, zone] = mesh.name.split(':');
      const asset = assets[assetId] ??= { meshes: 0, zones: new Set(), geometries: new Set(), materials: new Set(), instanceSlotsAcrossParts: 0, mainCalls: 0, shadowCalls: 0 };
      asset.meshes++; asset.zones.add(zone); asset.geometries.add(mesh.geometry);
      mesh.materials.forEach(material => asset.materials.add(material.uuid));
      asset.instanceSlotsAcrossParts += mesh.instanceCount;
    }
    for (const item of Object.values(frame.objects).filter(item => item.category === 'environment')) {
      assets[item.name.split(':')[0]][`${item.pass}Calls`] += item.calls;
    }
    for (const asset of Object.values(assets)) {
      asset.zones = asset.zones.size; asset.parts = asset.geometries.size; delete asset.geometries;
      asset.materials = asset.materials.size;
      asset.instances = asset.instanceSlotsAcrossParts / asset.parts;
    }
    const mergedPartsEstimate = {};
    for (const pass of ['main', 'shadow']) {
      const env = Object.values(frame.objects).filter(item => item.pass === pass && item.category === 'environment');
      mergedPartsEstimate[pass] = new Set(env.map(item => item.name)).size;
    }
    const summary = { baselineMeanFps: baseline.reduce((sum, sample) => sum + sample.fps, 0) / baseline.length,
      measuredFrames: profile.frames.length, mainCallsMatchRendererInfo: profile.frames.every(frame => frame.byPass.main === frame.rendererInfoCalls),
      minimumCalls: Math.min(...profile.frames.map(frame => frame.calls)), maximumCalls: Math.max(...profile.frames.map(frame => frame.calls)),
      byCategoryAndPass, assets, hypotheticalEnvironmentCallsAfterOneMeshPerAssetZone: mergedPartsEstimate,
      hypotheticalTotalAfterOneMeshPerAssetZone: frame.calls - frame.byCategory.environment + mergedPartsEstimate.main + mergedPartsEstimate.shadow };
    const experiments = [];
    for (const regionSize of [2, 4]) experiments.push(await page.evaluate(async regionSize => {
      const moduleUrl = window.performance.getEntriesByType('resource').map(entry => entry.name)
        .find(name => new URL(name).pathname === '/src/game/GameLoop.ts');
      const { GameLoop } = await import(moduleUrl), originalMetrics = GameLoop.prototype.metrics;
      let loop;
      const capture = value => { loop = value; };
      GameLoop.prototype.metrics = function () { capture(this); return originalMetrics.call(this); };
      try { window.__debug.metrics(); } finally { GameLoop.prototype.metrics = originalMetrics; }
      const originals = [], groups = new Map(), clones = [];
      loop.scene.traverse(object => {
        if (!object.isInstancedMesh || !/^[^:]+:\d+:[^:]+$/.test(object.name)) return;
        originals.push({ mesh: object, parent: object.parent });
        const [asset, zoneText] = object.name.split(':'), zone = Number(zoneText);
        // Browser-only rendering buckets; simulation zones and all instance matrices stay unchanged.
        const region = Math.floor(zone % 8 / regionSize)
          + Math.floor(Math.floor(zone / 8) / regionSize) * (8 / regionSize);
        const key = `${asset}:${region}:${object.geometry.uuid}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(object);
      });
      let copiedInstances = 0, sourceInstances = 0, copiedMatrixComponents = 0;
      for (const [key, members] of groups) {
        const first = members[0], count = members.reduce((sum, mesh) => sum + mesh.count, 0);
        const merged = new first.constructor(first.geometry, first.material, count);
        merged.name = `profile-region:${key}`; merged.castShadow = first.castShadow;
        merged.receiveShadow = first.receiveShadow; merged.frustumCulled = first.frustumCulled;
        let offset = 0;
        for (const mesh of members) {
          const data = mesh.instanceMatrix.array.subarray(0, mesh.count * 16);
          merged.instanceMatrix.array.set(data, offset * 16);
          for (let i = 0; i < data.length; i++) {
            if (merged.instanceMatrix.array[offset * 16 + i] !== data[i]) throw new Error('Changed instance matrix');
            copiedMatrixComponents++;
          }
          offset += mesh.count; sourceInstances += mesh.count;
        }
        merged.count = count; copiedInstances += count; merged.instanceMatrix.needsUpdate = true;
        merged.computeBoundingSphere(); clones.push({ mesh: merged, parent: first.parent });
      }
      const samples = [];
      try {
        for (const { mesh } of originals) mesh.removeFromParent();
        for (const { mesh, parent } of clones) parent.add(mesh);
        await new Promise(resolve => setTimeout(resolve, 1600));
        for (let index = 0; index < 8; index++) {
          samples.push(window.__debug.metrics()); await new Promise(resolve => setTimeout(resolve, 250));
        }
      } finally {
        for (const { mesh } of clones) { mesh.removeFromParent(); mesh.dispose(); }
        for (const { mesh, parent } of originals) parent.add(mesh);
      }
      return { label: 'Isolated browser-only experiment, NOT production implementation or gate pass',
        change: `Rebatch the same environment asset/geometry across ${regionSize}×${regionSize} adjacent simulation zones, preserving every matrix and object instance. Geometry and materials remain shared. Original scene batches restored.`,
        regionSize,
        sourceBatches: originals.length, temporaryBatches: clones.length, sourceInstances, copiedInstances,
        copiedMatrixComponents, samples, restored: true };
    }, regionSize));
    output.maps[kind] = { path, templateSha256: sha(body), baseline, summary, profile, experiments, errors };
    console.log(`${kind}: ${frame.calls} actual GL calls; ${JSON.stringify(frame.byPass)}; main/info match ${summary.mainCallsMatchRendererInfo}; temporary region main calls ${experiments.map(experiment => `${experiment.regionSize}: ${experiment.samples.at(-1).drawCalls}`).join(', ')}`);
    await context.close();
  }
} finally {
  output.finishedAt = new Date().toISOString(); output.hashesAfter = await hashes();
  output.filesChangedDuringRun = files.filter(file => output.hashesBefore[file] !== output.hashesAfter[file]);
  await writeFile(`${out}/profile.json`, `${JSON.stringify(output, null, 2)}\n`);
  await browser.close();
}
