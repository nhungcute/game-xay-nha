import type { Scene } from 'three';
import { catalog } from '@xay-nha/content';
import type { SimState } from '@xay-nha/sim';
import { AssetManager } from '../assets/AssetManager';
import { InstanceBatches, type InstancePlacement } from '../assets/InstanceBatches';
import { addInstance, cellCenter, matrix, terrainHeight } from '../assets/placement';

export class CropRenderer {
  private readonly batches: InstanceBatches;
  constructor(scene: Scene, assets: AssetManager) { this.batches = new InstanceBatches(scene, assets); }
  update(s: SimState): void {
    const groups = new Map<string, InstancePlacement>();
    for (const crop of s.snapshot.crops) {
      const def = catalog.crops[crop.cropId];
      if (!def) continue;
      const duration = Math.max(1, crop.readyAt - crop.plantedAt);
      const stage = s.snapshot.serverTime >= crop.readyAt ? 2 : (s.snapshot.serverTime - crop.plantedAt) / duration < .4 ? 0 : 1;
      const assetId = def.stageModels[stage], [x, z] = cellCenter(crop.cell);
      addInstance(groups, assetId, assetId, matrix(x, terrainHeight(s, x, z), z));
    }
    this.batches.update(groups);
  }
  dispose(): void { this.batches.dispose(); }
}
