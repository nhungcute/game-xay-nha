import { Box3, BufferAttribute, BufferGeometry, DoubleSide, Matrix4, type Material } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL_SIZE_M } from '@xay-nha/contracts';
import type { AssetPart } from './AssetManager';

/**
 * How an authored (non-placeholder) model is fitted to the game grid. Authored models use their own scale and
 * forward axis (the Building_3D_POC pack: 4 m cells, +Z front, ~80 meshes each); the game wants one draw call per
 * material, a bottom-centre pivot and a footprint of `footprint` cells (CELL_SIZE_M each) facing −Z.
 */
export interface AssetFit { rotateY?: number; margin?: number }

/** Bakes node transforms, merges parts that share a material, adds flat normals, then rotates, centres and scales to fit. */
export function fitParts(parts: readonly AssetPart[], footprint: readonly [number, number], fit: AssetFit): AssetPart[] {
  // GLTFLoader clones a material per vertex-colour variant; group by the authored material (its name) instead and
  // keep the vertex-coloured clone, giving parts without COLOR_0 a white colour so the whole group can merge.
  const groups = new Map<string, { material: Material | Material[]; geometries: BufferGeometry[] }>();
  for (const part of parts) {
    let geometry = part.geometry.clone().applyMatrix4(part.matrix);
    if (geometry.index) geometry = geometry.toNonIndexed();
    // Keep only the attributes authored parts share; normals are rebuilt flat (low-poly look).
    for (const name of Object.keys(geometry.attributes)) if (!['position', 'uv', 'color'].includes(name)) geometry.deleteAttribute(name);
    geometry.computeVertexNormals();
    const material = part.material, key = Array.isArray(material) ? material.map(m => m.uuid).join() : material.name || material.uuid;
    const group = groups.get(key) ?? { material, geometries: [] };
    if (!Array.isArray(material) && material.vertexColors) group.material = material;
    group.geometries.push(geometry); groups.set(key, group);
  }
  for (const { geometries } of groups.values()) {
    const sample = geometries.find(geometry => geometry.getAttribute('color'))?.getAttribute('color');
    if (!sample) continue;
    const Typed = sample.array.constructor as new (length: number) => Float32Array | Uint8Array | Uint16Array;
    const full = sample.normalized ? (sample.array instanceof Uint8Array ? 255 : 65535) : 1;
    for (const geometry of geometries) if (!geometry.getAttribute('color')) {
      const white = new Typed(geometry.getAttribute('position').count * sample.itemSize).fill(full);
      geometry.setAttribute('color', new BufferAttribute(white, sample.itemSize, sample.normalized));
    }
  }
  const merged = [...groups.values()].map(({ material, geometries }) => {
    const geometry = geometries.length === 1 ? geometries[0]! : mergeGeometries(geometries, false);
    if (!geometry) throw new Error('Authored model parts have incompatible attributes');
    for (const source of geometries) if (source !== geometry) source.dispose();
    return { geometry, material };
  });
  const transform = new Matrix4().makeRotationY((fit.rotateY ?? 0) * Math.PI / 180);
  for (const { geometry } of merged) geometry.applyMatrix4(transform);
  const bounds = new Box3();
  for (const { geometry } of merged) { geometry.computeBoundingBox(); bounds.union(geometry.boundingBox!); }
  const width = bounds.max.x - bounds.min.x, depth = bounds.max.z - bounds.min.z;
  const scale = Math.min(footprint[0] * CELL_SIZE_M / width, footprint[1] * CELL_SIZE_M / depth) * (fit.margin ?? 0.92);
  const place = new Matrix4().makeScale(scale, scale, scale)
    .multiply(new Matrix4().makeTranslation(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2));
  return merged.map(({ geometry, material }) => {
    // The POC pack leaves gaps under some roofs; drawing both faces shows the inner wall instead of a black hole.
    for (const m of Array.isArray(material) ? material : [material]) m.side = DoubleSide;
    geometry.applyMatrix4(place); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return { geometry, material, matrix: new Matrix4() };
  });
}
