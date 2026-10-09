import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {seeded,noise,clamp,nearestPolyline,approxEllipseDistance,polyContains,polygonEdgeDistance} from '../core/math.js';

const assetFiles={pine:'pine.glb',oak:'oak.glb',bush:'shrub.glb',rock:'rock.glb',rockWarm:'rock_warm.glb',flower:'flower.glb'};

export class VegetationSystem {
  constructor(world,terrain){
    this.world=world;this.terrain=terrain;
    this.group=new THREE.Group();this.group.name='Lazy-loaded, instanced GLB vegetation chunks';
    this.chunks=new Map();this.assets={};this.positions={};this.chunkRecords=new Map();
  }
  async initialize(){
    const loader=new GLTFLoader();
    const assets=await Promise.all(Object.entries(assetFiles).map(async([key,file])=>[key,(await loader.loadAsync(`/assets/models/${file}`)).scene]));
    for(const [k,scene] of assets){
      scene.updateMatrixWorld(true);this.assets[k]=[];
      scene.traverse(obj=>{
        if(obj.isMesh){
          const geo=obj.geometry.clone();geo.applyMatrix4(obj.matrixWorld);
          this.assets[k].push({geometry:geo,material:obj.material.clone()});
        }
      });
    }
    this.assets.tuft=[{geometry:new THREE.ConeGeometry(.17,.60,3),material:new THREE.MeshStandardMaterial({color:'#5eaa50',roughness:1})}];
    this.populate();
  }
  canDecorate(x,z,margin=2){
    if(Math.abs(x)>this.world.size.width/2-2 || Math.abs(z)>this.world.size.depth/2-2)return false;
    if(this.world.parcels.some(p=>polyContains(x,z,p.points)||polygonEdgeDistance(x,z,p.points)<margin))return false;
    if(this.world.rivers.some(r=>nearestPolyline(x,z,r.points)<r.width+margin))return false;
    if(this.world.lakes.some(l=>approxEllipseDistance(x,z,l)<margin))return false;
    if(this.world.paths.some(p=>nearestPolyline(x,z,p.points)<p.width*.5+margin))return false;
    return true;
  }
  populate(){
    const rand=seeded(this.world.seed+22),{width,depth,chunkSize}=this.world.size;
    this.positions={pine:[],oak:[],bush:[],rock:[],rockWarm:[],flower:[],tuft:[]};
    const amounts={pine:this.world.vegetation?.pine??0,oak:this.world.vegetation?.oak??0,bush:this.world.vegetation?.bush??0,rock:Math.ceil((this.world.vegetation?.rock??0)*.57),rockWarm:Math.floor((this.world.vegetation?.rock??0)*.43),flower:this.world.vegetation?.flowers??0,tuft:this.world.vegetation?.grassTufts??0};
    for(const [type,count] of Object.entries(amounts)){
      for(let attempt=0,added=0;added<count && attempt<count*42;attempt++){
        const x=(rand()-.5)*width,z=(rand()-.5)*depth;
        const edge=Math.max(Math.abs(x)/(width*.5),Math.abs(z)/(depth*.5));
        const forest=clamp(.20+edge*.82+(noise(x*.024,z*.024,33)-.5)*.37,.08,.99);
        if(['pine','oak'].includes(type)&&rand()>forest)continue;
        if((type==='rock'||type==='rockWarm') && rand()>clamp(edge*.77+.19,.1,1))continue;
        const margin=type==='pine'||type==='oak'?5.2:(type==='rock'||type==='rockWarm')?2.6:1.8;
        if(!this.canDecorate(x,z,margin))continue;
        const h=this.terrain.height(x,z);if(h<.7)continue;
        const scale=type==='pine'?.62+rand()*.65:type==='oak'?.55+rand()*.64:type==='bush'?.53+rand()*.67:(type==='rock'||type==='rockWarm')?.65+rand()*1.42:type==='flower'?.7+rand()*1.3:.6+rand()*.85;
        const rotation=rand()*Math.PI*2;
        const key=`${Math.floor((x+width/2)/chunkSize)}_${Math.floor((z+depth/2)/chunkSize)}`;
        const item={x,y:h,z,scale,rotation,key};this.positions[type].push(item);
        if(!this.chunkRecords.has(key))this.chunkRecords.set(key,{});
        const record=this.chunkRecords.get(key);(record[type]??=[]).push(item);added++;
      }
    }
  }
  loadChunk(key){
    if(this.chunks.has(key))return;
    const record=this.chunkRecords.get(key);if(!record)return;
    const group=new THREE.Group();group.name=`Loaded chunk ${key}`;
    const dummy=new THREE.Object3D();
    for(const [type,pts] of Object.entries(record))for(const part of this.assets[type]){
      const mesh=new THREE.InstancedMesh(part.geometry,part.material,pts.length);
      mesh.name=`${type} GLB ${key}: ${pts.length} instances`;
      mesh.castShadow=type==='pine'||type==='oak'||type==='rock'||type==='rockWarm';mesh.receiveShadow=true;
      for(let i=0;i<pts.length;i++){
        const p=pts[i],yoffset=type==='tuft'?.23:0;
        dummy.position.set(p.x,p.y+yoffset,p.z);
        dummy.rotation.set(0,p.rotation,0);
        dummy.scale.set(p.scale,p.scale*((type==='rock'||type==='rockWarm')?.76:1),p.scale);
        dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();group.add(mesh);
    }
    this.chunks.set(key,group);this.group.add(group);
  }
  unloadChunk(key){
    const group=this.chunks.get(key);if(!group)return;
    group.traverse(obj=>{if(obj.isInstancedMesh)obj.dispose();}); // preserve shared geometries/materials
    this.group.remove(group);this.chunks.delete(key);
  }
  update(camera,target){
    // Orthographic-camera zoom matters more than the camera's physical distance.
    const view=Math.max(65,210/camera.zoom),{width,depth,chunkSize}=this.world.size;
    for(const key of this.chunkRecords.keys()){
      const [ix,iz]=key.split('_').map(Number);
      const x=ix*chunkSize-width/2+chunkSize/2,z=iz*chunkSize-depth/2+chunkSize/2;
      const distance=Math.hypot(x-target.x,z-target.z);
      if(distance<view+chunkSize)this.loadChunk(key);
      else if(distance>view+chunkSize*1.75)this.unloadChunk(key);
    }
  }
}
