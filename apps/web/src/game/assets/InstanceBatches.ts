import { Group, InstancedMesh, Matrix4, type Scene } from 'three';
import { AssetManager, type AssetHandle } from './AssetManager';

interface Batch { assetId: string; handle: AssetHandle; meshes: InstancedMesh[]; capacity: number }
export interface InstancePlacement { assetId: string; matrices: Matrix4[] }

/** Renderer owns instance buffers; AssetManager owns every GLB resource. */
export class InstanceBatches {
  readonly group = new Group();
  private readonly batches = new Map<string, Batch>();
  private readonly matrix = new Matrix4();
  /** `castShadow` decides per asset whether its instances go into the shadow pass (each caster costs a draw call);
   *  `decorate` runs once per allocated InstancedMesh (custom depth materials, wind patches — D030). */
  constructor(scene: Scene, private readonly assets: AssetManager, private readonly castShadow: (handle: AssetHandle) => boolean = () => true,
    private readonly decorate: (mesh: InstancedMesh, assetId: string) => void = () => undefined) { scene.add(this.group); }
  private allocate(key: string, assetId: string, count: number): Batch {
    const capacity = 2 ** Math.ceil(Math.log2(Math.max(1, count)));
    const handle = this.assets.get(assetId);
    const casts = this.castShadow(handle);
    const meshes = handle.parts.map(part => {
      const mesh = new InstancedMesh(part.geometry, part.material, capacity);
      mesh.castShadow = casts; mesh.receiveShadow = true; mesh.name = `${key}:${assetId}`;
      this.decorate(mesh, assetId);
      this.group.add(mesh);
      return mesh;
    });
    const batch = { assetId, handle, meshes, capacity };
    this.batches.set(key, batch);
    return batch;
  }
  private destroy(key: string, batch: Batch): void {
    for (const mesh of batch.meshes) { mesh.removeFromParent(); mesh.dispose(); }
    batch.handle.release(); this.batches.delete(key);
  }
  update(placements: ReadonlyMap<string, InstancePlacement>): void {
    for (const [key, batch] of this.batches) if (!placements.has(key)) this.destroy(key, batch);
    for (const [key, placement] of placements) {
      let batch = this.batches.get(key);
      if (batch && (batch.assetId !== placement.assetId || batch.capacity < placement.matrices.length)) {
        this.destroy(key, batch); batch = undefined;
      }
      batch ??= this.allocate(key, placement.assetId, placement.matrices.length);
      batch.meshes.forEach((mesh, partIndex) => {
        mesh.count = placement.matrices.length;
        placement.matrices.forEach((matrix, index) => {
          this.matrix.multiplyMatrices(matrix, batch!.handle.parts[partIndex]!.matrix);
          mesh.setMatrixAt(index, this.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      });
    }
  }
  /** Iterates live batches (debug/QA accessors only). */
  each(visit: (key: string, batch: Batch) => void): void {
    for (const [key, batch] of this.batches) visit(key, batch);
  }
  dispose(): void {
    for (const [key, batch] of this.batches) this.destroy(key, batch);
    this.group.removeFromParent();
  }
}
