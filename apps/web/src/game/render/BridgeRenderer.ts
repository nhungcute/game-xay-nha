import * as THREE from 'three';
import type { Cell } from '@xay-nha/contracts';
import { bridgeCells, type SimState } from '@xay-nha/sim';
import { BoxBatch, heightAt } from './geometry';

export class BridgeRenderer {
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly materials = [
    new THREE.MeshStandardMaterial({ color: '#92704c', roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: '#9a9c8d', roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: '#a5ada8', roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: '#d09c52', roughness: 1, transparent: true, opacity: 0.7 }),
  ];
  private readonly batches: BoxBatch[];
  constructor(scene: THREE.Scene) {
    this.batches = this.materials.map((material, index) => {
      const batch = new BoxBatch(scene, this.geometry, material, 32768);
      batch.mesh.name = `bridge-modules-${index}`; return batch;
    });
  }
  update(state: SimState): void {
    this.batches.forEach(batch => batch.reset());
    for (const bridge of state.snapshot.bridges) {
      const constructing = bridge.status === 'CONSTRUCTING';
      const type = constructing ? 3 : bridge.typeId === 'bridge_wood' ? 0 : bridge.typeId === 'bridge_stone' ? 1 : 2;
      const batch = this.batches[type]!, y = bridge.deckHeightDm / 10 + 0.08;
      const horizontal = bridge.a[1] === bridge.b[1];
      const cells: Cell[] = [bridge.a, ...bridgeCells(bridge.a, bridge.b), bridge.b];
      cells.forEach(([x, z], index) => {
        const wx = x * 2 + 1, wz = z * 2 + 1, end = index === 0 || index === cells.length - 1;
        batch.box(wx, y - 0.18, wz, horizontal ? 2.03 : 1.65, 0.3, horizontal ? 1.65 : 2.03);
        if (end) {
          const ground = heightAt(state.heights, wx, wz);
          batch.box(wx, (ground + y) / 2, wz, 1.85, Math.max(0.25, y - ground), 1.85);
        }
        if (constructing) {
          if (!end) batch.box(wx, y + 0.4, wz, 0.14, 0.9, 0.14);
          return;
        }
        for (const side of [-1, 1]) {
          const ox = horizontal ? 0 : side * 0.77, oz = horizontal ? side * 0.77 : 0;
          batch.box(wx + ox, y + 0.5, wz + oz, horizontal ? 2.02 : 0.09, 0.1, horizontal ? 0.09 : 2.02);
          batch.box(wx + ox, y + 0.25, wz + oz, 0.1, 0.6, 0.1);
        }
        if (type !== 0 && !end && index % 2 === 0) {
          const floor = heightAt(state.heights, wx, wz);
          batch.box(wx, (y + floor) / 2 - 0.15, wz, 0.7, y - floor, 0.7);
        }
      });
    }
    this.batches.forEach(batch => batch.finish());
  }
  dispose(): void { this.batches.forEach(batch => batch.dispose()); this.geometry.dispose(); this.materials.forEach(material => material.dispose()); }
}
