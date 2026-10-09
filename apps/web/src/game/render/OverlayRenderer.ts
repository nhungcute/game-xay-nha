import * as THREE from 'three';
import { GRID, type Cell } from '@xay-nha/contracts';
import type { SimState } from '@xay-nha/sim';
import { ALL_ZONES, cornerHeights, heightAt } from './geometry';

export class OverlayRenderer {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly materials = {
    valid: new THREE.MeshBasicMaterial({ color: '#42b97b', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }),
    warning: new THREE.MeshBasicMaterial({ color: '#ffc55b', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    invalid: new THREE.MeshBasicMaterial({ color: '#eb6666', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
  };
  private readonly mesh: THREE.Mesh;
  private readonly zoneGeometry = new THREE.BufferGeometry();
  private readonly zoneMaterial = new THREE.LineBasicMaterial({ color: '#ffe8a5', transparent: true, opacity: 0.26, depthWrite: false });
  private readonly zones: THREE.LineSegments;
  private cells: readonly Cell[] = [];
  private status: 'valid' | 'warning' | 'invalid' = 'valid';
  private visible = false;
  constructor(private readonly scene: THREE.Scene) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(256 * 6 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geometry, this.materials.valid); this.mesh.name = 'pooled-cell-preview'; this.mesh.renderOrder = 5; this.mesh.visible = false; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.zoneGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 4 * 16 * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.zones = new THREE.LineSegments(this.zoneGeometry, this.zoneMaterial); this.zones.name = 'locked-zone-outlines'; this.zones.frustumCulled = false; scene.add(this.zones);
  }

  update(state: SimState): void {
    const attribute = this.zoneGeometry.getAttribute('position') as THREE.BufferAttribute;
    let cursor = 0;
    const unlocked = new Set(state.snapshot.unlockedZones);
    for (const zone of ALL_ZONES) if (!unlocked.has(zone)) {
      const ox = zone % 8 * 16, oz = Math.floor(zone / 8) * 16;
      for (let n = 0; n < 16; n++) for (const [ax, az, bx, bz] of [[ox + n, oz, ox + n + 1, oz], [ox + n, oz + 16, ox + n + 1, oz + 16],
        [ox, oz + n, ox, oz + n + 1], [ox + 16, oz + n, ox + 16, oz + n + 1]]) {
        for (const [x, z] of [[ax!, az!], [bx!, bz!]]) attribute.setXYZ(cursor++, x! * 2, heightAt(state.heights, x! * 2, z! * 2) + 0.08, z! * 2);
      }
    }
    attribute.needsUpdate = true; this.zoneGeometry.setDrawRange(0, cursor);
    if (this.visible) this.draw(state);
  }
  preview(cells: readonly Cell[], state: SimState, status: 'valid' | 'warning' | 'invalid'): void {
    this.cells = cells.slice(0, 256).filter(([x, z]) => x >= 0 && z >= 0 && x < GRID && z < GRID);
    this.status = status; this.visible = true; this.draw(state);
  }
  hide(): void { this.visible = false; this.mesh.visible = false; }

  private draw(state: SimState): void {
    const positions = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    let cursor = 0;
    for (const cell of this.cells) {
      const [x, z] = cell, [a, b, c, d] = cornerHeights(state, cell);
      const corners = [[x * 2, a, z * 2], [(x + 1) * 2, b, z * 2], [x * 2, c, (z + 1) * 2], [(x + 1) * 2, d, (z + 1) * 2]];
      const indices = Math.abs(a - d) <= Math.abs(b - c) ? [0, 2, 3, 0, 3, 1] : [0, 2, 1, 1, 2, 3];
      for (const index of indices) { const point = corners[index]!; positions.setXYZ(cursor++, point[0]!, point[1]! + 0.065, point[2]!); }
    }
    positions.needsUpdate = true; this.geometry.setDrawRange(0, cursor); this.mesh.material = this.materials[this.status]; this.mesh.visible = cursor > 0;
  }
  dispose(): void {
    this.scene.remove(this.mesh, this.zones); this.geometry.dispose(); this.zoneGeometry.dispose(); this.zoneMaterial.dispose();
    Object.values(this.materials).forEach(material => material.dispose());
  }
}
