import type { Scene } from 'three';
import { CELL_SIZE_M, zoneOf } from '@xay-nha/contracts';
import type { SimState } from '@xay-nha/sim';
import { AssetManager } from '../assets/AssetManager';
import { InstanceBatches, type InstancePlacement } from '../assets/InstanceBatches';
import { addInstance, cellCenter, matrix, terrainHeight } from '../assets/placement';

export class EnvRenderer {
  private readonly batches: InstanceBatches;
  private previous?: SimState;
  constructor(scene: Scene, assets: AssetManager) { this.batches = new InstanceBatches(scene, assets); }
  update(s: SimState): void {
    if (this.previous === s) return;
    this.previous = s;
    const groups = new Map<string, InstancePlacement>(), removed = new Set(s.snapshot.delta.removedEnvIds);
    for (const env of s.env) {
      if (removed.has(env.id)) continue;
      const [cx, cz] = cellCenter(env.cell);
      // offsetXZ is in world meters in the immutable generated environment.
      const x = cx + env.offsetXZ[0], z = cz + env.offsetXZ[1];
      const footprintOffset = (env.footprint - 1) * CELL_SIZE_M / 2;
      addInstance(groups, `${env.assetId}:${zoneOf(...env.cell)}`, env.assetId,
        matrix(x + footprintOffset, terrainHeight(s, x + footprintOffset, z + footprintOffset), z + footprintOffset,
          env.yawDeg * Math.PI / 180, [env.scale, env.scale, env.scale]));
    }
    this.batches.update(groups);
  }
  dispose(): void { this.batches.dispose(); this.previous = undefined; }
}
