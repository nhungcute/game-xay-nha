import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {seeded,hash} from '../core/math.js';
const SPECIES=['conifer','oak','boulder','shrub'];
export class VegetationSystem{
 constructor(scene,field){this.scene=scene;this.field=field;this.group=new THREE.Group();this.group.name='Instanced GLB vegetation';scene.add(this.group);this.assets=new Map();this.buckets=new Map();this.spawnCache=new Map();this.active=new Set();this.tmp=new THREE.Object3D();this.ready=false;}
 async load(){
  const loader=new GLTFLoader();
  for(const species of SPECIES){const gltf=await loader.loadAsync(`/assets/${species}.glb`);let source=null;gltf.scene.traverse(obj=>{if(obj.isMesh&&!source)source=obj;});if(!source)throw new Error(`No real mesh in ${species}.glb`);
   let material=source.material.clone();material.side=THREE.DoubleSide;material.roughness=1;material.metalness=0;this.assets.set(species,{geometry:source.geometry,material});
  }
  this.ready=true;
 }
 spawn(ix,iz){
  let key=`${ix}:${iz}`;if(this.spawnCache.has(key))return this.spawnCache.get(key);
  const cfg=this.field.config,size=cfg.world.chunkSize,rand=seeded(hash(cfg.seed^Math.imul(ix+99,9187)^Math.imul(iz+117,1299709)));
  let x0=-this.field.w/2+ix*size,z0=-this.field.d/2+iz*size;
  const data={conifer:[],oak:[],boulder:[],shrub:[]};
  for(let n=0;n<215*cfg.vegetation.density;n++){
   const x=x0+rand()*size,z=z0+rand()*size;
   if(!this.field.isInside(x,z)||this.field.isWater(x,z,4.0)||this.field.pathDistance(x,z)<(2.1+rand()*.65)||this.field.parcelProximity(x,z)<2.2)continue;
   const forestFactor=z < -65 ? 1.0 : z < -31 ? .62 : .39;
   const coastFactor=z > this.field.coastline(x)-19 ? .63 : 1;
   if(rand()>forestFactor*coastFactor)continue;
   const r=rand();let type=r<.45?'conifer':r<.62?'oak':r<.79?'shrub':'boulder';
   if(z< -57&&type==='shrub'&&rand()>.5)type='conifer';
   let s=type==='conifer'?.55+rand()*.58:type==='oak'?.52+rand()*.58:type==='boulder'?.60+rand()*1.0:.54+rand()*.75;
   data[type].push({x,y:this.field.height(x,z),z,s,rot:rand()*Math.PI*2});
  }
  this.spawnCache.set(key,data);return data;
 }
 addChunk(key){
  if(this.buckets.has(key)){this.group.add(this.buckets.get(key));return;}
  const [ix,iz]=key.split(':').map(Number),data=this.spawn(ix,iz),root=new THREE.Group();root.name=`Vegetation chunk ${key}`;
  for(const species of SPECIES){const poses=data[species];if(!poses.length)continue;const src=this.assets.get(species);
   const mesh=new THREE.InstancedMesh(src.geometry,src.material,poses.length);mesh.name=`${species} ×${poses.length}`;mesh.castShadow=true;mesh.receiveShadow=true;
   poses.forEach((p,i)=>{this.tmp.position.set(p.x,p.y-.05,p.z);this.tmp.rotation.set(0,p.rot,0);this.tmp.scale.setScalar(p.s);this.tmp.updateMatrix();mesh.setMatrixAt(i,this.tmp.matrix);});
   mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();root.add(mesh);
  }
  this.buckets.set(key,root);this.group.add(root);
 }
 update(keys){if(!this.ready)return;for(const key of keys)if(!this.active.has(key))this.addChunk(key);for(const key of this.active)if(!keys.has(key))this.group.remove(this.buckets.get(key));this.active=new Set(keys);}
 hasObstacle(x,z,w,d){
  const size=this.field.config.world.chunkSize;
  const ix=Math.floor((x+this.field.w/2)/size),iz=Math.floor((z+this.field.d/2)/size);
  for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){
   const data=this.spawn(ix+di,iz+dj);for(const [kind,poses] of Object.entries(data))for(let p of poses){let rad=(kind==='boulder'?1.0:kind==='conifer'?1.12:kind==='oak'?1.55:.6)*p.s;
    if(Math.abs(p.x-x)<w/2+rad&&Math.abs(p.z-z)<d/2+rad)return true;
   }
  }
  return false;
 }
 stats(){let n=0;for(let key of this.active){let data=this.spawnCache.get(key);if(data)for(let list of Object.values(data))n+=list.length;}return{chunks:this.active.size,instances:n};}
}
