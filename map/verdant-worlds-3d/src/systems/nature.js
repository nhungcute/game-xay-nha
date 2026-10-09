import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {rng,hash32,pointInPoly,edgeDistance,polylineDistance} from '../core/math.js';
const TYPES=['pine','oak','birch','shrub','rock','reeds','flowers'];
const BASE={pine:44,oak:14,birch:12,shrub:45,rock:15,reeds:35,flowers:43};
const SCALES={pine:[.78,1.48],oak:[.72,1.32],birch:[.75,1.3],shrub:[.56,1.25],rock:[.38,1.55],reeds:[.45,1.32],flowers:[.62,1.4]};
export class NatureSystem {
  constructor(world,terrain){
    this.world=world;this.terrain=terrain;this.group=new THREE.Group();this.group.name='GLB_INSTANCED_NATURE';
    this.assets=new Map();this.chunks=new Map();this.removed=new Set();this.added=[];
    this.size=world.nature.chunkSize;this.time=0;
    this.total=0;
    this.chunksX=Math.ceil(world.size.width/this.size);this.chunksZ=Math.ceil(world.size.depth/this.size);
  }
  async load(onProgress){
    const loader=new GLTFLoader();
    const results=await Promise.all(TYPES.map(async(type)=>{
      const gltf=await loader.loadAsync(`${import.meta.env.BASE_URL}assets/models/${type}.glb`);
      gltf.scene.updateMatrixWorld(true);
      const parts=[];
      gltf.scene.traverse(m=>{if(m.isMesh)parts.push({geometry:m.geometry,material:m.material,baseMatrix:m.matrixWorld.clone()});});
      if(parts.length<1)throw new Error('GLB has no meshes: '+type);
      onProgress?.(type);
      return [type,parts];
    }));
    this.assets=new Map(results);
    this.updateChunks(new THREE.Vector3(0,0,0),true);
  }
  chunkKey(ix,iz){return `${ix},${iz}`;}
  getCandidates(ix,iz){
    const key=this.chunkKey(ix,iz), arr=[];
    const rand=rng(hash32(this.world.seed,key));
    const w=this.world.size.width,d=this.world.size.depth;
    const chunkX=-w/2+ix*this.size,chunkZ=-d/2+iz*this.size;
    for(const type of TYPES){
      const density=type==='pine'||type==='oak'||type==='birch'?this.world.nature.density.trees:
        type==='shrub'?this.world.nature.density.shrubs:type==='rock'?this.world.nature.density.rocks:
        type==='reeds'?this.world.nature.density.reeds:this.world.nature.density.flowers;
      const n=Math.round(BASE[type]*density);
      for(let k=0;k<n;k++){
        const x=chunkX+rand()*this.size,z=chunkZ+rand()*this.size;
        if(Math.abs(x)>w/2-1||Math.abs(z)>d/2-1)continue;
        const nearWater=this.terrain.containsWater(x,z,3.0);
        const water=this.terrain.containsWater(x,z,.5);
        if(water)continue;
        if(type==='reeds'&&!nearWater)continue;
        if(type==='pine'&&nearWater&&rand()<.75)continue;
        if((type==='oak'||type==='birch')&&nearWater&&rand()<.33)continue;
        if(this.terrain.slope(x,z)>1.75&&type!=='rock'&&type!=='pine')continue;
        const borderDist=Math.min(w/2-Math.abs(x),d/2-Math.abs(z));
        if((type==='pine'||type==='oak')&&borderDist<19&&rand()<.08)continue;
        if(this.terrain.containsPath(x,z,type==='pine'||type==='oak'?2.3:.6))continue;
        if(this.world.parcels.some(p=>pointInPoly(x,z,p.points)||edgeDistance(x,z,p.points)<(type==='rock'?1.7:2.1)))continue;
        // reserve tree-heavy borders but preserve scenic open spaces
        const y=this.terrain.height(x,z),scale=SCALES[type];
        arr.push({id:`${key}:${type}:${k}`,type,x,y,z,scale:scale[0]+rand()*(scale[1]-scale[0]),yaw:rand()*Math.PI*2});
      }
    }
    // Small island groves are authored in real 3D and use the same GLB instancing.
    for(const isle of this.world.islands||[]){
      const random=rng(hash32(this.world.seed,isle.id));
      const [cx,cz]=isle.points.reduce((sum,p)=>[sum[0]+p[0]/isle.points.length,sum[1]+p[1]/isle.points.length],[0,0]);
      for(let j=0;j<19;j++){
        const x=cx+(random()-.5)*10,z=cz+(random()-.5)*7;
        if(!pointInPoly(x,z,isle.points))continue;
        if(x<chunkX||x>=chunkX+this.size||z<chunkZ||z>=chunkZ+this.size)continue;
        const type=j%3===0?'rock':j%4===0?'shrub':'pine';
        arr.push({id:`${key}:island-${isle.id}-${j}`,type,x,y:this.terrain.height(x,z),z,scale:.42+random()*.4,yaw:random()*Math.PI*2});
      }
    }
    return arr;
  }
  createChunk(ix,iz){
    const key=this.chunkKey(ix,iz),g=new THREE.Group();g.name=`CHUNK_${key}`;
    const origin=this.getCandidates(ix,iz).filter(o=>!this.removed.has(o.id));
    const additional=this.added.filter(o=>o.chunk===key);
    const all=[...origin,...additional];
    g.userData.count=all.length;this.total+=all.length;
    const dummy=new THREE.Object3D();
    for(const type of TYPES){
      const entries=all.filter(o=>o.type===type);
      if(!entries.length)continue;
      for(const part of this.assets.get(type)){
        const mesh=new THREE.InstancedMesh(part.geometry,part.material,entries.length);
        mesh.name=`INSTANCED_${type}_${key}`;
        mesh.castShadow=type!=='flowers'&&type!=='reeds';mesh.receiveShadow=true;
        mesh.userData={chunk:key,type,entries};
        entries.forEach((o,i)=>{
          dummy.position.set(o.x,o.y-.09,o.z);
          dummy.rotation.set(0,o.yaw,0);
          dummy.scale.setScalar(o.scale);
          dummy.updateMatrix();
          mesh.setMatrixAt(i,dummy.matrix.clone().multiply(part.baseMatrix));
        });
        mesh.instanceMatrix.needsUpdate=true;
        mesh.computeBoundingSphere();g.add(mesh);
      }
    }
    this.group.add(g);this.chunks.set(key,g);
  }
  clearChunk(key){const group=this.chunks.get(key);if(!group)return;this.total-=group.userData.count||0;group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});this.group.remove(group);this.chunks.delete(key);}
  refresh(key){if(this.chunks.has(key)){const [ix,iz]=key.split(',').map(Number);this.clearChunk(key);this.createChunk(ix,iz);}}
  updateChunks(target,force=false){
    const max=this.world.nature.maxVisibleDistance;
    for(let ix=0;ix<this.chunksX;ix++)for(let iz=0;iz<this.chunksZ;iz++){
      const key=this.chunkKey(ix,iz);
      const x=-this.world.size.width/2+(ix+.5)*this.size,z=-this.world.size.depth/2+(iz+.5)*this.size;
      const visible=Math.hypot(x-target.x,z-target.z)<max;
      if(visible&&!this.chunks.has(key))this.createChunk(ix,iz);
      if(!visible&&this.chunks.has(key))this.clearChunk(key);
    }
  }
  nearest(x,z,maxDist=3.6){
    let found=null,ds=maxDist*maxDist;
    for(const [key,chunk] of this.chunks){
      for(const mesh of chunk.children){
        if(mesh.userData.type==='rock'||mesh.userData.type==='flowers'||mesh.userData.type==='reeds')continue;
        for(const o of mesh.userData.entries){const d=(o.x-x)**2+(o.z-z)**2;if(d<ds){found=o;ds=d;}}
      }
    }
    return found;
  }
  clearAt(x,z){
    const obj=this.nearest(x,z);if(!obj)return false;
    if(obj.added){this.added=this.added.filter(o=>o.id!==obj.id);}else this.removed.add(obj.id);
    this.refresh(obj.id.split(':')[0]);return true;
  }
  plantAt(x,z){
    if(this.terrain.containsWater(x,z,2)||this.terrain.containsPath(x,z,2)||this.terrain.atParcel(x,z)||this.nearest(x,z,2.7))return false;
    const ix=Math.floor((x+this.world.size.width/2)/this.size),iz=Math.floor((z+this.world.size.depth/2)/this.size);
    if(ix<0||iz<0||ix>=this.chunksX||iz>=this.chunksZ)return false;
    const chunk=this.chunkKey(ix,iz),id=`${chunk}:planted:${this.added.length}:${Date.now()}`;
    this.added.push({id,chunk,type:'oak',x,z,y:this.terrain.height(x,z),scale:1,yaw:(hash32(id)%628)/100,added:true});
    this.refresh(chunk);return true;
  }
  importState(state){this.removed=new Set(state?.removed||[]);this.added=Array.isArray(state?.added)?state.added:[];for(const key of [...this.chunks.keys()])this.refresh(key);}
  exportState(){return {removed:[...this.removed],added:this.added};}
  dispose(){for(const key of [...this.chunks.keys()])this.clearChunk(key);this.assets.forEach(parts=>parts.forEach(p=>{p.geometry.dispose();p.material.dispose();}));}
}
