import type { Material } from 'three';
import { patchMaterial } from './shaderPatches';

export const nightUniform = { value: 0 };

/** Shared D031 night value. One uniform object keeps every patched material in sync. */
export function setNight(value: number): void {
  nightUniform.value = Math.max(0, Math.min(1, value));
}

/** Darken unlit surfaces and coins so they do not remain at daylight brightness after sunset. */
export function applyNightTint(material: Material): void {
  patchMaterial(material, 'd031-night-tint', shader => {
    shader.uniforms.uNight = nightUniform;
    shader.fragmentShader = `uniform float uNight;\n${shader.fragmentShader}`.replace(
      '#include <dithering_fragment>',
      'outgoingLight *= mix(1.0, 0.56, uNight);\n#include <dithering_fragment>',
    );
  });
}
