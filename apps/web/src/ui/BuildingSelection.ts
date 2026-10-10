import { BufferAttribute, BufferGeometry, DoubleSide, Group, LineLoop, LineBasicMaterial, Mesh, MeshBasicMaterial, PlaneGeometry, type Scene } from 'three';
import { catalog } from '@xay-nha/content';
import { footprintCells } from '@xay-nha/sim';
import { useTools } from '../game/ToolController';
import type { WorldStore } from '../game/WorldStore';

/** Two pooled GPU objects for the current selection; game simulation and building meshes stay untouched. */
export class BuildingSelection {
  private readonly group = new Group();
  private readonly geometry = new BufferGeometry();
  private readonly lineMaterial = new LineBasicMaterial({ color: '#ffe1a0', transparent: true, opacity: .95, depthTest: false, depthWrite: false });
  private readonly floorGeometry = new PlaneGeometry(1, 1);
  private readonly floorMaterial = new MeshBasicMaterial({ color: '#edbe59', transparent: true, opacity: .18, depthWrite: false, side: DoubleSide });
  private readonly floor = new Mesh(this.floorGeometry, this.floorMaterial);
  private readonly unsubscribers: (() => void)[];
  private frame = 0;
  private began = 0;
  private selected: string | null = null;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private readonly scene: Scene, private readonly world: WorldStore, private readonly height: (x: number, z: number) => number) {
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array(8 * 3), 3));
    const outline = new LineLoop(this.geometry, this.lineMaterial); outline.renderOrder = 9; outline.frustumCulled = false;
    this.floor.rotation.x = -Math.PI / 2; this.floor.renderOrder = 6;
    this.group.add(outline, this.floor); this.group.visible = false; this.group.name = 'selected-building-highlight'; scene.add(this.group);
    this.unsubscribers = [useTools.subscribe(() => this.update()), world.subscribe(() => this.update())]; this.update();
  }
  private update(): void {
    const id = useTools.getState().selection, snapshot = this.world.state.snapshot;
    const building = snapshot.buildings.find(b => b.id === id), bridge = snapshot.bridges.find(b => b.id === id);
    const def = building && catalog.buildings[building.defId];
    const cells = building && def ? footprintCells(def, building.anchor, building.rotation) : bridge ? [bridge.a, bridge.b] : [];
    if (!cells.length) { this.group.visible = false; this.selected = null; cancelAnimationFrame(this.frame); return; }
    const x0 = Math.min(...cells.map(c => c[0])) * 2 - .2, x1 = (Math.max(...cells.map(c => c[0])) + 1) * 2 + .2;
    const z0 = Math.min(...cells.map(c => c[1])) * 2 - .2, z1 = (Math.max(...cells.map(c => c[1])) + 1) * 2 + .2;
    const y = bridge ? bridge.deckHeightDm / 10 + .15 : this.height((x0 + x1) / 2, (z0 + z1) / 2) + .14;
    this.group.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    const w = (x1 - x0) / 2, h = (z1 - z0) / 2, cut = .35;
    const corners = [[-w + cut, -h], [w - cut, -h], [w, -h + cut], [w, h - cut], [w - cut, h], [-w + cut, h], [-w, h - cut], [-w, -h + cut]];
    const position = this.geometry.getAttribute('position') as BufferAttribute;
    corners.forEach(([x, z], index) => position.setXYZ(index, x!, .025, z!)); position.needsUpdate = true;
    this.floor.scale.set(x1 - x0, z1 - z0, 1); this.group.visible = true;
    if (this.selected !== id) { this.selected = id; this.began = performance.now(); cancelAnimationFrame(this.frame); this.animate(); }
  }
  private animate = (): void => {
    if (!this.group.visible) return;
    const elapsed = performance.now() - this.began, progress = Math.min(1, elapsed / 240);
    this.group.scale.setScalar(this.reducedMotion.matches ? 1 : .94 + .06 * (1 - (1 - progress) ** 3));
    this.lineMaterial.opacity = .95; this.floorMaterial.opacity = .13 + .08 * (1 - progress);
    if (progress < 1 && !this.reducedMotion.matches) this.frame = requestAnimationFrame(this.animate);
  };
  dispose(): void {
    cancelAnimationFrame(this.frame); this.unsubscribers.forEach(unsubscribe => unsubscribe()); this.scene.remove(this.group);
    this.geometry.dispose(); this.lineMaterial.dispose(); this.floorGeometry.dispose(); this.floorMaterial.dispose();
  }
}
