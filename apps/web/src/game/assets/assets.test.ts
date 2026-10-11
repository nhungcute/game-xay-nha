import { readFile } from 'node:fs/promises';
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

describe('actual placeholder GLB artifacts', () => {
  it('loads every model with valid triangles, bottom pivot, footprint bounds and explicit provenance', async () => {
    const manager = await setup();
    expect(manager.manifest).toHaveLength(74);
    expect(manager.manifest.filter(entry => !entry.placeholder).map(entry => entry.id).sort()).toEqual(AUTHORED_IDS);
    for (const entry of manager.manifest) {
      // Imported models (D029) arrive pre-fitted: one mesh, no load-time fitting; everything else is a generated placeholder.
      expect(entry.license).toBeTruthy(); expect(entry.source).toBeTruthy();
      const asset = manager.get(entry.id);
      expect(asset.parts.length).toBeGreaterThan(0);
      if (!entry.placeholder) {
        expect(entry.footprint).toBeTruthy();
        expect(asset.parts).toHaveLength(1); // one draw call per building
      }
      expect(asset.bounds.min.y).toBeCloseTo(0);
      let triangles = 0;
      for (const part of asset.parts) {
        const positions = part.geometry.getAttribute('position');
        triangles += positions.count / 3;
        expect(part.geometry.getAttribute('normal').count).toBe(positions.count);
        expect(part.geometry.getAttribute('color').count).toBe(positions.count);
        for (const number of positions.array) expect(Number.isFinite(number)).toBe(true);
      }
      expect(triangles).toBe(entry.triangles);
      const building = catalog.buildings[entry.id];
      if (building) {
        expect(asset.bounds.max.x - asset.bounds.min.x).toBeLessThanOrEqual(building.size[0] * 2);
        expect(asset.bounds.max.z - asset.bounds.min.z).toBeLessThanOrEqual(building.size[1] * 2);
      }
      expect(triangles).toBeLessThanOrEqual(entry.id.startsWith('tree') ? 800 : building ? 5000 : 300);
      if (!entry.placeholder) {
        const cap = modelPackConfig.models[entry.id]?.triangleCap;
        expect(cap).toBeDefined();
        expect(triangles).toBeLessThanOrEqual(cap!);
      }
      asset.release();
    }
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
  it('batches scenery per asset × map quadrant and keeps low plants out of the shadow pass (draw-call budget)', async () => {
    const manager = await setup(), scene = new Scene(), renderer = new EnvRenderer(scene, manager);
    const s = createState(createTestTemplate(), 1000);
    renderer.update(s);
    const all = meshes(scene), assets = new Set(s.env.map(e => e.assetId));
    expect(all.length).toBeLessThanOrEqual(assets.size * 4);
    for (const mesh of all) {
      const id = mesh.name.split(':').at(-1)!, handle = manager.get(id), height = handle.bounds.max.y - handle.bounds.min.y; handle.release();
      expect(mesh.castShadow).toBe(height >= 1.5);
    }
    expect(all.some(m => m.castShadow) && all.some(m => !m.castShadow)).toBe(true);
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
