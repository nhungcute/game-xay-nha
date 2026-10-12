import type { InstancedMesh, Scene } from 'three';
import { CELL_SIZE_M } from '@xay-nha/contracts';
import { catalog } from '@xay-nha/content';
import { rotatedSize, type SimState } from '@xay-nha/sim';
import { AssetManager } from '../assets/AssetManager';
import { InstanceBatches, type InstancePlacement } from '../assets/InstanceBatches';
import { addInstance, matrix, terrainHeight } from '../assets/placement';
import { applyWindowLights } from './windowLights';

export class BuildingRenderer {
  private readonly batches: InstanceBatches;
  constructor(scene: Scene, assets: AssetManager) {
    this.batches = new InstanceBatches(scene, assets, () => true, (mesh: InstancedMesh) => {
      if (!mesh.geometry.getAttribute('_window')) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) applyWindowLights(material);
    });
  }
  update(s: SimState): void {
    const groups = new Map<string, InstancePlacement>();
    for (const b of s.snapshot.buildings) {
      const def = catalog.buildings[b.defId];
      if (!def) continue;
      const [w, d] = rotatedSize(def, b.rotation);
      const x = (b.anchor[0] + w / 2) * CELL_SIZE_M, z = (b.anchor[1] + d / 2) * CELL_SIZE_M;
      const y = terrainHeight(s, x, z);
      if (b.status === 'CONSTRUCTING') {
        addInstance(groups, 'construction_scaffold', 'construction_scaffold', matrix(x, y, z, 0, [w * CELL_SIZE_M * .93, 2.8, d * CELL_SIZE_M * .93]));
      } else {
        // Authored doorway is north-facing. Match the catalog's declared side.
        const entrance = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 }[def.entranceSide];
        addInstance(groups, def.modelId, def.modelId, matrix(x, y, z, -b.rotation * Math.PI / 2 + entrance));
        // D028: an upgrade in progress shows a low scaffold ring around the working building.
        if (b.upgrade) addInstance(groups, 'construction_scaffold', 'construction_scaffold', matrix(x, y, z, 0, [w * CELL_SIZE_M * 1.02, 1.3, d * CELL_SIZE_M * 1.02]));
      }
    }
    this.batches.update(groups);
  }
  dispose(): void { this.batches.dispose(); }
}
