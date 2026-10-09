import { Group, Mesh, MeshBasicMaterial, type Scene } from 'three';
import { CELL_SIZE_M, type Cell, type Rotation } from '@xay-nha/contracts';
import { catalog } from '@xay-nha/content';
import { rotatedSize, type SimState } from '@xay-nha/sim';
import { AssetManager, type AssetHandle } from '../assets/AssetManager';
import { terrainHeight } from '../assets/placement';

export type GhostStatus = 'valid' | 'warning' | 'invalid';
interface Ghost { group: Group; meshes: Mesh[]; handle: AssetHandle }

/** A defId has one pooled GLB ghost; three world-owned materials serve all ghosts. */
export class GhostRenderer {
  private readonly root = new Group();
  private readonly pool = new Map<string, Ghost>();
  private readonly materials = {
    valid: new MeshBasicMaterial({ color: '#36bb80', transparent: true, opacity: .56, depthWrite: false }),
    warning: new MeshBasicMaterial({ color: '#eeb640', transparent: true, opacity: .56, depthWrite: false }),
    invalid: new MeshBasicMaterial({ color: '#e75465', transparent: true, opacity: .56, depthWrite: false }),
  };
  private active?: Ghost;
  constructor(scene: Scene, private readonly assets: AssetManager) {
    this.root.name = 'pooled-building-ghosts'; scene.add(this.root);
  }
  preview(defId: string, anchor: Cell, rotation: Rotation, state: SimState, status: GhostStatus): void {
    const def = catalog.buildings[defId];
    if (!def) { this.hide(); return; }
    if (this.active) this.active.group.visible = false;
    let ghost = this.pool.get(defId);
    if (!ghost) {
      const handle = this.assets.get(def.modelId), group = new Group();
      const meshes = handle.parts.map(part => {
        const mesh = new Mesh(part.geometry, this.materials[status]);
        mesh.matrixAutoUpdate = false; mesh.matrix.copy(part.matrix); mesh.renderOrder = 6;
        group.add(mesh); return mesh;
      });
      ghost = { handle, group, meshes }; this.pool.set(defId, ghost); this.root.add(group);
    }
    const [width, depth] = rotatedSize(def, rotation);
    const x = (anchor[0] + width / 2) * CELL_SIZE_M, z = (anchor[1] + depth / 2) * CELL_SIZE_M;
    const entrance = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 }[def.entranceSide];
    ghost.group.position.set(x, terrainHeight(state, x, z) + .04, z);
    ghost.group.rotation.y = -rotation * Math.PI / 2 + entrance;
    for (const mesh of ghost.meshes) mesh.material = this.materials[status];
    ghost.group.visible = true; this.active = ghost;
  }
  hide(): void { if (this.active) this.active.group.visible = false; this.active = undefined; }
  dispose(): void {
    this.hide();
    for (const ghost of this.pool.values()) {
      // Geometry remains under AssetManager ownership.
      for (const mesh of ghost.meshes) mesh.removeFromParent();
      ghost.group.removeFromParent(); ghost.handle.release();
    }
    this.pool.clear(); this.root.removeFromParent();
    for (const material of Object.values(this.materials)) material.dispose();
  }
}
