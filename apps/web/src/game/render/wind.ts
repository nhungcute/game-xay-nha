import { MeshDepthMaterial, RGBADepthPacking, type Material, type Texture } from 'three';

/**
 * D030 tree wind: a gentle height-weighted sway injected via onBeforeCompile into every environment
 * foliage material (near and far LODs) and into the shadow depth material, so silhouettes match.
 * Amplitude grows with vertex height; the phase comes from the instance origin, so instanced trees
 * do not sway in sync. Shared uniform objects keep one clock for all materials; strength is 0 in
 * low graphics (docs/11 §8), which changes rendering without a shader rebuild.
 */
export const WIND_AMPLITUDE = 0.02;

const windTime = { value: 0 };
const windStrength = { value: 1 };
const patched = new WeakSet<Material>();

const WIND_UNIFORMS = 'uniform float uWindTime;\nuniform float uWindStrength;\nuniform float uWindAmplitude;\n';
const WIND_CHUNK = `
  #ifdef USE_INSTANCING
    vec3 windOrigin = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
  #else
    vec3 windOrigin = vec3(0.0);
  #endif
  float windPhase = windOrigin.x * 0.37 + windOrigin.z * 0.41;
  float windAmplitude = max(transformed.y, 0.0) * uWindAmplitude * uWindStrength;
  transformed.x += sin(uWindTime * 1.6 + windPhase + transformed.y * 0.35) * windAmplitude;
  transformed.z += cos(uWindTime * 1.13 + windPhase * 1.7) * windAmplitude * 0.7;
`;

/** Advance the shared wind clock; strength 0 freezes the sway (low graphics). Idempotent per material. */
export function tickWind(dt: number, strength: number): void {
  windTime.value += dt;
  windStrength.value = strength;
}

export function applyWind(material: Material, amplitude = WIND_AMPLITUDE): void {
  if (patched.has(material)) return;
  patched.add(material);
  material.onBeforeCompile = shader => {
    shader.uniforms.uWindTime = windTime;
    shader.uniforms.uWindStrength = windStrength;
    shader.uniforms.uWindAmplitude = { value: amplitude };
    shader.vertexShader = WIND_UNIFORMS + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_CHUNK}`);
  };
  material.customProgramCacheKey = () => `wind-${amplitude}`;
}

/** Shadow-pass material with the same alpha cutout and sway as the visible foliage. */
export function windDepthMaterial(map: Texture | null, alphaTest: number, amplitude = WIND_AMPLITUDE): MeshDepthMaterial {
  const material = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map: map ?? undefined, alphaTest });
  applyWind(material, amplitude);
  return material;
}
