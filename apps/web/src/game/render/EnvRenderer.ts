import type { Scene } from 'three';
import { CELL_SIZE_M, GRID } from '@xay-nha/contracts';
import type { SimState } from '@xay-nha/sim';
import { AssetManager } from '../assets/AssetManager';
import { InstanceBatches, type InstancePlacement } from '../assets/InstanceBatches';
import { addInstance, cellCenter, matrix, terrainHeight } from '../assets/placement';

/** Environment batches are asset × map quadrant (not × zone): 4 frustum-cullable blocks per asset keep the
 * default views within the docs/11 §8 draw-call budget (G3 visual analysis: 522/638 calls with per-zone batches). */
const REGION_CELLS = GRID / 2;
const regionOf = ([x, z]: readonly [number, number]) => Math.floor(z / REGION_CELLS) * 2 + Math.floor(x / REGION_CELLS);
/** Only tall scenery (trees, large rocks) casts shadows; flowers, reeds and low bushes are skipped in the shadow pass. */
const SHADOW_MIN_HEIGHT_M = 1.5;

export class EnvRenderer {
  private readonly batches: InstanceBatches;
  private previous?: SimState;
  constructor(scene: Scene, assets: AssetManager) {
    this.batches = new InstanceBatches(scene, assets, handle => handle.bounds.max.y - handle.bounds.min.y >= SHADOW_MIN_HEIGHT_M);
  }
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
      addInstance(groups, `${env.assetId}:${regionOf(env.cell)}`, env.assetId,
        matrix(x + footprintOffset, terrainHeight(s, x + footprintOffset, z + footprintOffset), z + footprintOffset,
          env.yawDeg * Math.PI / 180, [env.scale, env.scale, env.scale]));
    }
    this.batches.update(groups);
  }
  dispose(): void { this.batches.dispose(); this.previous = undefined; }
}
