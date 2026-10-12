import type { Material } from 'three';

export interface ShaderLike { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }
type Patch = (shader: ShaderLike) => void;
interface PatchState { base?: Material['onBeforeCompile']; patches?: Map<string, Patch>; baseKey?: () => string }

/** Compose renderer features on shared GLTF materials without replacing each other's shader hooks. */
export function patchMaterial(material: Material, key: string, patch: Patch): void {
  const data = material.userData as { d031Patches?: PatchState };
  const state = (data.d031Patches ??= {
    base: material.onBeforeCompile?.bind(material),
    baseKey: material.customProgramCacheKey?.bind(material),
  }) as PatchState;
  const patches = state.patches ??= new Map<string, Patch>();
  if (patches.has(key)) return;
  patches.set(key, patch);
  material.onBeforeCompile = (shader, renderer) => {
    state.base?.(shader as never, renderer);
    for (const apply of patches.values()) apply(shader);
  };
  material.customProgramCacheKey = () => `${state.baseKey?.() ?? ''}|${[...patches.keys()].join('|')}`;
  material.needsUpdate = true;
}
