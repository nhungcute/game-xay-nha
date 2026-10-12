import { BufferAttribute, BufferGeometry, InstancedMesh, MeshStandardMaterial, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { BuildingRenderer } from './BuildingRenderer';
import { AssetManager } from '../assets/AssetManager';

describe('BuildingRenderer window lights hook', () => {
  it('only patches materials on meshes with the _window attribute', () => {
    const scene = new Scene();

    const geoWithWindow = new BufferGeometry();
    geoWithWindow.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    geoWithWindow.setAttribute('_window', new BufferAttribute(new Float32Array(3), 1));
    const matWithWindow = new MeshStandardMaterial();

    const geoWithoutWindow = new BufferGeometry();
    geoWithoutWindow.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    const matWithoutWindow = new MeshStandardMaterial();

    const mockAssets = {
      get: (id: string) => {
        if (id === 'with_window') {
          return {
            parts: [{ geometry: geoWithWindow, material: matWithWindow, matrix: { isMatrix4: true } }],
            release: () => undefined,
          };
        }
        return {
          parts: [{ geometry: geoWithoutWindow, material: matWithoutWindow, matrix: { isMatrix4: true } }],
          release: () => undefined,
        };
      },
    } as unknown as AssetManager;

    const renderer = new BuildingRenderer(scene, mockAssets);
    const batches = (renderer as unknown as { batches: { decorate: (m: InstancedMesh, id: string) => void } }).batches;

    const meshNoWin = new InstancedMesh(geoWithoutWindow, matWithoutWindow, 1);
    batches.decorate(meshNoWin, 'without_window');
    expect(matWithoutWindow.customProgramCacheKey?.() ?? '').not.toContain('d031-window-lights');

    const meshWin = new InstancedMesh(geoWithWindow, matWithWindow, 1);
    batches.decorate(meshWin, 'with_window');
    expect(matWithWindow.customProgramCacheKey?.() ?? '').toContain('d031-window-lights');

    renderer.dispose();
  });
});
