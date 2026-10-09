import * as THREE from 'three';
import {smooth,clamp,lerp,fbm,pointInPoly,edgeDistance,polylineDistance,polygonCenter} from '../core/math.js';
export class TerrainSystem {
  constructor(world){
    this.world=world;
    this.w=world.size.width;this.d=world.size.depth;
    this.parcelDefs=world.parcels.map(p=>({...p,center:polygonCenter(p.points)}));
    this.mesh=this.makeMesh();
    this.mesh.name='REAL_3D_TERRAIN';
    this.mesh.receiveShadow=true;
  }
  raw(x,z){
    const seed=this.world.seed;
    const n=fbm(x*.047,z*.047,seed);
    const micro=fbm(x*.22,z*.22,seed+81);
    const bx=Math.max(0,(Math.abs(x)-78)/32),bz=Math.max(0,(-z-47)/37);
    const ridge=(smooth(.0,1,bx)*5.6+smooth(0,1,bz)*9.2)*this.world.terrain.hills/2.7;
    const hills=(Math.sin(x*.053+.6)*Math.cos(z*.064+.3)+1)*this.world.terrain.hills*.25;
    return this.world.terrain.baseHeight+n*2.1+micro*.38+ridge+hills;
  }
  height(x,z){
    let y=this.raw(x,z);
    // Physically lower the underlying land beneath lakes and river channels.
    for(const lake of this.world.water){
      const d=edgeDistance(x,z,lake.points);
      const inside=pointInPoly(x,z,lake.points);
      if(inside) y=lerp(y,lake.level-2.7,smooth(0,3.3,d));
      else if(d<3.0)y=lerp(lake.level-.2,y,smooth(0,3,d));
    }
    for(const river of this.world.rivers){
      const d=polylineDistance(x,z,river.points);
      if(d<river.width*.5+3){
        y=lerp(river.level-1.7,y,smooth(river.width*.24,river.width*.5+3,d));
      }
    }
    // Small real raised islands pierce the lake surface with a graded natural shoreline.
    for(const isle of this.world.islands||[]){
      if(pointInPoly(x,z,isle.points)){
        const d=edgeDistance(x,z,isle.points);
        y=lerp(isle.waterLevel-.15,isle.waterLevel+.98,smooth(0,2.9,d));
      }
    }
    // Level the center of every buildable lot; feather its perimeter into real terrain.
    for(const p of this.parcelDefs){
      if(Math.abs(x-p.center[0])>26||Math.abs(z-p.center[1])>23)continue;
      if(pointInPoly(x,z,p.points)){
        const ed=edgeDistance(x,z,p.points);
        const flat=this.raw(...p.center);
        y=lerp(y,flat,smooth(0,3.3,ed));
      }
    }
    return y;
  }
  slope(x,z){const h=this.height(x,z),dx=this.height(x+1.1,z)-h,dz=this.height(x,z+1.1)-h;return Math.hypot(dx,dz)/1.1;}
  containsWater(x,z,pad=0){
    if((this.world.islands||[]).some(i=>pointInPoly(x,z,i.points)))return false;
    for(const l of this.world.water){const ins=pointInPoly(x,z,l.points);if(ins||(pad>0&&edgeDistance(x,z,l.points)<pad))return true;}
    for(const r of this.world.rivers)if(polylineDistance(x,z,r.points)<r.width*.5+pad)return true;
    return false;
  }
  containsPath(x,z,pad=0){
    for(const p of this.world.paths){if(polylineDistance(x,z,p.points)<p.width*.5+pad)return true;}
    for(const parcel of this.parcelDefs)if(edgeDistance(x,z,parcel.points)<.65+pad)return true;
    return false;
  }
  atParcel(x,z){return this.parcelDefs.find(p=>pointInPoly(x,z,p.points))||null;}
  makeMesh(){
    const N=this.world.terrain.resolution, vertices=[],colors=[],idx=[];
    const dry=new THREE.Color('#c6ad73'), meadow=new THREE.Color('#8ebc60'), high=new THREE.Color('#738f50');
    const p=new THREE.Color();
    for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){
      const x=(i/N-.5)*this.w,z=(j/N-.5)*this.d,y=this.height(x,z);
      vertices.push(x,y,z);
      const variation=fbm(x*.17,z*.17,this.world.seed+100);
      const parcel=this.atParcel(x,z);
      const island=(this.world.islands||[]).find(isle=>pointInPoly(x,z,isle.points));
      if(island){p.copy(meadow).multiplyScalar(.9+variation*.12);}
      else if(parcel){
        p.copy(parcel.type==='cleared'?dry:meadow);
        p.multiplyScalar(1+variation*.095);
      }else{
        p.copy(meadow).lerp(high,smooth(1.8,15,y)*.6);
        p.multiplyScalar(1+variation*.20);
      }
      colors.push(p.r,p.g,p.b);
    }
    for(let j=0;j<N;j++)for(let i=0;i<N;i++){
      const a=j*(N+1)+i,b=a+1,c=a+N+1,d=c+1;
      idx.push(a,c,b,b,c,d);
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geo.setIndex(idx);geo.computeVertexNormals();
    // DoubleSide ensures correct rendering of terrain independently of mesh winding.
    return new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,side:THREE.DoubleSide}));
  }
  dispose(){this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
