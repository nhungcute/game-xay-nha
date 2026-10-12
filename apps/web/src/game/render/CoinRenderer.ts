import { CanvasTexture, CylinderGeometry, InstancedMesh, MeshStandardMaterial, Object3D, SRGBColorSpace, type Scene, type Texture } from 'three';
import { CELL_SIZE_M } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { capHours, rotatedSize, type SimState } from '@xay-nha/sim';
import { terrainHeight } from '../assets/placement';

const MAX = 512;
const RADIUS = 1.2, THICKNESS = 0.3;
/** The HUD cash icon (ui/GameIcon.tsx `cash`, 24-unit viewBox), so the floating coin reads as the same money. */
const CASH_SYMBOL = 'M14.8 8.6c-.6-.7-1.6-1.1-2.8-1.1-1.6 0-2.8.8-2.8 2.1 0 2.9 5.7 1.6 5.7 4.6 0 1.3-1.2 2.2-2.9 2.2-1.3 0-2.4-.5-3-1.3M12 5.6v12.8';

/** Coin face texture drawn from the cash icon; null where no DOM canvas exists (unit tests). */
function cashFaceTexture(): Texture | null {
  if (typeof document === 'undefined' || typeof Path2D === 'undefined') return null;
  const size = 128, canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  if (!context) return null;
  canvas.width = canvas.height = size;
  context.scale(size / 24, size / 24);
  context.fillStyle = '#1f8a4c'; context.beginPath(); context.arc(12, 12, 12, 0, Math.PI * 2); context.fill();
  context.fillStyle = '#2fa35f'; context.strokeStyle = '#7fd39e'; context.lineWidth = 1.2;
  context.beginPath(); context.arc(12, 12, 8.9, 0, Math.PI * 2); context.fill(); context.stroke();
  context.strokeStyle = '#ffffff'; context.lineWidth = 2; context.lineCap = 'round'; context.lineJoin = 'round';
  context.stroke(new Path2D(CASH_SYMBOL));
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}
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
    const geometry = new CylinderGeometry(RADIUS, RADIUS, THICKNESS, 32);
    geometry.rotateX(Math.PI / 2);
    // Groups: 0 rim, 1 and 2 the two faces. The faces carry the cash icon and glow with it (emissiveMap), so the coin
    // stands out on shaded facades and at night; the rim is the icon's darker outer ring.
    const face = cashFaceTexture();
    const rim = new MeshStandardMaterial({ color: '#1f8a4c', metalness: 0.3, roughness: 0.45, emissive: '#1f8a4c', emissiveIntensity: 0.35 });
    const faces = new MeshStandardMaterial(face
      ? { map: face, emissiveMap: face, emissive: '#ffffff', emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.5 }
      : { color: '#2fa35f', emissive: '#2fa35f', emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.5 });
    this.mesh = new InstancedMesh(geometry, [rim, faces, faces], MAX);
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
  dispose(): void {
    this.scene.remove(this.mesh); this.mesh.geometry.dispose();
    for (const material of new Set(this.mesh.material as MeshStandardMaterial[])) { material.map?.dispose(); material.dispose(); }
    this.mesh.dispose();
  }
}
