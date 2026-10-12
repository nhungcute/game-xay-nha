import { Color, type Material } from 'three';
import { nightUniform } from './night';
import { patchMaterial } from './shaderPatches';

const windowHourUniform = { value: 12 };
const windowRateUniform = { value: 0.6 };
/**
 * Daytime glass: a light sky-blue pane instead of the imported dark glass (`GLASS_SRGB` in import-model-pack.mjs,
 * which read as black holes by day), plus a faint sky reflection so panes on shaded facades still read as glass.
 * Blended out by `uNight`, so night keeps dark glass under the warm per-pane lights.
 */
const glassDayUniform = { value: new Color('#bcd9ea') };
const GLASS_REFLECTION = 0.22;
/** Night pane light (warm emissive). Halved from 2.0 (owner request): at 2.0 close city views drowned in bloom. */
const WINDOW_LIGHT = 1.0;

function litRate(hour: number, night: number): number {
  if (night <= 0.01) return 0;
  const late = hour >= 0 && hour < 5;
  return late ? 0.42 : 0.7 - (1 - night) * 0.08;
}

export function setWindowTime(hour: number, night: number): void {
  windowHourUniform.value = hour;
  windowRateUniform.value = litRate(hour, night);
}

/** Light glass by day and warm per-pane emissive light by night on a shared instanced building material. */
export function applyWindowLights(material: Material): void {
  patchMaterial(material, 'd031-window-lights', shader => {
    shader.uniforms.uNight = nightUniform;
    shader.uniforms.uWindowHour = windowHourUniform;
    shader.uniforms.uWindowRate = windowRateUniform;
    shader.uniforms.uGlassDay = glassDayUniform;
    shader.vertexShader = `attribute float _window;\nvarying float vWindow;\nvarying vec2 vInstanceSeed;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\nvWindow = _window;\nvInstanceSeed = vec2(0.0);\n#ifdef USE_INSTANCING\n  vInstanceSeed = instanceMatrix[3].xz;\n#endif',
    );
    shader.fragmentShader = `uniform float uNight;\nuniform float uWindowHour;\nuniform float uWindowRate;\nuniform vec3 uGlassDay;\nvarying float vWindow;\nvarying vec2 vInstanceSeed;\n${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      if (vWindow > 0.0001) diffuseColor.rgb = mix(diffuseColor.rgb, uGlassDay, 1.0 - uNight);`,
    ).replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      if (vWindow > 0.0001) {
        totalEmissiveRadiance += uGlassDay * ${GLASS_REFLECTION.toFixed(2)} * (1.0 - uNight);
        float roundedHour = floor(uWindowHour * 2.0 + 0.5) * 0.5;
        float paneHash = fract(sin(dot(vec3(vWindow, vInstanceSeed.x, vInstanceSeed.y + roundedHour), vec3(17.13, 41.71, 29.53))) * 43758.5453);
        float lit = step(paneHash, uWindowRate);
        totalEmissiveRadiance += vec3(1.0, 0.56, 0.16) * lit * uNight * ${WINDOW_LIGHT.toFixed(2)};
      }`,
    );
  });
}
