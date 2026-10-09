import * as THREE from 'three';
import {clamp, smooth, lerp, noise, nearestPolyline, approxEllipseDistance, polyContains, polygonEdgeDistance, centroid} from '../core/math.js';

export class TerrainSystem {
  constructor(world) {
    this.world=world;
    this.group=new THREE.Group();this.group.name='Terrain geometry';
    this.flatten=world.parcels.map(p=>({...p,center:centroid(p.points)}));
    this.mesh=this.build();this.group.add(this.mesh);
  }
  height(x,z) {
    const {width,depth}=this.world.size;
    const edge=Math.max(Math.abs(x)/(width*.5),Math.abs(z)/(depth*.5));
    const upland=1.5*smooth(.64,1.05,edge);
    const northern=4.1*smooth(45,110,-z) * smooth(45,115,x); // high rocky NE ridge
    const west=2.2*smooth(45,124,-x)*smooth(45,100,-z);
    const detail=(noise(x*.042,z*.042,3)-.5)*1.65+(noise(x*.115,z*.115,7)-.5)*.47;
    let h=2.65 + upland + northern + west + detail;
    for(const r of this.world.rivers) {
      const d=nearestPolyline(x,z,r.points);
      const carve=7.6 * (1-smooth(r.width*.72, r.width+7, d));
      h-=carve;
    }
    for(const l of this.world.lakes) {
      const d=approxEllipseDistance(x,z,l);
      h-=5.8*(1-smooth(-2,7,d));
    }
    // Smooth, predominantly flat parcels; slight retained surface undulation.
    for(const p of this.flatten) {
      const d=polygonEdgeDistance(x,z,p.points), inside=polyContains(x,z,p.points);
      if(inside || d<2.4) {
        const alpha=inside ? smooth(0,2.2,d)*.82 : (1-smooth(0,2.4,d))*.20;
        const target=2.85+(noise(p.center[0]*.031,p.center[1]*.03,2)-.5)*.5;
        h=lerp(h,target,alpha);
      }
    }
    return h;
  }
  getWaterDistance(x,z) {
    let best=Infinity;
    for(const r of this.world.rivers) best=Math.min(best,nearestPolyline(x,z,r.points)-r.width);
    for(const l of this.world.lakes) best=Math.min(best,approxEllipseDistance(x,z,l));
    return best;
  }
  build() {
    const {width,depth,terrainSegmentsX:nx,terrainSegmentsZ:nz}=this.world.size;
    const verts=[],colors=[],uv=[],idx=[];
    const cGrass=new THREE.Color('#8dc75e'),cDark=new THREE.Color('#4f9d4c'),cSand=new THREE.Color('#ddc28b'),cRock=new THREE.Color('#798b73');
    const random=new THREE.Color();
    for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++) {
      const x=-width/2+i*width/nx,z=-depth/2+j*depth/nz,y=this.height(x,z);
      verts.push(x,y,z);uv.push(i/nx,j/nz);
      const water=this.getWaterDistance(x,z),rough=noise(x*.16,z*.16,25),meadow=noise(x*.045,z*.045,12);
      random.copy(cGrass).lerp(cDark,clamp(.18+(rough-.5)*.47+(meadow-.5)*.38,0,.67));
      if(water<5.5) random.lerp(cSand, (1-smooth(0,5.5,water))*.86);
      if(y>5.6)random.lerp(cRock,smooth(5.6,11,y)*.58);
      colors.push(random.r,random.g,random.b);
    }
    for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
      const a=j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1;
      idx.push(a,c,b,b,c,d);
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();
    const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(geo,mat);mesh.name='Deformable elevated terrain mesh';mesh.receiveShadow=true;mesh.userData.pickable=true;
    const outlineGeo=new THREE.BoxGeometry(width,4,depth);
    const rim=new THREE.Mesh(outlineGeo,new THREE.MeshStandardMaterial({color:'#5a6740',roughness:1}));rim.position.y=-4.35;rim.receiveShadow=true;this.group.add(rim);
    return mesh;
  }
}
