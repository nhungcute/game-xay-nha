import { CylinderGeometry, InstancedMesh, MeshStandardMaterial, Object3D, type Scene } from 'three';
import { CELL_SIZE_M } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { capHours, rotatedSize, type SimState } from '@xay-nha/sim';
import { terrainHeight } from '../assets/placement';

const MAX = 512;
/**
 * Green dollar coin floating above city buildings whose stored income ≥ the bubble fraction of their cap
 * (docs/16 §6.4, docs/09 §2). One InstancedMesh, owned and disposed here (docs/02 §10.1).
 */
export class CoinRenderer {
  private readonly mesh: InstancedMesh;
  private readonly dummy = new Object3D();
  private time = 0;
  private placements: [number, number, number][] = [];
  constructor(private readonly scene: Scene) {
    const geometry = new CylinderGeometry(0.9, 0.9, 0.22, 20);
    geometry.rotateX(Math.PI / 2);
    this.mesh = new InstancedMesh(geometry, new MeshStandardMaterial({ color: '#2fa35f', metalness: 0.45, roughness: 0.4, emissive: '#0b4a25', emissiveIntensity: 0.4 }), MAX);
    this.mesh.name = 'income-coins'; this.mesh.count = 0; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  update(s: SimState): void {
    this.placements = [];
    if (s.template.mapKind !== 'city') { this.mesh.count = 0; return; }
    const cap = capHours(s);
    for (const b of s.snapshot.buildings) {
      const def = catalog.buildings[b.defId], rate = s.rates[b.id] ?? 0;
      if (!def?.baseRatePerHour || b.status !== 'ACTIVE' || rate <= 0 || (b.accrued ?? 0) < rate * cap * economy.income.bubbleFraction) continue;
      const [w, d] = rotatedSize(def, b.rotation), x = (b.anchor[0] + w / 2) * CELL_SIZE_M, z = (b.anchor[1] + d / 2) * CELL_SIZE_M;
      this.placements.push([x, terrainHeight(s, x, z) + 7 + Math.max(w, d), z]);
      if (this.placements.length >= MAX) break;
    }
    this.mesh.count = this.placements.length;
    this.animate(0);
  }
  animate(dt: number): void {
    if (!this.placements.length) return;
    this.time += dt;
    this.placements.forEach(([x, y, z], i) => {
      this.dummy.position.set(x, y + Math.sin(this.time * 2 + i) * 0.35, z); this.dummy.rotation.set(0, this.time * 1.5 + i, 0);
      this.dummy.updateMatrix(); this.mesh.setMatrixAt(i, this.dummy.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose(): void { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); (this.mesh.material as MeshStandardMaterial).dispose(); this.mesh.dispose(); }
}
