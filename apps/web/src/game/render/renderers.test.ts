import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CellFlag, GRID, Surface, cellIndex, vertIndex } from '@xay-nha/contracts';
import { createState } from '@xay-nha/sim';
import { createTestTemplate } from '@xay-nha/worldgen';
import { TerrainRenderer } from './TerrainRenderer';
import { WaterRenderer } from './WaterRenderer';
import { RoadRenderer } from './RoadRenderer';
import { EmbankRenderer } from './EmbankRenderer';
import { BridgeRenderer } from './BridgeRenderer';
import { OverlayRenderer } from './OverlayRenderer';
import { globalNormal, heightAt, neighborMask } from './geometry';

function setup() { return createState(createTestTemplate('farm'), 1_000_000); }

describe('shared terrain geometry', () => {
  it('samples adaptive terrain triangles including edges of the world', () => {
    const heights = new Int16Array(129 * 129);
    heights[vertIndex(1, 1)] = 10;
    expect(heightAt(heights, 1, 1)).toBe(0); // BC has the smaller endpoint difference.
    heights[vertIndex(0, 0)] = 10;
    expect(heightAt(heights, 1, 1)).toBe(1); // AD now has the smaller endpoint difference.
    expect(heightAt(heights, -2, -2)).toBe(1);
    heights[vertIndex(128, 128)] = 30;
    expect(heightAt(heights, 256, 256)).toBe(3);
  });
  it('uses global neighboring heights for the same normal at a chunk boundary', () => {
    const s = setup(); s.heights[vertIndex(16, 17)] = 80;
    const normal = globalNormal(s.heights, 16, 16, new THREE.Vector3());
    expect(normal.length()).toBeCloseTo(1);
    const scene = new THREE.Scene(), renderer = new TerrainRenderer(scene); renderer.update(s);
    const a = renderer.meshes[0]!.geometry.getAttribute('normal'), b = renderer.meshes[1]!.geometry.getAttribute('normal');
    expect([a.getX(16 * 17 + 16), a.getY(16 * 17 + 16), a.getZ(16 * 17 + 16)])
      .toEqual([b.getX(16 * 17), b.getY(16 * 17), b.getZ(16 * 17)]);
    renderer.dispose();
  });
  it('reuses all chunk geometries and buffers during fifty terrain edits', () => {
    const s = setup(), scene = new THREE.Scene(), renderer = new TerrainRenderer(scene); renderer.update(s);
    const geometries = renderer.meshes.map(mesh => mesh.geometry);
    const arrays = geometries.map(geometry => geometry.getAttribute('position').array);
    for (let n = 0; n < 50; n++) {
      s.heights[vertIndex(73, 51)] = 50 + n % 2 * 5;
      renderer.update(s, [28]); renderer.animate(0.2);
    }
    expect(renderer.meshes).toHaveLength(64);
    renderer.meshes.forEach((mesh, index) => { expect(mesh.geometry).toBe(geometries[index]); expect(mesh.geometry.getAttribute('position').array).toBe(arrays[index]); });
    expect(renderer.stats.zonesRebuilt).toBeGreaterThan(64);
    expect(renderer.stats.maxRebuildMs).toBeGreaterThanOrEqual(renderer.stats.lastRebuildMs);
    renderer.dispose(); expect(scene.children).toHaveLength(0);
  });
  it('interpolates visual heights to simulation targets in exactly 200 ms without modifying state', () => {
    const s = setup(), renderer = new TerrainRenderer(new THREE.Scene()); renderer.update(s); renderer.animate(0.2);
    const old = renderer.sampleHeight(146, 102);
    s.heights[vertIndex(73, 51)] = 60;
    renderer.update(s, [28]); expect(renderer.sampleHeight(146, 102)).toBe(old);
    renderer.animate(0.1); expect(renderer.sampleHeight(146, 102)).toBeCloseTo((old + 6) / 2);
    renderer.animate(0.1); expect(renderer.sampleHeight(146, 102)).toBe(6);
    expect(s.heights[vertIndex(73, 51)]).toBe(60);
    renderer.dispose();
  });
  it('only rebuilds changed chunks and their normal-sharing neighbors', () => {
    const s = setup(), renderer = new TerrainRenderer(new THREE.Scene()); renderer.update(s); renderer.animate(0.2);
    const versions = renderer.meshes.map(mesh => (mesh.geometry.getAttribute('position') as THREE.BufferAttribute).version);
    renderer.update(s, [28]);
    expect((renderer.meshes[0]!.geometry.getAttribute('position') as THREE.BufferAttribute).version).toBe(versions[0]);
    for (const zone of [28, 27, 29, 20, 36]) expect((renderer.meshes[zone]!.geometry.getAttribute('position') as THREE.BufferAttribute).version).toBeGreaterThan(versions[zone]!);
    renderer.dispose();
  });
});

describe('pooled road, bank, bridge and overlay rendering', () => {
  it('road masks connect active bridge spans and exclude constructing bridges', () => {
    const s = setup(), cell: [number, number] = [72, 56];
    s.roadTier[cellIndex(72, 55)] = 1;
    expect(neighborMask(s, cell, new Set())).toBe(1);
    expect(neighborMask(s, cell, new Set([cellIndex(73, 56)]))).toBe(3);
  });
  it('reuses road GPU attributes while tier/count changes and disposes only owned resources', () => {
    const s = setup(), scene = new THREE.Scene(), renderer = new RoadRenderer(scene); renderer.update(s);
    const meshes = scene.children as THREE.InstancedMesh[];
    const geometry = meshes[0]!.geometry, corners = geometry.getAttribute('roadCorners').array;
    const dispose = vi.fn(); geometry.addEventListener('dispose', dispose);
    for (let n = 0; n < 50; n++) { s.roadTier[cellIndex(72, 50)] = 1 + n % 3; renderer.update(s); }
    expect(meshes[0]!.geometry).toBe(geometry); expect(geometry.getAttribute('roadCorners').array).toBe(corners);
    expect(scene.children).toHaveLength(3); expect(dispose).not.toHaveBeenCalled();
    renderer.dispose(); expect(dispose).toHaveBeenCalledOnce(); expect(scene.children).toHaveLength(0);
  });
  it('initial world contains no player-built banks or bridges', () => {
    const s = setup(), scene = new THREE.Scene(), banks = new EmbankRenderer(scene), bridges = new BridgeRenderer(scene);
    banks.update(s); bridges.update(s);
    for (const child of scene.children) expect((child as THREE.InstancedMesh).count).toBe(0);
    banks.dispose(); bridges.dispose(); expect(scene.children).toHaveLength(0);
  });
  it('embankment emits one wall per water-facing edge and updates in place', () => {
    const s = setup(), scene = new THREE.Scene(), renderer = new EmbankRenderer(scene);
    s.flags[cellIndex(72, 50)] = CellFlag.EMBANKED;
    s.surface[cellIndex(71, 50)] = s.surface[cellIndex(72, 49)] = Surface.WATER;
    renderer.update(s);
    const mesh = scene.getObjectByName('embank-walls') as THREE.InstancedMesh;
    expect(mesh.count).toBe(2);
    const geometry = mesh.geometry;
    s.flags[cellIndex(72, 50)] = 0; renderer.update(s);
    expect(mesh.count).toBe(0); expect(mesh.geometry).toBe(geometry);
    renderer.dispose();
  });
  it('bridge renderer switches pooled construction modules to completed material', () => {
    const s = setup(), scene = new THREE.Scene(), renderer = new BridgeRenderer(scene);
    s.snapshot.bridges.push({ id: 'br_test', typeId: 'bridge_wood', a: [72, 56], b: [76, 56], deckHeightDm: 55,
      placedAt: 1_000_000, buildEndsAt: 1_180_000, status: 'CONSTRUCTING', cashPaid: 240,
      materialsPaid: { cash: 240, wood: 15, stone: 0 }, investedValue: 465 });
    renderer.update(s);
    const scaffold = scene.getObjectByName('bridge-modules-3') as THREE.InstancedMesh;
    const active = scene.getObjectByName('bridge-modules-0') as THREE.InstancedMesh;
    expect(scaffold.count).toBeGreaterThan(0); expect(active.count).toBe(0);
    s.snapshot.bridges[0]!.status = 'ACTIVE'; renderer.update(s);
    expect(scaffold.count).toBe(0); expect(active.count).toBeGreaterThan(0);
    renderer.dispose(); expect(scene.children).toHaveLength(0);
  });
  it('switching fifty previews uses one geometry and exactly three shared materials', () => {
    const s = setup(), scene = new THREE.Scene(), renderer = new OverlayRenderer(scene); renderer.update(s);
    const mesh = scene.getObjectByName('pooled-cell-preview') as THREE.Mesh;
    const geometry = mesh.geometry, materials = new Set<THREE.Material>();
    const dispose = vi.fn(); geometry.addEventListener('dispose', dispose);
    for (let n = 0; n < 50; n++) {
      renderer.preview([[72, 50], [73, 50]], s, (['valid', 'warning', 'invalid'] as const)[n % 3]!);
      materials.add(mesh.material as THREE.Material); expect(mesh.geometry).toBe(geometry);
      renderer.hide(); expect(mesh.visible).toBe(false);
    }
    expect(materials.size).toBe(3); expect(dispose).not.toHaveBeenCalled();
    renderer.dispose(); expect(dispose).toHaveBeenCalledOnce(); expect(scene.children).toHaveLength(0);
  });
  it('overlay truncates previews to command area limit and filters map bounds', () => {
    const s = setup(), scene = new THREE.Scene(), renderer = new OverlayRenderer(scene);
    renderer.preview(Array.from({ length: GRID * GRID }, (_, index) => [index % GRID, Math.floor(index / GRID)]), s, 'valid');
    const mesh = scene.getObjectByName('pooled-cell-preview') as THREE.Mesh;
    expect(mesh.geometry.drawRange.count).toBe(256 * 6);
    renderer.preview([[-1, 0], [128, 0]], s, 'invalid'); expect(mesh.visible).toBe(false);
    renderer.dispose();
  });
});

describe('true water geometry and ownership', () => {
  it('creates subdivided river meshes with visible depth colors and no image textures', () => {
    const s = setup(), scene = new THREE.Scene(), renderer = new WaterRenderer(scene); renderer.update(s);
    const water = scene.getObjectByName('water-geometry') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(water.geometry.getAttribute('position').count).toBeGreaterThan(6);
    expect(water.material.map).toBeNull();
    const colors = water.geometry.getAttribute('color');
    const colorValues = new Set(Array.from({ length: colors.count }, (_, index) => colors.getX(index)));
    expect(colorValues.size).toBeGreaterThan(1);
    const geometry = water.geometry, dispose = vi.fn(); geometry.addEventListener('dispose', dispose);
    for (let n = 0; n < 50; n++) { renderer.update(s); renderer.animate(0.016); }
    expect(water.geometry).toBe(geometry); expect(dispose).not.toHaveBeenCalled();
    renderer.dispose(); expect(dispose).toHaveBeenCalledOnce(); expect(scene.children).toHaveLength(0);
  });
});
