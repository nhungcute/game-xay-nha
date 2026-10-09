import * as THREE from 'three';
import { CELL_SIZE_M, GRID, VERTS, cellIndex, vertIndex, type Cell } from '@xay-nha/contracts';
import type { SimState } from '@xay-nha/sim';

export function cornerHeights(state: SimState, [x, z]: Cell): [number, number, number, number] {
  return [state.heights[vertIndex(x, z)]! / 10, state.heights[vertIndex(x + 1, z)]! / 10,
    state.heights[vertIndex(x, z + 1)]! / 10, state.heights[vertIndex(x + 1, z + 1)]! / 10];
}

export function heightAt(heights: ArrayLike<number>, worldX: number, worldZ: number, scale = 0.1): number {
  const gx = THREE.MathUtils.clamp(worldX / CELL_SIZE_M, 0, GRID), gz = THREE.MathUtils.clamp(worldZ / CELL_SIZE_M, 0, GRID);
  const x = Math.min(GRID - 1, Math.floor(gx)), z = Math.min(GRID - 1, Math.floor(gz));
  const u = gx - x, v = gz - z;
  const a = heights[vertIndex(x, z)]! * scale, b = heights[vertIndex(x + 1, z)]! * scale;
  const c = heights[vertIndex(x, z + 1)]! * scale, d = heights[vertIndex(x + 1, z + 1)]! * scale;
  if (Math.abs(a - d) <= Math.abs(b - c)) return u >= v ? a + (b - a) * u + (d - b) * v : a + (d - c) * u + (c - a) * v;
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

export function globalNormal(heights: ArrayLike<number>, x: number, z: number, target: THREE.Vector3): THREE.Vector3 {
  const left = Math.max(0, x - 1), right = Math.min(GRID, x + 1), top = Math.max(0, z - 1), bottom = Math.min(GRID, z + 1);
  return target.set(-(heights[vertIndex(right, z)]! - heights[vertIndex(left, z)]!) / ((right - left) * 20), 1,
    -(heights[vertIndex(x, bottom)]! - heights[vertIndex(x, top)]!) / ((bottom - top) * 20)).normalize();
}

export function neighborMask(state: SimState, [x, z]: Cell, bridgeDeck: ReadonlySet<number>): number {
  let mask = 0;
  ([[x, z - 1, 1], [x + 1, z, 2], [x, z + 1, 4], [x - 1, z, 8]] as const).forEach(([nx, nz, bit]) => {
    if (nx >= 0 && nz >= 0 && nx < GRID && nz < GRID && (state.roadTier[cellIndex(nx, nz)] || bridgeDeck.has(cellIndex(nx, nz)))) mask |= bit;
  });
  return mask;
}

/** A single owned box geometry, with pooled instance matrices and bounded growth. */
export class BoxBatch {
  readonly mesh: THREE.InstancedMesh;
  private cursor = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly slopes?: THREE.InstancedBufferAttribute;
  private readonly ownedGeometry?: THREE.BoxGeometry;
  constructor(private readonly scene: THREE.Scene, geometry: THREE.BoxGeometry, material: THREE.Material, capacity: number, slopeMode?: 'wall' | 'cap') {
    if (slopeMode) {
      this.ownedGeometry = geometry.clone();
      this.slopes = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
      this.ownedGeometry.setAttribute('moduleSlope', this.slopes);
      material.onBeforeCompile = shader => {
        shader.vertexShader = `attribute float moduleSlope;\n${shader.vertexShader}`.replace('#include <begin_vertex>',
          `#include <begin_vertex>\ntransformed.y += position.x * moduleSlope ${slopeMode === 'wall' ? '* (position.y + 0.5)' : ''};`);
      };
      material.customProgramCacheKey = () => `bank-${slopeMode}`;
    }
    this.mesh = new THREE.InstancedMesh(this.ownedGeometry ?? geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  reset(): void { this.cursor = 0; }
  box(x: number, y: number, z: number, width: number, height: number, depth: number, yaw = 0, slope = 0): void {
    if (this.cursor >= this.mesh.instanceMatrix.count) throw new Error('Rendering instance capacity exceeded');
    this.dummy.position.set(x, y, z); this.dummy.scale.set(width, Math.max(0.01, height), depth); this.dummy.rotation.set(0, yaw, 0);
    this.dummy.updateMatrix(); this.mesh.setMatrixAt(this.cursor, this.dummy.matrix); this.slopes?.setX(this.cursor, slope); this.cursor++;
  }
  finish(): void { this.mesh.count = this.cursor; this.mesh.instanceMatrix.needsUpdate = true; if (this.slopes) this.slopes.needsUpdate = true; }
  dispose(): void { this.scene.remove(this.mesh); this.mesh.dispose(); this.ownedGeometry?.dispose(); }
}

export const ALL_ZONES = Object.freeze(Array.from({ length: 64 }, (_, index) => index));
export const HEIGHT_COUNT = VERTS * VERTS;
