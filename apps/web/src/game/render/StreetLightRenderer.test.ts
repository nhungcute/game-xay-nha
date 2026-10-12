import { BufferAttribute, BufferGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createState } from '@xay-nha/sim';
import { createTestTemplate } from '@xay-nha/worldgen';
import { StreetLightRenderer, applyStreetLampLight } from './StreetLightRenderer';
import { BuildingRenderer } from './BuildingRenderer';
import { AssetManager } from '../assets/AssetManager';
import { setNight, nightUniform } from './night';
import { applyWindowLights } from './windowLights';

describe('StreetLightRenderer and lamp shader patch', () => {
  it('creates 0 instances when no active streetlight exists, and 1 instance per ACTIVE streetlight', () => {
    const scene = new Scene();
    const renderer = new StreetLightRenderer(scene);
    const state = createState(createTestTemplate('farm'), 1_000_000);

    // Initial state: no streetlights
    renderer.update(state);
    const mesh = scene.getObjectByName('streetlight-ground-pools') as InstancedMesh;
    expect(mesh).toBeDefined();
    expect(mesh.count).toBe(0);
    expect(mesh.visible).toBe(false);

    // Add a CONSTRUCTING streetlight
    state.snapshot.buildings.push({
      id: 'b_test_1',
      defId: 'deco_streetlight',
      anchor: [10, 15],
      rotation: 0,
      placedAt: 1000,
      buildEndsAt: 16000,
      status: 'CONSTRUCTING',
      cashPaid: 150,
      materialsPaid: { cash: 150, wood: 0, stone: 2 },
      investedValue: 190,
    });
    renderer.update(state);
    expect(mesh.count).toBe(0);
    expect(mesh.visible).toBe(false);

    // Change status to ACTIVE
    state.snapshot.buildings[0]!.status = 'ACTIVE';
    renderer.update(state);
    expect(mesh.count).toBe(1);
    expect(mesh.visible).toBe(true);

    // Check position is centered on cell [10, 15] -> (10 * 2 + 1, 0, 15 * 2 + 1) = (21, 0, 31)
    const position = new Vector3();
    const matrix = new Matrix4();
    mesh.getMatrixAt(0, matrix);
    position.setFromMatrixPosition(matrix);
    expect(position.x).toBe(21);
    expect(position.z).toBe(31);

    // Add a second ACTIVE streetlight
    state.snapshot.buildings.push({
      id: 'b_test_2',
      defId: 'deco_streetlight',
      anchor: [12, 15],
      rotation: 0,
      placedAt: 2000,
      buildEndsAt: 17000,
      status: 'ACTIVE',
      cashPaid: 150,
      materialsPaid: { cash: 150, wood: 0, stone: 2 },
      investedValue: 190,
    });
    renderer.update(state);
    expect(mesh.count).toBe(2);

    // Demolish one streetlight
    state.snapshot.buildings.pop();
    renderer.update(state);
    expect(mesh.count).toBe(1);

    // Demolish remaining streetlight
    state.snapshot.buildings.pop();
    renderer.update(state);
    expect(mesh.count).toBe(0);
    expect(mesh.visible).toBe(false);

    renderer.dispose();
    expect(scene.getObjectByName('streetlight-ground-pools')).toBeUndefined();
  });

  it('updates nightUniform properly between day (0) and night (> 0)', () => {
    setNight(0);
    expect(nightUniform.value).toBe(0);
    setNight(1);
    expect(nightUniform.value).toBe(1);
    setNight(0.5);
    expect(nightUniform.value).toBe(0.5);
    setNight(0);
  });

  it('BuildingRenderer decorates meshes with _lamp attribute and leaves non-lamp meshes untouched', () => {
    const scene = new Scene();

    const geoWithLamp = new BufferGeometry();
    geoWithLamp.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    geoWithLamp.setAttribute('_lamp', new BufferAttribute(new Float32Array(3), 1));
    const matWithLamp = new MeshStandardMaterial();

    const geoWithoutLamp = new BufferGeometry();
    geoWithoutLamp.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    const matWithoutLamp = new MeshStandardMaterial();

    const mockAssets = {
      get: (id: string) => {
        if (id === 'with_lamp') {
          return {
            parts: [{ geometry: geoWithLamp, material: matWithLamp, matrix: { isMatrix4: true } }],
            release: () => undefined,
          };
        }
        return {
          parts: [{ geometry: geoWithoutLamp, material: matWithoutLamp, matrix: { isMatrix4: true } }],
          release: () => undefined,
        };
      },
    } as unknown as AssetManager;

    const renderer = new BuildingRenderer(scene, mockAssets);
    const batches = (renderer as unknown as { batches: { decorate: (m: InstancedMesh, id: string) => void } }).batches;

    const meshNoLamp = new InstancedMesh(geoWithoutLamp, matWithoutLamp, 1);
    batches.decorate(meshNoLamp, 'without_lamp');
    expect(matWithoutLamp.customProgramCacheKey?.() ?? '').not.toContain('d035-lamp-light');

    const meshLamp = new InstancedMesh(geoWithLamp, matWithLamp, 1);
    batches.decorate(meshLamp, 'with_lamp');
    expect(matWithLamp.customProgramCacheKey?.() ?? '').toContain('d035-lamp-light');

    renderer.dispose();
  });

  it('chains _lamp patch with _window lights without conflict', () => {
    const mat = new MeshStandardMaterial();
    applyWindowLights(mat);
    expect(mat.customProgramCacheKey?.() ?? '').toContain('d031-window-lights');
    expect(mat.customProgramCacheKey?.() ?? '').not.toContain('d035-lamp-light');

    applyStreetLampLight(mat);
    const key = mat.customProgramCacheKey?.() ?? '';
    expect(key).toContain('d031-window-lights');
    expect(key).toContain('d035-lamp-light');

    // Compiling shader executes both patches without crashing
    const shader = {
      uniforms: {},
      vertexShader: '#include <begin_vertex>',
      fragmentShader: '#include <emissivemap_fragment>',
    };
    mat.onBeforeCompile(shader as never, {} as never);
    expect(shader.vertexShader).toContain('vWindow');
    expect(shader.vertexShader).toContain('vLamp');
    expect(shader.fragmentShader).toContain('uWindowHour');
    expect(shader.fragmentShader).toContain('vLamp > 0.0001');
  });
});
