import * as THREE from 'three';
import {polygonCenter,pointInPoly} from '../core/math.js';

function lakeGeometry(points,y,deep,shallows){
  const center=polygonCenter(points),verts=[],colors=[],faces=[];
  const outer=new THREE.Color(shallows),inner=new THREE.Color(deep),mid=new THREE.Color(deep).lerp(outer,.37);
  function push(x,z,h,c){verts.push(x,h,z);colors.push(c.r,c.g,c.b);}
  const n=points.length;
  points.forEach(([x,z])=>push(x,z,y,outer));
  points.forEach(([x,z])=>push(center[0]+(x-center[0])*.79,center[1]+(z-center[1])*.79,y,mid));
  push(center[0],center[1],y,inner);
  for(let i=0;i<n;i++){
    const j=(i+1)%n; faces.push(i,j,i+n,j,j+n,i+n);faces.push(i+n,j+n,2*n);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(faces);g.computeVertexNormals();return g;
}
function ribbon(points,width,sampleY,color,roughness=.97){
  const curve=new THREE.CatmullRomCurve3(points.map(([x,z])=>new THREE.Vector3(x,0,z)),false,'catmullrom',.4);
  const count=Math.max(16,Math.ceil(curve.getLength()*1.45));
  const v=[],indices=[],uv=[];
  for(let i=0;i<=count;i++){
    const t=i/count,p=curve.getPoint(t),d=curve.getTangent(t).normalize();
    const nx=-d.z,nz=d.x;
    for(const side of [-1,1]){
      const x=p.x+nx*width*.5*side,z=p.z+nz*width*.5*side;
      v.push(x,sampleY(x,z),z);uv.push(side<0?0:1,t*10);
    }
    if(i<count){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
  return new THREE.Mesh(g,new THREE.MeshStandardMaterial({color,roughness,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1}));
}
export class SurfaceSystem {
  constructor(world,terrain){
    this.group=new THREE.Group();this.group.name='REAL_WATER_AND_PATHS';
    this.ripples=[];
    const waterMat=new THREE.MeshPhongMaterial({vertexColors:true,shininess:95,specular:'#a6e8e2',transparent:true,opacity:.94,side:THREE.DoubleSide,depthWrite:false});
    for(const lake of world.water){
      const m=new THREE.Mesh(lakeGeometry(lake.points,lake.level,world.palette.deepWater,'#43c8d5'),waterMat);
      m.name='LAKE_'+lake.id; m.renderOrder=2;this.group.add(m);
      const shore=lake.points.map(([x,z])=>new THREE.Vector3(x,terrain.height(x,z)+.08,z));
      const loop=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(shore),new THREE.LineBasicMaterial({color:'#c1cf96',transparent:true,opacity:.35}));
      this.group.add(loop);
    }
    for(const r of world.rivers){
      const m=ribbon(r.points,r.width,()=>r.level,'#218fb4',.22);m.name='RIVER_'+r.id;
      m.renderOrder=3;this.group.add(m);
    }
    const soil=world.palette.soil;
    for(const path of world.paths){const m=ribbon(path.points,path.width,(x,z)=>terrain.height(x,z)+.12,soil);m.name='PATH_'+path.id;this.group.add(m);}
    for(const parcel of world.parcels){
      const pts=[...parcel.points,parcel.points[0]];
      const m=ribbon(pts,1.02,(x,z)=>terrain.height(x,z)+.16,soil);m.name='DIRT_BORDER_'+parcel.id;this.group.add(m);
    }
    // Actual 3D glints hovering above the water, not an image overlay.
    const rng=(()=>{let t=world.seed;return()=>{t=(Math.imul(t,1664525)+1013904223)>>>0;return t/4294967296;}})();
    const glimmer=new THREE.BufferGeometry(),gl=[];
    for(let i=0;i<370;i++){
      const x=(rng()-.5)*world.size.width,z=(rng()-.5)*world.size.depth;
      if(terrain.containsWater(x,z,0)&&!world.parcels.some(p=>pointInPoly(x,z,p.points)))gl.push(x,.72,z);
    }
    glimmer.setAttribute('position',new THREE.Float32BufferAttribute(gl,3));
    const sparks=new THREE.Points(glimmer,new THREE.PointsMaterial({size:.41,sizeAttenuation:true,color:'#c1f6f1',transparent:true,opacity:.65,depthWrite:false}));
    sparks.name='WATER_GLINTS';this.group.add(sparks);
  }
  dispose(){this.group.traverse(o=>{o.geometry?.dispose();if(o.material&& !Array.isArray(o.material))o.material.dispose();});}
}
