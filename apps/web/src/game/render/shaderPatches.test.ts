import { describe, expect, it, vi } from 'vitest';
import { MeshStandardMaterial } from 'three';
import { patchMaterial, type ShaderLike } from './shaderPatches';

describe('shaderPatches patchMaterial', () => {
  it('prevents duplicating patches with the same key', () => {
    const mat = new MeshStandardMaterial();
    const patch1 = vi.fn();
    const patch2 = vi.fn();

    patchMaterial(mat, 'wind', patch1);
    patchMaterial(mat, 'wind', patch2);

    const shader: ShaderLike = {
      uniforms: {},
      vertexShader: '#include <begin_vertex>',
      fragmentShader: '#include <dithering_fragment>',
    };

    mat.onBeforeCompile(shader as never, {} as never);
    expect(patch1).toHaveBeenCalledTimes(1);
    expect(patch2).not.toHaveBeenCalled();
  });

  it('chains multiple distinct patches in order', () => {
    const mat = new MeshStandardMaterial();
    const calls: string[] = [];

    patchMaterial(mat, 'patch-a', () => { calls.push('a'); });
    patchMaterial(mat, 'patch-b', () => { calls.push('b'); });
    patchMaterial(mat, 'patch-c', () => { calls.push('c'); });

    const shader: ShaderLike = {
      uniforms: {},
      vertexShader: '',
      fragmentShader: '',
    };

    mat.onBeforeCompile(shader as never, {} as never);
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('generates a stable customProgramCacheKey', () => {
    const mat = new MeshStandardMaterial();
    patchMaterial(mat, 'first', () => {});
    patchMaterial(mat, 'second', () => {});

    const key1 = mat.customProgramCacheKey();
    const key2 = mat.customProgramCacheKey();
    expect(key1).toBe(key2);
    expect(key1).toContain('first');
    expect(key1).toContain('second');

    // Calling again with existing key does not alter cache key
    patchMaterial(mat, 'first', () => {});
    expect(mat.customProgramCacheKey()).toBe(key1);
  });

  it('preserves base onBeforeCompile and customProgramCacheKey', () => {
    const mat = new MeshStandardMaterial();
    const baseHook = vi.fn();
    mat.onBeforeCompile = baseHook;
    mat.customProgramCacheKey = () => 'base-cache-key';

    const patchHook = vi.fn();
    patchMaterial(mat, 'addon', patchHook);

    const shader: ShaderLike = {
      uniforms: {},
      vertexShader: '',
      fragmentShader: '',
    };

    mat.onBeforeCompile(shader as never, {} as never);
    expect(baseHook).toHaveBeenCalledTimes(1);
    expect(patchHook).toHaveBeenCalledTimes(1);
    expect(mat.customProgramCacheKey()).toBe('base-cache-key|addon');
  });
});
