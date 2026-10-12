import * as THREE from 'three';
import { type Cell } from '@xay-nha/contracts';
import type { SimState } from '@xay-nha/sim';
import { cornerHeights } from './geometry';
import { nightUniform } from './night';
import { patchMaterial } from './shaderPatches';

/** Bulb glow. Above the 1.15 bloom threshold on purpose (D036 review): the bulbs are a few pixels under their hoods,
 *  so at 0.95 they read as unlit; a small bloom halo is what makes a lit lamp visible from the game camera. */
const LAMP_LIGHT = 1.8;
/** Ground pool strength (linear, before tone mapping): a warm amber pool, not a white disc. */
const POOL_LIGHT = 0.65;
/** Pool shape across the cell: full strength out to PLATEAU of the half-cell, then a soft fade to the cell edge. */
const POOL_PLATEAU = 0.45;

/** Emissive glow on streetlight bulb geometry when uNight > 0. */
export function applyStreetLampLight(material: THREE.Material): void {
  patchMaterial(material, 'd035-lamp-light', shader => {
    shader.uniforms.uNight = nightUniform;
    shader.vertexShader = `attribute float _lamp;\nvarying float vLamp;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvLamp = _lamp;',
    );
    shader.fragmentShader = `uniform float uNight;\nvarying float vLamp;\n${shader.fragmentShader}`.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      if (vLamp > 0.0001) {
        totalEmissiveRadiance += vec3(1.0, 0.82, 0.48) * uNight * ${LAMP_LIGHT.toFixed(2)};
      }`,
    );
  });
}

function createGroundLightTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const center = (size - 1) / 2;
  const maxRadius = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dist = Math.hypot(x - center, y - center);
      // Soft square-ish pool: covers most of the cell (corners fade), instead of a ~1 m hot spot at the centre.
      const t = Math.min(1, Math.max(Math.abs(x - center), Math.abs(y - center)) * 0.35 / maxRadius + dist * 0.65 / maxRadius);
      const edge = Math.min(1, Math.max(0, (t - POOL_PLATEAU) / (1 - POOL_PLATEAU)));
      const falloff = 1 - edge * edge * (3 - 2 * edge);

      // Warm amber (sRGB #ffc46e); alpha carries the falloff.
      data[idx] = 255;
      data[idx + 1] = 196;
      data[idx + 2] = 110;
      data[idx + 3] = Math.round(255 * falloff);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

export class StreetLightRenderer {
  private mesh: THREE.InstancedMesh;
  private cornersAttr: THREE.InstancedBufferAttribute;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly texture: THREE.DataTexture;
  private readonly dummy = new THREE.Object3D();
  private capacity = 32;

  constructor(private readonly scene: THREE.Scene) {
    this.texture = createGroundLightTexture();
    this.geometry = new THREE.PlaneGeometry(2.0, 2.0, 4, 4);
    this.geometry.rotateX(-Math.PI / 2);

    this.cornersAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4);
    this.geometry.setAttribute('roadCorners', this.cornersAttr);

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.FrontSide,
    });

    this.material.onBeforeCompile = shader => {
      shader.uniforms.uNight = nightUniform;
      shader.vertexShader = `attribute vec4 roadCorners;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float a = roadCorners.x, b = roadCorners.y, c = roadCorners.z, d = roadCorners.w;
        float u = clamp((position.x + 1.0) * 0.5, 0.0, 1.0);
        float v = clamp((position.z + 1.0) * 0.5, 0.0, 1.0);
        if (abs(a - d) <= abs(b - c)) {
          transformed.y = u >= v ? a + (b - a)*u + (d - b)*v : a + (d - c)*u + (c - a)*v;
        } else {
          transformed.y = u + v <= 1.0 ? a + (b - a)*u + (c - a)*v : d + (c - d)*(1.0 - u) + (b - d)*(1.0 - v);
        }
        transformed.y += 0.015;`,
      );
      shader.fragmentShader = `uniform float uNight;\n${shader.fragmentShader}`.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= uNight * ${POOL_LIGHT.toFixed(2)};`,
      );
    };

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
    this.mesh.name = 'streetlight-ground-pools';
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.scene.add(this.mesh);
  }

  private reallocate(required: number): void {
    const newCap = Math.max(required, this.capacity * 2);
    this.scene.remove(this.mesh);
    this.mesh.dispose();

    this.capacity = newCap;
    this.cornersAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4);
    this.geometry.setAttribute('roadCorners', this.cornersAttr);

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
    this.mesh.name = 'streetlight-ground-pools';
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.scene.add(this.mesh);
  }

  update(state: SimState): void {
    const active = state.snapshot.buildings.filter(b => b.defId === 'deco_streetlight' && b.status === 'ACTIVE');
    if (active.length === 0) {
      this.mesh.count = 0;
      this.mesh.visible = false;
      return;
    }

    if (active.length > this.capacity) {
      this.reallocate(active.length);
    }

    for (let i = 0; i < active.length; i++) {
      const b = active[i]!;
      const cell: Cell = [b.anchor[0], b.anchor[1]];
      this.dummy.position.set(cell[0] * 2 + 1, 0, cell[1] * 2 + 1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);

      const [a, bHeight, c, d] = cornerHeights(state, cell);
      this.cornersAttr.setXYZW(i, a, bHeight, c, d);
    }

    this.mesh.count = active.length;
    this.mesh.visible = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.cornersAttr.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
