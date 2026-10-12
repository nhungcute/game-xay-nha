import { describe, expect, it } from 'vitest';
import { MeshBasicMaterial, ShaderLib } from 'three';
import { lighting } from '../dayCycle';
import { applyNightTint, setNight, unlitTintUniform } from './night';
import type { ShaderLike } from './shaderPatches';

describe('night tint for unlit materials', () => {
  it('multiplies outgoingLight before opaque_fragment writes gl_FragColor (a later multiply is a no-op)', () => {
    const material = new MeshBasicMaterial();
    applyNightTint(material);
    const shader: ShaderLike = { uniforms: {}, vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader };
    material.onBeforeCompile(shader as never, {} as never);
    const multiply = shader.fragmentShader.indexOf('outgoingLight *= uUnlitTint;');
    expect(multiply).toBeGreaterThan(shader.fragmentShader.indexOf('vec3 outgoingLight'));
    expect(multiply).toBeLessThan(shader.fragmentShader.indexOf('#include <opaque_fragment>'));
    expect(shader.fragmentShader).toContain('uniform vec3 uUnlitTint;');
    expect(shader.uniforms.uUnlitTint).toBe(unlitTintUniform);
  });

  it('drives the shared uniform from lighting(): neutral by day, the lit-surface ratio at night', () => {
    const day = lighting(13), night = lighting(22);
    setNight(day.night, day.unlitTint);
    expect(unlitTintUniform.value.toArray()).toEqual([1, 1, 1]);
    setNight(night.night, night.unlitTint);
    expect(unlitTintUniform.value.toArray()).toEqual([...night.unlitTint]);
    setNight(0);
    expect(unlitTintUniform.value.toArray()).toEqual([1, 1, 1]);
  });
});
