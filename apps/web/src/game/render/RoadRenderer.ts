import * as THREE from 'three';
import { GRID, cellIndex, type Cell } from '@xay-nha/contracts';
import { bridgeCells, roadModule, type SimState } from '@xay-nha/sim';
import { cornerHeights, neighborMask } from './geometry';

interface RoadBatch { mesh: THREE.InstancedMesh; corners: THREE.InstancedBufferAttribute; mask: THREE.InstancedBufferAttribute }

export class RoadRenderer {
  private readonly batches: RoadBatch[] = [];
  private readonly dummy = new THREE.Object3D();
  constructor(private readonly scene: THREE.Scene) {
    for (const [tier, color] of ['#b49a69', '#aaa995', '#555c60'].entries()) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, -1, 0, 1, 1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0, -1], 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from({ length: 6 }, () => [0, 1, 0]).flat(), 3));
      geometry.setAttribute('roadVertex', new THREE.Float32BufferAttribute([0, 1, 2, 3, 4, 5], 1));
      const corners = new THREE.InstancedBufferAttribute(new Float32Array(GRID * GRID * 4), 4);
      const mask = new THREE.InstancedBufferAttribute(new Float32Array(GRID * GRID), 1);
      geometry.setAttribute('roadCorners', corners); geometry.setAttribute('roadMask', mask);
      const material = new THREE.MeshStandardMaterial({ color, roughness: 1 });
      material.onBeforeCompile = shader => {
        shader.vertexShader = `attribute vec4 roadCorners; attribute float roadMask; attribute float roadVertex; varying vec2 roadUv; varying float roadConnections;\n${shader.vertexShader}`
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            float a=roadCorners.x,b=roadCorners.y,c=roadCorners.z,d=roadCorners.w;
            bool diagonalAD=abs(a-d)<=abs(b-c);
            float vertex=roadVertex;
            float corner=diagonalAD ? (vertex<0.5?0.0:vertex<1.5?2.0:vertex<2.5?3.0:vertex<3.5?0.0:vertex<4.5?3.0:1.0)
              : (vertex<0.5?0.0:vertex<1.5?2.0:vertex<2.5?1.0:vertex<3.5?1.0:vertex<4.5?2.0:3.0);
            roadUv=vec2(mod(corner,2.0),floor(corner/2.0)); roadConnections=roadMask;
            transformed.xz=roadUv*2.0-1.0;
            float u = roadUv.x; float v = roadUv.y;
            if(abs(a-d)<=abs(b-c)) transformed.y = u>=v ? a+(b-a)*u+(d-b)*v : a+(d-c)*u+(c-a)*v;
            else transformed.y = u+v<=1.0 ? a+(b-a)*u+(c-a)*v : d+(c-d)*(1.0-u)+(b-d)*(1.0-v);
            transformed.y += 0.025;`)
          .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
            float dx = mix(roadCorners.y-roadCorners.x,roadCorners.w-roadCorners.z,position.z*0.5+0.5)*0.5;
            float dz = mix(roadCorners.z-roadCorners.x,roadCorners.w-roadCorners.y,position.x*0.5+0.5)*0.5;
            objectNormal = normalize(vec3(-dx,1.0,-dz));`);
        shader.fragmentShader = `varying vec2 roadUv; varying float roadConnections;\n${shader.fragmentShader}`
          .replace('#include <color_fragment>', `#include <color_fragment>
            vec2 p=roadUv-0.5; float halfWidth=0.34;
            bool center=abs(p.x)<=halfWidth && abs(p.y)<=halfWidth;
            bool n=mod(floor(roadConnections/1.0),2.0)>0.5 && abs(p.x)<=halfWidth && p.y<0.0;
            bool e=mod(floor(roadConnections/2.0),2.0)>0.5 && abs(p.y)<=halfWidth && p.x>0.0;
            bool s=mod(floor(roadConnections/4.0),2.0)>0.5 && abs(p.x)<=halfWidth && p.y>0.0;
            bool w=mod(floor(roadConnections/8.0),2.0)>0.5 && abs(p.y)<=halfWidth && p.x<0.0;
            if(!(center||n||e||s||w)) discard;
            float edge=1.0-smoothstep(0.28,0.34,min(abs(p.x),abs(p.y)));
            diffuseColor.rgb*=0.92+edge*0.08;`);
      };
      const mesh = new THREE.InstancedMesh(geometry, material, GRID * GRID);
      mesh.name = `road-tier-${tier + 1}`; mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(mesh);
      this.batches.push({ mesh, corners, mask });
    }
  }

  update(state: SimState): void {
    const deck = new Set<number>();
    for (const bridge of state.snapshot.bridges) if (bridge.status === 'ACTIVE') for (const cell of bridgeCells(bridge.a, bridge.b)) deck.add(cellIndex(...cell));
    const counts = [0, 0, 0];
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      const tier = state.roadTier[cellIndex(x, z)]!;
      if (!tier) continue;
      const batch = this.batches[tier - 1]!, index = counts[tier - 1]!, cell: Cell = [x, z];
      counts[tier - 1] = index + 1;
      this.dummy.position.set(x * 2 + 1, 0, z * 2 + 1); this.dummy.updateMatrix(); batch.mesh.setMatrixAt(index, this.dummy.matrix);
      batch.corners.setXYZW(index, ...cornerHeights(state, cell));
      const mask = neighborMask(state, cell, deck); batch.mask.setX(index, mask);
      // Exact module is exposed for scene/debug inspection; GPU derives the shape from the same mask.
      batch.mesh.userData.lastModule = roadModule(mask);
    }
    this.batches.forEach((batch, tier) => { batch.mesh.count = counts[tier]!; batch.mesh.instanceMatrix.needsUpdate = true; batch.corners.needsUpdate = batch.mask.needsUpdate = true; });
  }

  dispose(): void {
    for (const { mesh } of this.batches) { this.scene.remove(mesh); mesh.dispose(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
  }
}
