import * as THREE from 'three';
import type { WorldTemplate } from '@xay-nha/contracts';
import type { SimState } from '@xay-nha/sim';
import { heightAt } from './geometry';
import { applyNightTint } from './night';

export class WaterRenderer {
  private readonly group = new THREE.Group();
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.85, roughness: 0.22, metalness: 0.12, side: THREE.DoubleSide, depthWrite: false });
  private readonly foamMaterial = new THREE.MeshBasicMaterial({ color: '#d2f4e7', transparent: true, opacity: 0.68, depthWrite: false, side: THREE.DoubleSide });
  private template?: WorldTemplate;
  private time = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = 'water-bodies'; scene.add(this.group);
    applyNightTint(this.foamMaterial);
    this.material.onBeforeCompile = shader => {
      shader.uniforms.waterTime = { value: 0 };
      shader.vertexShader = `uniform float waterTime;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += sin(position.x * 0.65 + waterTime) * cos(position.z * 0.42 + waterTime * 0.7) * 0.018;');
      this.material.userData.shader = shader;
    };
  }

  update(state: SimState): void {
    if (this.template === state.template) return;
    this.clear(); this.template = state.template;
    const level = state.template.waterLevelDm / 10 + 0.025;
    for (const lake of state.template.water.lakes) {
      const contour = lake.polygonXZ.map(([x, z]) => new THREE.Vector2(x, z));
      const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
      const vertices: number[][] = [], indices: number[] = [];
      const triangle = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2, depth: number): void => {
        if (depth && Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) > 4) {
          const ab = a.clone().add(b).multiplyScalar(0.5), bc = b.clone().add(c).multiplyScalar(0.5), ca = c.clone().add(a).multiplyScalar(0.5);
          triangle(a, ab, ca, depth - 1); triangle(ab, b, bc, depth - 1); triangle(ca, bc, c, depth - 1); triangle(ab, bc, ca, depth - 1);
        } else {
          const base = vertices.length; vertices.push([a.x, level, a.y], [b.x, level, b.y], [c.x, level, c.y]); indices.push(base, base + 1, base + 2);
        }
      };
      for (const [a, b, c] of triangles) triangle(contour[a!]!, contour[b!]!, contour[c!]!, 5);
      this.mesh(state, vertices, indices);
      this.foam(lake.polygonXZ.map(([x, z]) => new THREE.Vector3(x, level + 0.025, z)), true);
    }
    for (const river of state.template.water.rivers) {
      const vertices: [number, number, number][] = [], indices: number[] = [];
      const left: THREE.Vector3[] = [], right: THREE.Vector3[] = [];
      const points: [number, number][] = [], widths: number[] = [];
      river.centerlineXZ.forEach((point, index, source) => {
        if (!index) { points.push(point); widths.push(river.widthM[index]!); return; }
        const previous = source[index - 1]!, count = Math.max(1, Math.ceil(Math.hypot(point[0] - previous[0], point[1] - previous[1]) / 2));
        for (let step = 1; step <= count; step++) {
          const t = step / count; points.push([THREE.MathUtils.lerp(previous[0], point[0], t), THREE.MathUtils.lerp(previous[1], point[1], t)]);
          widths.push(THREE.MathUtils.lerp(river.widthM[index - 1]!, river.widthM[index]!, t));
        }
      });
      points.forEach(([x, z], index) => {
        const previous = points[Math.max(0, index - 1)]!, next = points[Math.min(points.length - 1, index + 1)]!;
        const dx = next[0] - previous[0], dz = next[1] - previous[1], length = Math.hypot(dx, dz) || 1;
        const half = widths[index]! / 2, ox = -dz / length * half, oz = dx / length * half;
        vertices.push([x + ox, level, z + oz], [x, level, z], [x - ox, level, z - oz]);
        left.push(new THREE.Vector3(x + ox, level + 0.025, z + oz)); right.push(new THREE.Vector3(x - ox, level + 0.025, z - oz));
        if (index) for (let strip = 0; strip < 2; strip++) {
          const a = (index - 1) * 3 + strip; indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
        }
      });
      this.mesh(state, vertices, indices); this.foam(left); this.foam(right);
    }
    for (const waterfall of state.template.water.waterfalls) {
      const [tx, tz] = waterfall.topXZ, [bx, bz] = waterfall.bottomXZ;
      const dx = bx - tx, dz = bz - tz, length = Math.hypot(dx, dz) || 1;
      const ox = -dz / length * waterfall.widthM / 2, oz = dx / length * waterfall.widthM / 2;
      const top = Math.max(level + 1, heightAt(state.heights, tx, tz)), bottom = level;
      this.mesh(state, [[tx - ox, top, tz - oz], [tx + ox, top, tz + oz], [bx - ox, bottom, bz - oz], [bx + ox, bottom, bz + oz]], [0, 2, 1, 1, 2, 3]);
      this.foam([new THREE.Vector3(bx - ox, level + 0.04, bz - oz), new THREE.Vector3(bx + ox, level + 0.04, bz + oz)]);
    }
  }

  animate(deltaSeconds: number): void {
    this.time += Math.max(0, deltaSeconds);
    const shader = this.material.userData.shader as { uniforms: { waterTime: { value: number } } } | undefined;
    if (shader) shader.uniforms.waterTime.value = this.time;
  }

  private mesh(state: SimState, vertices: number[][], indices: number[]): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flat(), 3)); geometry.setIndex(indices);
    const shallow = new THREE.Color('#75bca9'), deep = new THREE.Color('#287d9b'), colors: number[] = [];
    for (const [x, y, z] of vertices) {
      const depth = Math.max(0, y! - heightAt(state.heights, x!, z!));
      const color = shallow.clone().lerp(deep, Math.min(1, depth / 4)); colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, this.material); mesh.name = 'water-geometry'; mesh.renderOrder = 1; this.group.add(mesh);
  }

  private foam(points: THREE.Vector3[], closed = false): void {
    if (closed && points[0]) points = [...points, points[0]];
    const vertices: number[] = [], indices: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!, b = points[i + 1]!, dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz) || 1;
      const ox = -dz / length * 0.055, oz = dx / length * 0.055, base = vertices.length / 3;
      vertices.push(a.x - ox, a.y, a.z - oz, a.x + ox, a.y, a.z + oz, b.x - ox, b.y, b.z - oz, b.x + ox, b.y, b.z + oz);
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices);
    this.group.add(new THREE.Mesh(geometry, this.foamMaterial));
  }

  private clear(): void {
    for (const child of [...this.group.children]) { if (child instanceof THREE.Mesh) child.geometry.dispose(); this.group.remove(child); }
  }
  dispose(): void { this.clear(); this.scene.remove(this.group); this.material.dispose(); this.foamMaterial.dispose(); }
}
