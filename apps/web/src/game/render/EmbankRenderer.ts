import * as THREE from 'three';
import { CellFlag, GRID, Surface, cellIndex, vertIndex } from '@xay-nha/contracts';
import type { SimState } from '@xay-nha/sim';
import { BoxBatch } from './geometry';

export class EmbankRenderer {
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly material = new THREE.MeshStandardMaterial({ color: '#8a8b7c', roughness: 1 });
  private readonly capsMaterial = new THREE.MeshStandardMaterial({ color: '#b1ad98', roughness: 1 });
  private readonly walls: BoxBatch;
  private readonly caps: BoxBatch;
  constructor(scene: THREE.Scene) {
    this.walls = new BoxBatch(scene, this.geometry, this.material, GRID * GRID * 4, 'wall');
    this.caps = new BoxBatch(scene, this.geometry, this.capsMaterial, GRID * GRID * 4, 'cap');
    this.walls.mesh.name = 'embank-walls'; this.caps.mesh.name = 'embank-caps';
  }

  update(state: SimState): void {
    this.walls.reset(); this.caps.reset();
    const bottom = (state.template.waterLevelDm - 5) / 10;
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      if (!(state.flags[cellIndex(x, z)]! & CellFlag.EMBANKED)) continue;
      for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID || state.surface[cellIndex(nx, nz)] !== Surface.WATER) continue;
        const ax = x + (dx > 0 ? 1 : 0), az = z + (dz > 0 ? 1 : 0);
        const bx = ax + (dz ? 1 : 0), bz = az + (dx ? 1 : 0);
        const ha = state.heights[vertIndex(ax, az)]! / 10, hb = state.heights[vertIndex(bx, bz)]! / 10;
        const top = (ha + hb) / 2, slope = (dx ? ha - hb : hb - ha);
        const wx = (x + 0.5 + dx * 0.5) * 2, wz = (z + 0.5 + dz * 0.5) * 2, yaw = dx ? Math.PI / 2 : 0;
        this.walls.box(wx, (top + bottom) / 2, wz, 2.06, top - bottom, 0.28, yaw, slope / Math.max(0.01, top - bottom));
        this.caps.box(wx, top + 0.04, wz, 2.1, 0.12, 0.36, yaw, slope / 0.12);
      }
    }
    this.walls.finish(); this.caps.finish();
  }
  dispose(): void { this.walls.dispose(); this.caps.dispose(); this.geometry.dispose(); this.material.dispose(); this.capsMaterial.dispose(); }
}
