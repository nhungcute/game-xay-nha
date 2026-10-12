import { Vector3, type Material } from 'three';
import { patchMaterial } from './shaderPatches';

export const nightUniform = { value: 0 };
/** Linear RGB multiplier for unlit materials (`lighting().unlitTint`); (1,1,1) by day. */
export const unlitTintUniform = { value: new Vector3(1, 1, 1) };

/** Shared D031 night value. One uniform object keeps every patched material in sync. */
export function setNight(value: number, unlitTint: readonly [number, number, number] = [1, 1, 1]): void {
  nightUniform.value = Math.max(0, Math.min(1, value));
  unlitTintUniform.value.set(...unlitTint);
}

/**
 * Darken unlit (MeshBasic) surfaces by the same per-channel factor the scene lights apply to lit surfaces, so
 * KHR_materials_unlit foliage and water foam follow the night instead of staying at daylight brightness.
 * The multiply must run before `opaque_fragment` writes gl_FragColor (and before tone mapping, in linear space).
 * Lit materials must not use this: they already darken through the lights.
 */
export function applyNightTint(material: Material): void {
  patchMaterial(material, 'd031-night-tint', shader => {
    shader.uniforms.uUnlitTint = unlitTintUniform;
    shader.fragmentShader = `uniform vec3 uUnlitTint;\n${shader.fragmentShader}`.replace(
      '#include <opaque_fragment>',
      'outgoingLight *= uUnlitTint;\n#include <opaque_fragment>',
    );
  });
}
