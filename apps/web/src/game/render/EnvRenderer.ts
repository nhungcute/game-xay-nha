import type { InstancedMesh, Material, Matrix4, MeshDepthMaterial, Scene, Texture } from 'three';
import { Cell, CELL_SIZE_M, GRID } from '@xay-nha/contracts';
import type { SimState } from '@xay-nha/sim';
import { AssetManager } from '../assets/AssetManager';
import { InstanceBatches, type InstancePlacement } from '../assets/InstanceBatches';
import { addInstance, cellCenter, matrix, terrainHeight } from '../assets/placement';
import { keepInLow, type Quality } from '../quality';
import { TREE_LOD } from './treeLod';
import { applyWind, tickWind, windDepthMaterial } from './wind';
import { applyNightTint } from './night';

/** Environment batches are asset × LOD × map quadrant (not × zone): near/far per asset keeps the detailed
 * models to the TREE_LOD.nearCount closest instances while the whole map still renders as billboards, and the
 * 4 frustum-cullable quadrants per LOD keep the default views within the docs/11 §8 draw-call budget. */
const REGION_CELLS = GRID / 2;
const regionOf = ([x, z]: readonly [number, number]) => Math.floor(z / REGION_CELLS) * 2 + Math.floor(x / REGION_CELLS);
/** Only near trees (≥ 1.5 m, alpha-cutout foliage) cast shadows; far billboards and low bushes do not. */
const SHADOW_MIN_HEIGHT_M = 1.5;

interface EnvItem { assetId: string; cell: Cell; x: number; z: number; matrix: Matrix4 }

export class EnvRenderer {
  private readonly batches: InstanceBatches;
  private readonly farIds: Set<string>;
  private readonly items: EnvItem[] = [];
  private readonly order: number[] = [];
  private readonly depthMaterials = new Map<string, MeshDepthMaterial>();
  private readonly lodCamera = { x: 0, z: 0, yawDeg: 0 };
  private previous?: SimState;
  private lodDirty = true;
  private quality: Quality = 'high';
  private forcedNearCount?: number;
  /** Times near/far re-partitioning ran — test/debug observable for the hysteresis (no per-frame recomputes). */
  lodRebuilds = 0;
  constructor(scene: Scene, assets: AssetManager) {
    // Only the imported tree/bush ids ship a far LOD (manifest `lod.far`); other scenery keeps one model.
    this.farIds = new Set(assets.manifest.filter(entry => entry.lod?.far).map(entry => entry.id));
    this.batches = new InstanceBatches(scene, assets,
      handle => !handle.id.endsWith('_far') && handle.bounds.max.y - handle.bounds.min.y >= SHADOW_MIN_HEIGHT_M,
      (mesh, assetId) => this.decorate(mesh, assetId));
  }
  /** Low quality: far LOD only, no small decor, half the bushes, one batch per asset (fewest draw calls). */
  setQuality(quality: Quality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    if (this.previous) { this.collect(this.previous); this.rebuild(); }
  }
  update(s: SimState): void {
    if (this.previous === s && !this.lodDirty) return;
    this.previous = s;
    this.collect(s);
    this.rebuild();
  }
  /** Per frame: wind clock, then a near/far re-selection only past the hysteresis (4 m move or 10° turn) —
   *  no per-frame allocation; distances are measured from the camera target (screen centre on the ground). */
  frame(dt: number, camera: { x: number; z: number; yawDeg: number }): void {
    tickWind(dt, this.quality === 'high' ? 1 : 0);
    if (!this.previous) return;
    const dx = camera.x - this.lodCamera.x, dz = camera.z - this.lodCamera.z;
    const yawDelta = Math.abs(camera.yawDeg - this.lodCamera.yawDeg);
    if (this.lodDirty || dx * dx + dz * dz > TREE_LOD.recomputeMoveM ** 2 || yawDelta > TREE_LOD.recomputeYawDeg) {
      this.lodCamera.x = camera.x; this.lodCamera.z = camera.z; this.lodCamera.yawDeg = camera.yawDeg;
      this.rebuild();
    }
  }
  private collect(s: SimState): void {
    const removed = new Set(s.snapshot.delta.removedEnvIds);
    this.items.length = 0;
    for (const env of s.env) {
      if (removed.has(env.id) || (this.quality === 'low' && !keepInLow(env.assetId, env.id))) continue;
      const [cx, cz] = cellCenter(env.cell);
      // offsetXZ is in world meters in the immutable generated environment.
      const x = cx + env.offsetXZ[0], z = cz + env.offsetXZ[1];
      const footprintOffset = (env.footprint - 1) * CELL_SIZE_M / 2;
      this.items.push({ assetId: env.assetId, cell: env.cell, x: x + footprintOffset, z: z + footprintOffset,
        matrix: matrix(x + footprintOffset, terrainHeight(s, x + footprintOffset, z + footprintOffset), z + footprintOffset,
          env.yawDeg * Math.PI / 180, [env.scale, env.scale, env.scale]) });
    }
    this.lodDirty = true;
  }
  private rebuild(): void {
    const groups = new Map<string, InstancePlacement>();
    const low = this.quality === 'low';
    const order = this.order.length === this.items.length ? this.order : (this.order.length = 0, this.order);
    if (!order.length) for (let i = 0; i < this.items.length; i++) order.push(i);
    order.sort((a, b) => this.distance2(this.items[a]!) - this.distance2(this.items[b]!));
    let nearAssigned = 0;
    for (const index of order) {
      const item = this.items[index]!;
      const near = !low && nearAssigned < (this.forcedNearCount ?? TREE_LOD.nearCount)
        && (this.forcedNearCount !== undefined || this.distance2(item) <= TREE_LOD.nearRadiusM ** 2);
      if (near) nearAssigned++;
      const far = !near && this.farIds.has(item.assetId);
      addInstance(groups, `${item.assetId}:${near ? 'near' : 'far'}:${low ? 0 : regionOf(item.cell)}`,
        far ? `${item.assetId}_far` : item.assetId, item.matrix);
    }
    this.batches.update(groups);
    this.lodDirty = false;
    this.lodRebuilds++;
  }
  private distance2(item: EnvItem): number {
    return (item.x - this.lodCamera.x) ** 2 + (item.z - this.lodCamera.z) ** 2;
  }
  private decorate(mesh: InstancedMesh, assetId: string): void {
    const material = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
    applyWind(material, undefined, assetId.endsWith('_far'));
    if (material.type === 'MeshBasicMaterial') applyNightTint(material);
    if (assetId.startsWith('tree_') && !assetId.endsWith('_far')) {
      // Alpha-cutout shadows must follow the leaf silhouette and the sway — custom depth material per tree asset.
      const map = (material as Material & { map?: Texture | null }).map ?? null;
      let depth = this.depthMaterials.get(assetId);
      if (!depth) this.depthMaterials.set(assetId, depth = windDepthMaterial(map, material.alphaTest));
      mesh.customDepthMaterial = depth;
    }
  }
  /** Debug/QA accessor: per-batch summary of the live environment meshes (GameLoop `__debug.envBatches`). */
  sceneBatches(emit: (batch: { name: string; count: number; capacity: number; visible: boolean; castShadow: boolean; boundingSphereR: number; sphereCenter: number[] }) => void): void {
    this.batches.each((key, batch) => emit({
      name: `${key}:${batch.assetId}`, count: batch.meshes.reduce((sum, mesh) => sum + mesh.count, 0), capacity: batch.capacity,
      visible: batch.meshes[0]?.visible ?? false, castShadow: batch.meshes[0]?.castShadow ?? false,
      boundingSphereR: +(batch.meshes[0]?.boundingSphere?.radius ?? batch.meshes[0]?.geometry.boundingSphere?.radius ?? 0).toFixed(2),
      sphereCenter: (batch.meshes[0]?.boundingSphere?.center ?? batch.meshes[0]?.geometry.boundingSphere?.center)?.toArray().map(v => +v.toFixed(1)) ?? [],
    }));
  }
  /** Debug/QA accessor: force frustum culling on/off for every environment mesh (culling investigations). */
  setFrustumCulled(enabled: boolean): void {
    this.batches.each((_, batch) => { for (const mesh of batch.meshes) mesh.frustumCulled = enabled; });
  }
  setVisible(visible: boolean): void { this.batches.each((_, batch) => { for (const mesh of batch.meshes) mesh.visible = visible; }); }
  setNearCount(count: number): void {
    if (!Number.isInteger(count) || count < 0) throw new RangeError('nearCount must be a non-negative integer');
    this.forcedNearCount = count;
    if (this.previous) { this.collect(this.previous); this.rebuild(); }
  }
  dispose(): void {
    this.batches.dispose();
    for (const depth of this.depthMaterials.values()) depth.dispose();
    this.depthMaterials.clear();
    this.items.length = 0; this.order.length = 0; this.previous = undefined; this.lodDirty = true;
  }
}
