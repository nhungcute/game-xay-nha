import { describe, expect, it } from 'vitest';
import { MeshBasicMaterial, MeshStandardMaterial, ShaderLib } from 'three';
import { lighting } from '../dayCycle';
import { applyNightTint, setNight, unlitTintUniform } from './night';
import type { ShaderLike } from './shaderPatches';
import { applyWindowLights } from './windowLights';

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

describe('building glass', () => {
  it('turns imported dark panes light by day (diffuse + sky reflection) and keeps them dark under night lights', () => {
    const material = new MeshStandardMaterial({ vertexColors: true });
    applyWindowLights(material);
    const shader: ShaderLike = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
    material.onBeforeCompile(shader as never, {} as never);
    const source = shader.fragmentShader;
    expect(source.indexOf('diffuseColor.rgb = mix(diffuseColor.rgb, uGlassDay, 1.0 - uNight)')).toBeGreaterThan(source.indexOf('#include <color_fragment>'));
    expect(source).toContain('totalEmissiveRadiance += uGlassDay * 0.22 * (1.0 - uNight);');
    const glass = (shader.uniforms.uGlassDay!.value as { r: number; g: number; b: number });
    expect(Math.min(glass.r, glass.g, glass.b)).toBeGreaterThan(0.3); // linear: a light pane, not the dark import glass
  });
});
