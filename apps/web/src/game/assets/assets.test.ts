import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { Box3, InstancedMesh, Scene } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { catalog } from '@xay-nha/content';
import { WorldTemplateSchema } from '@xay-nha/contracts';
import { createTestTemplate, generateEnvironment } from '@xay-nha/worldgen';
import { cloneState, createState } from '@xay-nha/sim';
import { AssetManager, type AssetManifestEntry } from './AssetManager';
import { BuildingRenderer } from '../render/BuildingRenderer';
import { CropRenderer } from '../render/CropRenderer';
import { EnvRenderer } from '../render/EnvRenderer';
import { GhostRenderer } from '../render/GhostRenderer';
import { TREE_LOD } from '../render/treeLod';
import { keepInLow } from '../quality';

// Imported GLBs are texture-less (vertex colours only); GLTFLoader still probes `self` for image decoding.
// Node has no image decoder, so texture loads would fail softly — geometry, the subject of these tests, loads normally.
(globalThis as { self?: unknown }).self ??= globalThis;
const assetRoot = new URL('../../../public/assets/', import.meta.url);
const consoleError = console.error.bind(console);
vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { if (!String(args[0]).includes("Couldn't load texture")) consoleError(...args); });
async function parse(entry: AssetManifestEntry): Promise<GLTF> {
  const buffer = await readFile(new URL(entry.file, assetRoot));
  return new GLTFLoader().parseAsync(new Uint8Array(buffer).buffer, '');
}
async function setup() {
  const document = JSON.parse(await readFile(new URL('manifest.json', assetRoot), 'utf8')) as { assets: AssetManifestEntry[] };
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(document)));
  const loaderSpy = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(url => {
    const entry = document.assets.find(asset => url.endsWith(asset.file));
    if (!entry) throw new Error(`Missing manifest file ${url}`);
    return parse(entry);
  });
  const manager = new AssetManager();
  try { await manager.load(); } finally { fetchSpy.mockRestore(); loaderSpy.mockRestore(); }
  return manager;
}
function meshes(scene: Scene): InstancedMesh[] {
  const result: InstancedMesh[] = [];
  scene.traverse(object => { if (object instanceof InstancedMesh) result.push(object); });
  return result;
}
// D029: buildings imported from the owner's 21-model pack (silo keeps its placeholder — see model-pack.config.json).
const modelPackConfig = JSON.parse(await readFile(new URL('../../../../../scripts/model-pack.config.json', import.meta.url), 'utf8')) as {
  models: Record<string, { triangleCap: number }>;
};
const AUTHORED_IDS = Object.keys(modelPackConfig.models).sort();
// D030: 12 tree/bush ids (near + far LOD) imported from map/tree by scripts/import-trees.mjs.
const treesConfig = JSON.parse(await readFile(new URL('../../../../../scripts/trees.config.json', import.meta.url), 'utf8')) as {
  parameters: { nearLod: { count: number; radiusM: number }; farLod: { recomputeMoveM: number; recomputeYawDeg: number }; triangleCaps: Record<string, { near: number; far: number }>; atlas: { leafSlotPx: number; barkSlotPx: number } };
  models: Record<string, { family: string; nearTriangles: number; farTriangles: number; file: string; farFile: string; farBytes: number }>;
};
const TREE_IDS = Object.keys(treesConfig.models).filter(id => !id.endsWith('_far')).sort();

/** PNG IHDR dimensions of the first embedded image of a GLB (textures are committed, Node cannot decode pixels). */
async function glbTextureSize(manifestFile: string): Promise<{ width: number; height: number }> {
  const bytes = await readFile(new URL(manifestFile, assetRoot));
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as {
    images: { bufferView: number }[]; bufferViews: { byteOffset?: number; byteLength: number }[];
  };
  const view = json.bufferViews[json.images[0]!.bufferView]!;
  const png = bytes.subarray(20 + jsonLength + 8 + (view.byteOffset ?? 0));
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function farTextureCoverage(manifestFile: string): Promise<number[]> {
  const bytes = await readFile(new URL(manifestFile, assetRoot));
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as {
    images: { bufferView: number }[]; bufferViews: { byteOffset?: number; byteLength: number }[];
  };
  const view = json.bufferViews[json.images[0]!.bufferView]!;
  const png = bytes.subarray(20 + jsonLength + 8 + (view.byteOffset ?? 0), 20 + jsonLength + 8 + (view.byteOffset ?? 0) + view.byteLength);
  let offset = 8, width = 0, height = 0, colorType = 0;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8), data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]!; }
    if (type === 'IDAT') idat.push(data);
    offset += length + 12;
    if (type === 'IEND') break;
  }
  expect(colorType).toBe(6);
  const channels = 4, stride = width * channels, packed = inflateSync(Buffer.concat(idat)), raw = Buffer.alloc(stride * height);
  const paeth = (a: number, b: number, c: number) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) for (let x = 0; x < stride; x++) {
    const f = packed[y * (stride + 1)]!, value = packed[y * (stride + 1) + x + 1]!, left = x >= 4 ? raw[y * stride + x - 4]! : 0;
    const up = y ? raw[(y - 1) * stride + x]! : 0, ul = y && x >= 4 ? raw[(y - 1) * stride + x - 4]! : 0;
    raw[y * stride + x] = (value + (f === 1 ? left : f === 2 ? up : f === 3 ? Math.floor((left + up) / 2) : f === 4 ? paeth(left, up, ul) : 0)) & 255;
  }
  const tile = width / 2;
  return [0, 1, 2, 3].map(index => {
    let covered = 0; const colors = new Set<string>();
    for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) {
      const at = (Math.floor(index / 2) * tile + y) * stride + (index % 2 * tile + x) * 4;
      if (raw[at + 3]! >= 128) { covered++; colors.add(`${raw[at]},${raw[at + 1]},${raw[at + 2]}`); }
    }
    const ratio = covered / (tile * tile);
    expect(ratio, `${manifestFile} tile ${index} alpha coverage`).toBeGreaterThanOrEqual(0.1);
    expect(ratio, `${manifestFile} tile ${index} alpha coverage`).toBeLessThanOrEqual(0.8);
    expect(colors.size, `${manifestFile} tile ${index} distinct colors`).toBeGreaterThanOrEqual(2);
    return ratio;
  });
}

describe('actual placeholder GLB artifacts', () => {
  it('loads every model with valid triangles, bottom pivot, footprint bounds and explicit provenance', async () => {
    const manager = await setup();
    expect(manager.manifest).toHaveLength(74 + TREE_IDS.length); // near entries replace placeholders, far ones are added
    expect(manager.manifest.filter(entry => !entry.placeholder).map(entry => entry.id).sort())
      .toEqual([...AUTHORED_IDS, ...TREE_IDS, ...TREE_IDS.map(id => `${id}_far`)].sort());
    for (const entry of manager.manifest) {
      // Imported models (D029/D030) arrive pre-fitted; everything else is a generated placeholder.
      expect(entry.license).toBeTruthy(); expect(entry.source).toBeTruthy();
      const asset = manager.get(entry.id);
      expect(asset.parts.length).toBeGreaterThan(0);
      if (!entry.placeholder) {
        if (catalog.buildings[entry.id]) expect(entry.footprint).toBeTruthy();
        else expect(asset.parts).toHaveLength(1); // one draw call per imported building / tree LOD level
      }
      expect(asset.bounds.min.y).toBeCloseTo(0);
      const tree = treesConfig.models[entry.id.replace(/_far$/, '')];
      let triangles = 0;
      for (const part of asset.parts) {
        const positions = part.geometry.getAttribute('position');
        const index = part.geometry.getIndex();
        triangles += (index ? index.count : positions.count) / 3; // D030 foliage is indexed; D029 buildings are not
        expect(part.geometry.getAttribute('normal').count).toBe(positions.count);
        if (tree) expect(part.geometry.getAttribute('uv').count).toBe(positions.count); // textured foliage
        else expect(part.geometry.getAttribute('color').count).toBe(positions.count);
        for (const number of positions.array) expect(Number.isFinite(number)).toBe(true);
      }
      expect(triangles).toBe(entry.triangles);
      const building = catalog.buildings[entry.id];
      if (building) {
        expect(asset.bounds.max.x - asset.bounds.min.x).toBeLessThanOrEqual(building.size[0] * 2);
        expect(asset.bounds.max.z - asset.bounds.min.z).toBeLessThanOrEqual(building.size[1] * 2);
      }
      const cap = tree
        ? entry.id.endsWith('_far') ? treesConfig.parameters.triangleCaps[tree.family]!.far : treesConfig.parameters.triangleCaps[tree.family]!.near
        : entry.id.startsWith('tree') ? 800 : building ? 5000 : 300;
      expect(triangles).toBeLessThanOrEqual(cap);
      if (!entry.placeholder && catalog.buildings[entry.id]) {
        const modelCap = modelPackConfig.models[entry.id]?.triangleCap;
        expect(modelCap).toBeDefined();
        expect(triangles).toBeLessThanOrEqual(modelCap!);
      }
      asset.release();
    }
    manager.dispose();
  });
  it('keeps D030 tree LOD parameters, licence layout and texture budgets in sync with the import config', async () => {
    const manager = await setup();
    expect(TREE_LOD).toEqual({
      nearCount: treesConfig.parameters.nearLod.count,
      nearRadiusM: treesConfig.parameters.nearLod.radiusM,
      recomputeMoveM: treesConfig.parameters.farLod.recomputeMoveM,
      recomputeYawDeg: treesConfig.parameters.farLod.recomputeYawDeg,
    });
    for (const [id, model] of Object.entries(treesConfig.models)) {
      const entry = manager.manifest.find(candidate => candidate.id === id)!;
      // CC-* provenance: author, source, url, license and the "modified" notice, plus the far-LOD link.
      expect(entry.author).toBeTruthy(); expect(entry.source).toContain('sketchfab.com');
      expect(entry.url).toContain('sketchfab.com'); expect(entry.license).toMatch(/^CC-/);
      expect(entry.modified).toBe(true); expect(entry.lod).toEqual({ far: `${id}_far` });
      expect(model.farBytes).toBeGreaterThanOrEqual(8 * 1024);
      if (model.family === 'bush') expect(model.farBytes).toBeLessThanOrEqual(60 * 1024);
      expect(await farTextureCoverage(model.farFile.replace(/^apps\/web\/public\/assets\//, ''))).toHaveLength(4);
      // Conifer derivatives are CC-BY-SA: they must live in their own directory beside LICENSE.md.
      if (model.family === 'conifer') {
        expect(entry.license).toBe('CC-BY-SA-4.0');
        expect(entry.file).toContain('env-by-sa/');
      } else {
        expect(entry.file).not.toContain('env-by-sa/');
      }
      // Foliage atlas: foliage slot ≤ 512 px, bark slot ≤ 128 px, packed into one ≤ 512-wide texture.
      const { width, height } = await glbTextureSize(entry.file);
      expect(width).toBeLessThanOrEqual(treesConfig.parameters.atlas.leafSlotPx);
      expect(height).toBeLessThanOrEqual(treesConfig.parameters.atlas.leafSlotPx + treesConfig.parameters.atlas.barkSlotPx);
    }
    await expect(readFile(new URL('models/env-by-sa/LICENSE.md', assetRoot), 'utf8')).resolves.toMatch(/CC-BY-SA 4\.0/);
    manager.dispose();
  });
  it('keeps the imported models byte-identical to what the deterministic import script generates', async () => {
    // Skips with a notice (exit 0) when the 283 MB source pack is absent, e.g. in CI.
    const output = execFileSync('node', ['scripts/import-model-pack.mjs', '--check'], { encoding: 'utf8', timeout: 25_000 });
    expect(output).toMatch(/--check PASS|bỏ qua/);
  });
  it('does not dispose shared GLB resources while retained handles exist', async () => {
    const manager = await setup(), first = manager.get('farmhouse'), second = manager.get('farmhouse');
    const geometryDispose = vi.fn(), materialDispose = vi.fn();
    first.parts[0]!.geometry.addEventListener('dispose', geometryDispose);
    const material = first.parts[0]!.material;
    (Array.isArray(material) ? material[0]! : material).addEventListener('dispose', materialDispose);
    first.release(); first.release();
    expect(geometryDispose).not.toHaveBeenCalled();
    manager.dispose();
    expect(geometryDispose).not.toHaveBeenCalled();
    second.release();
    expect(geometryDispose).toHaveBeenCalledTimes(1); expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(() => manager.get('farmhouse')).toThrow('disposed');
  });
  it('clears env instances and renderer buffers without disposing shared GLB geometry', async () => {
    const manager = await setup(), scene = new Scene(), renderer = new EnvRenderer(scene, manager);
    const s = createState(createTestTemplate(), 1000), handle = manager.get('tree_deciduous_01');
    const disposed = vi.fn(); handle.parts[0]!.geometry.addEventListener('dispose', disposed);
    renderer.update(s); expect(meshes(scene).reduce((sum, mesh) => sum + mesh.count, 0)).toBe(s.env.length);
    const changed = cloneState(s); changed.snapshot.delta.removedEnvIds.push(s.env[0]!.id);
    renderer.update(changed); expect(meshes(scene).reduce((sum, mesh) => sum + mesh.count, 0)).toBe(s.env.length - 1);
    renderer.dispose(); expect(scene.children).toHaveLength(0); expect(disposed).not.toHaveBeenCalled();
    handle.release(); manager.dispose(); expect(disposed).toHaveBeenCalledTimes(1);
  });
  it('batches scenery per asset × LOD × map quadrant and keeps far billboards and low plants out of the shadow pass', async () => {
    const manager = await setup(), scene = new Scene(), renderer = new EnvRenderer(scene, manager);
    const s = createState(createTestTemplate(), 1000);
    renderer.update(s);
    renderer.frame(0.016, { x: 128, z: 128, yawDeg: 0 }); // centre the camera so the near LOD actually populates
    const all = meshes(scene), assets = new Set(s.env.map(e => e.assetId));
    expect(all.length).toBeLessThanOrEqual(assets.size * 2 * 4);
    for (const mesh of all) {
      const id = mesh.name.split(':').at(-1)!, handle = manager.get(id), height = handle.bounds.max.y - handle.bounds.min.y; handle.release();
      expect(mesh.castShadow).toBe(!id.endsWith('_far') && height >= 1.5);
    }
    expect(all.some(m => m.castShadow) && all.some(m => !m.castShadow)).toBe(true);
    renderer.dispose(); manager.dispose();
  });
  it('picks the TREE_LOD.nearCount closest instances for the near LOD, keeps the rest far, and only re-partitions past the hysteresis', async () => {
    const manager = await setup(), scene = new Scene(), renderer = new EnvRenderer(scene, manager);
    const template = WorldTemplateSchema.parse(JSON.parse(await readFile(new URL('worlds/farm-valley-01/template.v2.json', new URL('../', assetRoot)), 'utf8')));
    const s = createState(template, 1000, generateEnvironment(template));
    const lodCount = (lod: 'near' | 'far') => meshes(scene).filter(mesh => mesh.name.includes(`:${lod}:`)).reduce((sum, mesh) => sum + mesh.count, 0);
    renderer.update(s);
    renderer.frame(0.016, { x: 128, z: 128, yawDeg: 0 });
    const total = s.env.length, near = lodCount('near');
    expect(near).toBe(Math.min(TREE_LOD.nearCount, total));
    expect(near + lodCount('far')).toBe(total);
    // Camera below the hysteresis: no re-partition (rebuild counter unchanged), counts stay stable.
    const rebuilds = renderer.lodRebuilds;
    renderer.frame(0.016, { x: 129, z: 129, yawDeg: 5 });
    expect(renderer.lodRebuilds).toBe(rebuilds);
    expect(lodCount('near')).toBe(near);
    // Beyond 4 m: one re-partition; the nearest count is unchanged but the selection follows the camera.
    renderer.frame(0.016, { x: 200, z: 200, yawDeg: 5 });
    expect(renderer.lodRebuilds).toBe(rebuilds + 1);
    expect(lodCount('near')).toBe(near);
    renderer.frame(0.016, { x: 200, z: 200, yawDeg: 5 });
    expect(renderer.lodRebuilds).toBe(rebuilds + 1); // standing still never recomputes
    // Low graphics: far LOD only.
    renderer.setQuality('low');
    expect(lodCount('near')).toBe(0);
    expect(lodCount('far')).toBe(total - s.env.filter(e => !keepInLow(e.assetId, e.id)).length);
    renderer.dispose(); manager.dispose();
  });
  it('removes cleared instances from both LOD batches', async () => {
    const manager = await setup(), scene = new Scene(), renderer = new EnvRenderer(scene, manager);
    const template = WorldTemplateSchema.parse(JSON.parse(await readFile(new URL('worlds/farm-valley-01/template.v2.json', new URL('../', assetRoot)), 'utf8')));
    const s = createState(template, 1000, generateEnvironment(template));
    renderer.update(s);
    renderer.frame(0.016, { x: 128, z: 128, yawDeg: 0 });
    const total = () => meshes(scene).reduce((sum, mesh) => sum + mesh.count, 0);
    const before = total();
    const changed = cloneState(s);
    const removed = s.env[0]!;
    changed.snapshot.delta.removedEnvIds.push(removed.id);
    renderer.update(changed);
    expect(total()).toBe(before - 1);
    expect(meshes(scene).filter(mesh => mesh.name.includes(':near:')).reduce((sum, mesh) => sum + mesh.count, 0)
      + meshes(scene).filter(mesh => mesh.name.includes(':far:')).reduce((sum, mesh) => sum + mesh.count, 0)).toBe(before - 1);
    renderer.dispose(); manager.dispose();
  });
  it('low graphics drops flowers/reeds, thins bushes and merges batches; switching back restores everything', async () => {
    const manager = await setup(), scene = new Scene(), renderer = new EnvRenderer(scene, manager);
    const template = WorldTemplateSchema.parse(JSON.parse(await readFile(new URL('worlds/farm-valley-01/template.v2.json', new URL('../', assetRoot)), 'utf8')));
    const s = createState(template, 1000, generateEnvironment(template)), total = () => meshes(scene).reduce((sum, mesh) => sum + mesh.count, 0);
    renderer.update(s); const high = total();
    expect(s.env.some(e => e.assetId.startsWith('flower'))).toBe(true);
    renderer.setQuality('low');
    const low = meshes(scene), assets = new Set(low.map(m => m.name.split(':').at(-1)));
    expect(low.length).toBe(assets.size);
    expect([...assets].some(id => id!.startsWith('flower') || id!.startsWith('reed'))).toBe(false);
    const bushes = s.env.filter(e => e.assetId.startsWith('bush')).length, kept = low.filter(m => m.name.includes('bush')).reduce((n, m) => n + m.count, 0);
    if (bushes > 10) { expect(kept).toBeGreaterThan(bushes * 0.3); expect(kept).toBeLessThan(bushes * 0.7); }
    expect(total()).toBeLessThan(high);
    renderer.setQuality('high'); expect(total()).toBe(high);
    renderer.dispose(); manager.dispose();
  });
  it('switches construction scaffolds to GLB buildings and removes demolished instances', async () => {
    const manager = await setup(), scene = new Scene(), renderer = new BuildingRenderer(scene, manager);
    const s = createState(createTestTemplate(), 1000, []);
    s.snapshot.buildings.push({ id: 'b_1', defId: 'farmhouse', anchor: [72, 50], rotation: 1,
      placedAt: 1000, buildEndsAt: 61000, status: 'CONSTRUCTING', cashPaid: 500,
      materialsPaid: { cash: 500, wood: 10, stone: 5 }, investedValue: 750 });
    renderer.update(s); expect(meshes(scene)[0]!.name).toContain('construction_scaffold');
    s.snapshot.buildings[0]!.status = 'ACTIVE'; renderer.update(s);
    expect(meshes(scene)[0]!.name).toContain('farmhouse');
    for (let count = 0; count < 50; count++) renderer.update(s);
    // One instanced mesh per material of the (authored, fitted) farmhouse — never one per update.
    const farmhouse = manager.get('farmhouse'), parts = farmhouse.parts.length; farmhouse.release();
    expect(parts).toBeLessThanOrEqual(2);
    expect(meshes(scene)).toHaveLength(parts);
    expect(new Box3().setFromObject(scene).isEmpty()).toBe(false);
    s.snapshot.buildings = []; renderer.update(s); expect(meshes(scene)).toHaveLength(0);
    renderer.dispose(); manager.dispose(); expect(scene.children).toHaveLength(0);
  });
  it('renders all three crop stages from passed server time and clears harvested plants', async () => {
    const manager = await setup(), scene = new Scene(), renderer = new CropRenderer(scene, manager);
    const s = createState(createTestTemplate(), 1000, []);
    s.snapshot.crops.push({ cropId: 'rice', cell: [72, 50], plantedAt: 1000, readyAt: 11000 });
    renderer.update(s); expect(meshes(scene)[0]!.name).toContain('rice_seed');
    s.snapshot.serverTime = 6000; renderer.update(s); expect(meshes(scene)[0]!.name).toContain('rice_growing');
    s.snapshot.serverTime = 11000; renderer.update(s); expect(meshes(scene)[0]!.name).toContain('rice_ripe');
    s.snapshot.crops = []; renderer.update(s); expect(meshes(scene)).toHaveLength(0);
    renderer.dispose(); manager.dispose();
  });
  it('pools one ghost per definition and exactly three materials across fifty full tool cycles', async () => {
    const manager = await setup(), scene = new Scene(), renderer = new GhostRenderer(scene, manager);
    const state = createState(createTestTemplate(), 1000, []);
    const resources = () => {
      const geometryIds = new Set<string>(), materialIds = new Set<string>(); let objects = 0;
      scene.traverse(object => {
        if ('isMesh' in object && object.isMesh) {
          const mesh = object as import('three').Mesh; objects++;
          geometryIds.add(mesh.geometry.uuid);
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materialIds.add(material.uuid);
        }
      });
      return { objects, geometries: geometryIds.size, materials: materialIds.size };
    };
    const statuses = ['valid', 'warning', 'invalid'] as const;
    for (const def of Object.values(catalog.buildings)) renderer.preview(def.id, [72, 50], 0, state, 'valid');
    const warm = resources();
    for (let cycle = 0; cycle < 50; cycle++) {
      for (const def of Object.values(catalog.buildings)) {
        renderer.preview(def.id, [72, 50], (cycle % 4) as 0 | 1 | 2 | 3, state, statuses[cycle % 3]!);
        renderer.hide();
      }
    }
    expect(resources().objects).toBe(warm.objects);
    expect(resources().geometries).toBe(warm.geometries);
    expect(resources().materials).toBeLessThanOrEqual(3);
    renderer.dispose(); expect(scene.children).toHaveLength(0); manager.dispose();
  });
});
