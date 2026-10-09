import * as THREE from 'three';
import { GRID, Surface, ZONE_CELLS, cellIndex, vertIndex } from '@xay-nha/contracts';
import type { SimState } from '@xay-nha/sim';
import { ALL_ZONES, HEIGHT_COUNT, globalNormal, heightAt } from './geometry';

const COLORS = ['#79a951', '#a9875a', '#d3be82', '#88877a', '#765136', '#b49363', '#b5a68a', '#616e54'];
const VERTICES = 17 * 17;

export class TerrainRenderer {
  readonly meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  readonly stats = { lastRebuildMs: 0, maxRebuildMs: 0, zonesRebuilt: 0 };
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  private readonly skirtMaterial = new THREE.MeshStandardMaterial({ color: '#75664b', roughness: 1, side: THREE.DoubleSide });
  private readonly skirt: THREE.Mesh;
  private readonly displayed = new Float32Array(HEIGHT_COUNT);
  private readonly target = new Float32Array(HEIGHT_COUNT);
  private readonly origin = new Float32Array(HEIGHT_COUNT);
  private transitionElapsed = 0;
  private transitionZones = new Set<number>();
  private state?: SimState;
  private initialized = false;
  private readonly colors = COLORS.map(color => new THREE.Color(color));
  private readonly normal = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene) {
    this.material.onBeforeCompile = shader => {
      shader.vertexShader = `attribute float tilledWeight; varying float fieldWeight; varying vec2 fieldXZ;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nfieldWeight=tilledWeight; fieldXZ=position.xz;');
      shader.fragmentShader = `varying float fieldWeight; varying vec2 fieldXZ;\n${shader.fragmentShader}`
        .replace('#include <color_fragment>', '#include <color_fragment>\nfloat furrow=0.88+0.12*smoothstep(-0.4,0.4,sin(fieldXZ.y*15.7)); diffuseColor.rgb*=mix(1.0,furrow,fieldWeight);');
    };
    for (const zone of ALL_ZONES) {
      const geometry = new THREE.BufferGeometry();
      for (const attribute of ['position', 'normal', 'color']) geometry.setAttribute(attribute, new THREE.BufferAttribute(new Float32Array(VERTICES * 3), 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('tilledWeight', new THREE.BufferAttribute(new Float32Array(VERTICES), 1).setUsage(THREE.DynamicDrawUsage));
      geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(16 * 16 * 6), 1).setUsage(THREE.DynamicDrawUsage));
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.name = `terrain-zone-${zone}`; mesh.receiveShadow = true;
      mesh.userData.zoneId = zone; mesh.layers.enable(1);
      this.meshes.push(mesh); scene.add(mesh);
    }
    const skirt = new THREE.BufferGeometry();
    skirt.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GRID * 4 * 6 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.skirt = new THREE.Mesh(skirt, this.skirtMaterial); this.skirt.name = 'terrain-border-skirt'; scene.add(this.skirt);
  }

  update(state: SimState, dirtyZones: readonly number[] = ALL_ZONES): void {
    this.state = state;
    this.origin.set(this.displayed);
    this.transitionElapsed = 0;
    this.target.set(state.heights);
    if (!this.initialized) { this.displayed.set(this.target); this.origin.set(this.target); this.initialized = true; }
    const zones = new Set<number>();
    for (const zone of dirtyZones) if (Number.isInteger(zone) && zone >= 0 && zone < 64) {
      zones.add(zone);
      // Shared normals use one global-height sample beyond each chunk boundary.
      if (zone % 8) zones.add(zone - 1);
      if (zone % 8 < 7) zones.add(zone + 1);
      if (zone >= 8) zones.add(zone - 8);
      if (zone < 56) zones.add(zone + 8);
    }
    for (const zone of zones) { this.rebuild(zone); this.transitionZones.add(zone); }
    this.updateSkirt();
  }

  /** Optional visual interpolation; authoritative simulation heights remain untouched. */
  animate(deltaSeconds: number): void {
    if (!this.state || !this.transitionZones.size) return;
    this.transitionElapsed += Math.max(0, deltaSeconds);
    const alpha = Math.min(1, this.transitionElapsed / 0.2);
    let changing = false;
    for (let index = 0; index < HEIGHT_COUNT; index++) {
      const delta = this.target[index]! - this.displayed[index]!;
      this.displayed[index] = this.origin[index]! + (this.target[index]! - this.origin[index]!) * alpha;
      changing ||= Math.abs(delta) >= 0.02;
    }
    for (const zone of this.transitionZones) this.rebuild(zone);
    this.updateSkirt();
    if (!changing || alpha === 1) this.transitionZones.clear();
  }

  sampleHeight(worldX: number, worldZ: number): number { return heightAt(this.displayed, worldX, worldZ); }

  private rebuild(zone: number): void {
    if (!this.state) return;
    const started = performance.now(), geometry = this.meshes[zone]!.geometry;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
    const tilled = geometry.getAttribute('tilledWeight') as THREE.BufferAttribute;
    const indices = geometry.index!;
    const ox = zone % 8 * ZONE_CELLS, oz = Math.floor(zone / 8) * ZONE_CELLS;
    const color = new THREE.Color();
    for (let z = 0; z <= 16; z++) for (let x = 0; x <= 16; x++) {
      const gx = ox + x, gz = oz + z, vertex = z * 17 + x;
      position.setXYZ(vertex, gx * 2, this.displayed[vertIndex(gx, gz)]! / 10, gz * 2);
      globalNormal(this.displayed, gx, gz, this.normal); normals.setXYZ(vertex, this.normal.x, this.normal.y, this.normal.z);
      color.setRGB(0, 0, 0); let count = 0, fieldCount = 0;
      for (const nz of [gz - 1, gz]) for (const nx of [gx - 1, gx]) if (nx >= 0 && nz >= 0 && nx < GRID && nz < GRID) {
        const surface = this.state.surface[cellIndex(nx, nz)] ?? Surface.GRASS;
        color.add(this.colors[surface]!); count++; fieldCount += Number(surface === Surface.TILLED);
      }
      tilled.setX(vertex, fieldCount / count);
      const noise = 0.96 + ((Math.imul(gx + 1, 374761393) ^ Math.imul(gz + 1, 668265263) ^ this.state.template.seed) >>> 0) % 100 / 1250;
      color.multiplyScalar(noise / count); colors.setXYZ(vertex, color.r, color.g, color.b);
    }
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const a = z * 17 + x, b = a + 1, c = a + 17, d = c + 1, cursor = (z * 16 + x) * 6;
      const diagonalAD = Math.abs(position.getY(a) - position.getY(d)) <= Math.abs(position.getY(b) - position.getY(c));
      const triangle = diagonalAD ? [a, c, d, a, d, b] : [a, c, b, b, c, d];
      triangle.forEach((value, offset) => indices.setX(cursor + offset, value));
    }
    position.needsUpdate = normals.needsUpdate = colors.needsUpdate = tilled.needsUpdate = indices.needsUpdate = true;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    this.stats.lastRebuildMs = performance.now() - started;
    this.stats.maxRebuildMs = Math.max(this.stats.maxRebuildMs, this.stats.lastRebuildMs); this.stats.zonesRebuilt++;
  }

  private updateSkirt(): void {
    if (!this.state) return;
    const positions = this.skirt.geometry.getAttribute('position') as THREE.BufferAttribute;
    const bottom = (this.state.template.waterLevelDm - 40) / 10;
    let cursor = 0;
    for (let side = 0; side < 4; side++) for (let n = 0; n < GRID; n++) {
      const a: [number, number] = side === 0 ? [n, 0] : side === 1 ? [GRID, n] : side === 2 ? [GRID - n, GRID] : [0, GRID - n];
      const b: [number, number] = side === 0 ? [n + 1, 0] : side === 1 ? [GRID, n + 1] : side === 2 ? [GRID - n - 1, GRID] : [0, GRID - n - 1];
      const ah = this.displayed[vertIndex(...a)]! / 10, bh = this.displayed[vertIndex(...b)]! / 10;
      for (const [x, y, z] of [[a[0] * 2, ah, a[1] * 2], [b[0] * 2, bh, b[1] * 2], [a[0] * 2, bottom, a[1] * 2],
        [b[0] * 2, bh, b[1] * 2], [b[0] * 2, bottom, b[1] * 2], [a[0] * 2, bottom, a[1] * 2]]) positions.setXYZ(cursor++, x!, y!, z!);
    }
    positions.needsUpdate = true; this.skirt.geometry.computeVertexNormals(); this.skirt.geometry.computeBoundingSphere();
  }

  dispose(): void {
    for (const mesh of this.meshes) { this.scene.remove(mesh); mesh.geometry.dispose(); }
    this.scene.remove(this.skirt); this.skirt.geometry.dispose(); this.material.dispose(); this.skirtMaterial.dispose(); this.transitionZones.clear();
  }
}
